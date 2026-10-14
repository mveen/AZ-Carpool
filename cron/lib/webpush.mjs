// cron/lib/webpush.mjs — sends a Web Push message (RFC 8030 + VAPID RFC 8292 + message encryption RFC 8291, "aes128gcm"),
// without libraries: Node's own crypto and fetch. The private VAPID key is read from disk only; errors never contain it.
import { createCipheriv, createECDH, createHmac, createPrivateKey, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const b64u = x => Buffer.from(x).toString('base64url');
const unb64u = s => Buffer.from(String(s), 'base64url');
const hmac = (key, ...parts) => { const h = createHmac('sha256', key); parts.forEach(p => h.update(p)); return h.digest(); };

// ---------- the VAPID key pair (made once on the server; the public half is published for the app) ----------
// File format: { publicKey, privateKey, subject }; both keys base64url (public = 65 bytes uncompressed point, private = 32 bytes).
export function generateVapid(subject) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]);
  return { publicKey: b64u(publicKey), privateKey: jwk.d, subject };
}
export function readVapid(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { throw new Error(`Cannot read the push key file ${file} (${e.code || 'error'})`); }
  let k;
  try { k = JSON.parse(raw); } catch (e) { throw new Error(`The push key file ${file} is not valid JSON`); }
  if (!k || typeof k.publicKey !== 'string' || typeof k.privateKey !== 'string' || typeof k.subject !== 'string') throw new Error(`The push key file ${file} is not a push key file`);
  if (unb64u(k.publicKey).length !== 65 || unb64u(k.privateKey).length !== 32) throw new Error(`The push key file ${file} has keys of the wrong size`);
  return k;
}
// Reads the key file; makes (and saves, mode 600) a new pair when it does not exist yet. Returns { vapid, created }.
export function ensureVapidFile(file, subject) {
  if (existsSync(file)) return { vapid: readVapid(file), created: false };
  const vapid = generateVapid(subject);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(vapid, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch (e) { /* best effort */ }
  return { vapid, created: true };
}

// ---------- VAPID: the signed header that proves who sends ----------
function privateKeyObject(vapid) {
  const pub = unb64u(vapid.publicKey);
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
}
export function vapidHeader({ endpoint, vapid, now = Date.now(), ttlSeconds = 12 * 3600 }) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + ttlSeconds, sub: vapid.subject }));
  const sig = createSign('SHA256').update(`${head}.${claims}`).sign({ key: privateKeyObject(vapid), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// ---------- message encryption (RFC 8291, aes128gcm) ----------
// `uaPublic` (65 bytes) and `authSecret` (16 bytes) come from the browser's subscription. `asKeys` and `salt` are only given by the tests.
export function encryptPayload({ payload, uaPublic, authSecret, asKeys, salt = randomBytes(16) }) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  if (data.length > 3993) throw new Error('push message too large (max 3993 bytes)');
  const ecdh = createECDH('prime256v1');
  if (asKeys) ecdh.setPrivateKey(unb64u(asKeys.privateKey)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ua = Buffer.isBuffer(uaPublic) ? uaPublic : unb64u(uaPublic);
  const auth = Buffer.isBuffer(authSecret) ? authSecret : unb64u(authSecret);
  if (ua.length !== 65 || ua[0] !== 4) throw new Error('subscription key (p256dh) is not a P-256 point');
  if (auth.length !== 16) throw new Error('subscription secret (auth) must be 16 bytes');
  const shared = ecdh.computeSecret(ua);
  const ikm = hmac(hmac(auth, shared), Buffer.from('WebPush: info\0'), ua, asPublic, Buffer.from([1]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([data, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21 + 65); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = 65; asPublic.copy(header, 21);
  return Buffer.concat([header, body]);
}

// ---------- sending ----------
// Result: { ok, status, gone } — `gone` means the browser says the subscription no longer exists (404/410): remove it.
export async function sendPush({ subscription, payload, vapid, ttl = 86400, urgency = 'normal', topic, fetchFn = fetch, now = Date.now() }) {
  const body = encryptPayload({ payload, uaPublic: subscription.p256dh, authSecret: subscription.auth });
  const headers = {
    authorization: vapidHeader({ endpoint: subscription.endpoint, vapid, now }),
    'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(ttl), urgency,
  };
  if (topic) headers.topic = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  let res;
  try { res = await fetchFn(subscription.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) }); }
  catch (e) { return { ok: false, status: 0, gone: false, error: 'network error: ' + ((e && e.message) || e) }; }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
}
