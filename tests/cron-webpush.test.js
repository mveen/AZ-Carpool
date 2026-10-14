// Run with: node cron-webpush.test.js
// cron/lib/webpush.mjs: sending a Web Push message without libraries. The encryption is checked against the worked example of RFC 8291
// (appendix A) and by decrypting like a browser does; the signature (VAPID, ES256) is checked with the public key; the key file is private.
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, createVerify } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptPayload, ensureVapidFile, generateVapid, readVapid, sendPush, vapidHeader } from '../cron/lib/webpush.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const b64u = x => Buffer.from(x).toString('base64url'), unb64u = s => Buffer.from(s, 'base64url');
const hmac = (key, ...parts) => { const h = createHmac('sha256', key); parts.forEach(p => h.update(p)); return h.digest(); };

// What the browser does with a message: read the header, agree on the secret with its own private key, decrypt.
function decryptLikeABrowser(body, uaPrivate, authSecret) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(unb64u(uaPrivate));
  const uaPublic = ecdh.getPublicKey();
  const ikm = hmac(hmac(unb64u(authSecret), ecdh.computeSecret(asPublic)), Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last record delimiter');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}
const browserKeys = () => { const e = createECDH('prime256v1'); e.generateKeys(); return { e, public: b64u(e.getPublicKey()), private: b64u(e.getPrivateKey()), auth: b64u(Buffer.from('0123456789abcdef')) }; };

console.log('=== encryption (RFC 8291) ===');
await test('the worked example of RFC 8291 gives exactly the message of the RFC', () => {
  const body = encryptPayload({
    payload: 'When I grow up, I want to be a watermelon',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
    asKeys: { privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' }, salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'),
  });
  const rfcHeader = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A';
  const rfcCipher = '_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  assert.equal(b64u(body), rfcHeader + rfcCipher);
});
await test('a browser can decrypt what is sent (round trip), also with accents and a long text', () => {
  const k = browserKeys();
  for (const text of ['{"title":"Test · Ouder van Saar","body":"Rit vrij: do 16:15\\nJan biedt een rit aan ✓"}', 'x'.repeat(3000), 'é']) {
    assert.equal(decryptLikeABrowser(encryptPayload({ payload: text, uaPublic: k.public, authSecret: k.auth }), k.private, k.auth), text);
  }
});
await test('every message is encrypted with a new key and salt (two equal texts never look alike)', () => {
  const k = browserKeys(), a = encryptPayload({ payload: 'same', uaPublic: k.public, authSecret: k.auth }), b = encryptPayload({ payload: 'same', uaPublic: k.public, authSecret: k.auth });
  assert.notDeepEqual(a, b);
});
await test('a too big message, a wrong key and a wrong secret are refused', () => {
  const k = browserKeys();
  assert.throws(() => encryptPayload({ payload: 'x'.repeat(4000), uaPublic: k.public, authSecret: k.auth }), /too large/);
  assert.throws(() => encryptPayload({ payload: 'x', uaPublic: 'AAAA', authSecret: k.auth }), /P-256/);
  assert.throws(() => encryptPayload({ payload: 'x', uaPublic: k.public, authSecret: 'AAAA' }), /16 bytes/);
});

console.log('\n=== the VAPID signature ===');
await test('the header carries a valid ES256 signature, the right audience (the push service) and our public key', () => {
  const v = generateVapid('https://azcarpool.nl/');
  const h = vapidHeader({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc?x=1', vapid: v, now: 1700000000000 });
  const [, jwt] = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(h);
  assert.equal(h.split(', k=')[1], v.publicKey);
  const [head, claims, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(unb64u(head)), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(unb64u(claims)), { aud: 'https://fcm.googleapis.com', exp: 1700000000 + 12 * 3600, sub: 'https://azcarpool.nl/' });
  const pub = unb64u(v.publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(createVerify('SHA256').update(`${head}.${claims}`).verify({ key, dsaEncoding: 'ieee-p1363' }, unb64u(sig)));
  assert.equal(unb64u(sig).length, 64);
});

console.log('\n=== the key file ===');
const dir = mkdtempSync(join(tmpdir(), 'az-push-'));
await test('is made once, private (mode 600), and read back unchanged', () => {
  const file = join(dir, 'secrets', 'push-vapid.json');
  const a = ensureVapidFile(file, 'https://azcarpool.nl/');
  assert.equal(a.created, true); assert.equal(statSync(file).mode & 0o777, 0o600);
  const b = ensureVapidFile(file, 'https://other.example/');
  assert.equal(b.created, false); assert.deepEqual(b.vapid, a.vapid); assert.equal(b.vapid.subject, 'https://azcarpool.nl/');
  assert.equal(unb64u(a.vapid.publicKey).length, 65); assert.equal(unb64u(a.vapid.privateKey).length, 32);
});
await test('a missing, broken or wrong file gives a clear error that never contains the key', () => {
  assert.throws(() => readVapid(join(dir, 'nope.json')), /Cannot read the push key file/);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, 'not json'); assert.throws(() => readVapid(bad), /not valid JSON/);
  writeFileSync(bad, JSON.stringify({ publicKey: 'x', privateKey: 'SECRETSECRET', subject: 's' }));
  try { readVapid(bad); assert.fail('should throw'); } catch (e) { assert.match(e.message, /wrong size/); assert.doesNotMatch(e.message, /SECRETSECRET/); }
});

console.log('\n=== sending ===');
const sub = () => { const k = browserKeys(); return { k, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: k.public, auth: k.auth } }; };
await test('posts the encrypted message with the right headers and tells the result', async () => {
  const { k, subscription } = sub(), v = generateVapid('https://azcarpool.nl/');
  let seen;
  const res = await sendPush({ subscription, payload: '{"a":1}', vapid: v, topic: 'ab/cd:ef', fetchFn: async (url, opt) => { seen = { url, opt }; return { status: 201 }; } });
  assert.deepEqual(res, { ok: true, status: 201, gone: false });
  assert.equal(seen.url, subscription.endpoint); assert.equal(seen.opt.method, 'POST');
  const h = seen.opt.headers;
  assert.equal(h['content-encoding'], 'aes128gcm'); assert.equal(h.ttl, '86400'); assert.equal(h.urgency, 'normal'); assert.equal(h.topic, 'abcdef');
  assert.match(h.authorization, /^vapid t=.+, k=/);
  assert.equal(decryptLikeABrowser(Buffer.from(seen.opt.body), k.private, k.auth), '{"a":1}');
});
await test('404 and 410 mean the browser forgot us (gone); 429, 5xx and network errors are tried again later', async () => {
  const { subscription } = sub(), v = generateVapid('s');
  const code = status => sendPush({ subscription, payload: 'x', vapid: v, fetchFn: async () => ({ status }) });
  assert.deepEqual(await code(410), { ok: false, status: 410, gone: true }); assert.equal((await code(404)).gone, true);
  for (const s of [400, 403, 429, 500, 503]) { const r = await code(s); assert.equal(r.ok, false, s); assert.equal(r.gone, false, s); }
  const net = await sendPush({ subscription, payload: 'x', vapid: v, fetchFn: async () => { throw new Error('boom'); } });
  assert.equal(net.ok, false); assert.equal(net.status, 0); assert.match(net.error, /boom/);
});
await test('the private key never leaves in an error or a header', async () => {
  const { subscription } = sub(), v = generateVapid('s');
  let sent = '';
  await sendPush({ subscription, payload: 'x', vapid: v, fetchFn: async (u, o) => { sent = JSON.stringify(o.headers); return { status: 201 }; } });
  assert.ok(!sent.includes(v.privateKey));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
