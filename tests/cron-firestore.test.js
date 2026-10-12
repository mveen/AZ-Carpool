// Run with: node cron-firestore.test.js
// cron/lib: logging in to Google as a service account and talking to Firestore over REST. No network: fetch is replaced.
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signJwt, readServiceAccount, fetchAccessToken, tokenProvider, SCOPE_DATASTORE } from '../cron/lib/google-auth.mjs';
import { createFirestore, encodeValue, decodeValue, encodeFields, decodeFields } from '../cron/lib/firestore-rest.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const account = { type: 'service_account', client_email: 'bot@az-carpool.iam.gserviceaccount.com', private_key: privateKey };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

console.log('=== logging in to Google ===');
await test('the login request is a correctly signed RS256 token for the right account and scope', () => {
  const jwt = signJwt({ account, scope: SCOPE_DATASTORE, now: 1760000000000 });
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.iss, account.client_email); assert.equal(claims.scope, SCOPE_DATASTORE);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token'); assert.equal(claims.iat, 1760000000); assert.ok(claims.exp - claims.iat <= 3600);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
});
await test('the token is exchanged at Google and cached until shortly before it expires', async () => {
  let calls = 0, clock = 1000000;
  const fetchFn = async (url, init) => { calls++; assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.match(String(init.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/); return json(200, { access_token: 'tok' + calls, expires_in: 3600 }); };
  const get = tokenProvider({ account, fetchFn, clock: () => clock });
  assert.equal(await get(), 'tok1'); clock += 3000 * 1000; assert.equal(await get(), 'tok1'); assert.equal(calls, 1);
  clock += 600 * 1000; assert.equal(await get(), 'tok2');
});
await test('a refused login gives a clear error without the key or the signed token in it', async () => {
  await assert.rejects(fetchAccessToken({ account, scope: SCOPE_DATASTORE, fetchFn: async () => json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) }),
    e => /Google login failed: HTTP 400 invalid_grant Invalid JWT Signature\./.test(e.message) && !e.message.includes('PRIVATE KEY') && !/eyJ/.test(e.message));
});
await test('a key file is checked: missing, not JSON and not a service account each get their own message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-key-'));
  writeFileSync(join(dir, 'ok.json'), JSON.stringify(account)); writeFileSync(join(dir, 'bad.json'), 'nope'); writeFileSync(join(dir, 'other.json'), JSON.stringify({ type: 'authorized_user' }));
  assert.equal(readServiceAccount(join(dir, 'ok.json')).client_email, account.client_email);
  assert.throws(() => readServiceAccount(join(dir, 'missing.json')), /Cannot read the key file/);
  assert.throws(() => readServiceAccount(join(dir, 'bad.json')), /not valid JSON/);
  assert.throws(() => readServiceAccount(join(dir, 'other.json')), /not a service-account key/);
});

console.log('=== Firestore values ===');
await test('every kind of value survives encode -> decode, and whole numbers are stored as integers', () => {
  const data = { s: 'tekst', n: 3, d: 1.5, b: false, z: null, list: [1, 'a', { x: true }], map: { a: { b: [] } }, ms: 1790000000000 };
  assert.deepEqual(decodeFields(encodeFields(data)), data);
  assert.deepEqual(encodeValue(7), { integerValue: '7' }); assert.deepEqual(encodeValue(0.5), { doubleValue: 0.5 });
  assert.deepEqual(encodeFields({ a: 1, skip: undefined }), { a: { integerValue: '1' } });
});
await test('timestamps and unknown types: kept as text / refused', () => {
  assert.equal(decodeValue({ timestampValue: '2026-10-01T00:00:00Z' }), '2026-10-01T00:00:00Z');
  assert.throws(() => decodeValue({ weirdValue: 1 }), /Unknown Firestore value/);
  assert.throws(() => encodeValue(NaN), /not finite/);
});

console.log('=== the Firestore client ===');
const ROOT = 'projects/az-carpool/databases/(default)/documents';
const docOf = (path, fields = { a: { stringValue: path } }, extra = { createTime: 't1', updateTime: 't2' }) => ({ name: `${ROOT}/${path}`, fields, ...extra });
function client(handler, extra = {}) {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init, calls.length); };
  const slept = [];
  return { fs: createFirestore({ projectId: 'az-carpool', getToken: async () => 'T', fetchFn, sleep: async ms => { slept.push(ms); }, ...extra }), calls, slept };
}
await test('walk visits every document, also in sub-collections and under "empty" parents, across result pages', async () => {
  const tree = {
    '': ['families', 'settings'],
    'families': [docOf('families/f1'), docOf('families/f2')],
    'families/f1': ['notes'], 'families/f2': [],
    'families/f1/notes': [docOf('families/f1/notes/n1')], 'families/f1/notes/n1': [],
    'settings': [docOf('settings/ghost', undefined, {}), docOf('settings/matchCache')],
    'settings/ghost': ['deep'], 'settings/matchCache': [],
    'settings/ghost/deep': [docOf('settings/ghost/deep/d1')], 'settings/ghost/deep/d1': [],
  };
  const { fs, calls } = client((url, init) => {
    const u = new URL(url); const rel = decodeURIComponent(u.pathname.replace('/v1/' + ROOT, '').replace(/^\//, ''));
    if (rel.endsWith(':listCollectionIds')) { const parent = rel.replace(/:listCollectionIds$/, ''); return json(200, { collectionIds: tree[parent] || [] }); }
    const page = u.searchParams.get('pageToken');
    const docs = tree[rel];
    assert.equal(u.searchParams.get('showMissing'), 'true');
    return json(200, docs.length === 2 && !page ? { documents: [docs[0]], nextPageToken: 'p2' } : docs.length === 2 ? { documents: [docs[1]] } : { documents: docs });
  });
  const seen = []; for await (const x of fs.walk()) seen.push(x.path + (x.missing ? ' (missing)' : ''));
  assert.deepEqual(seen.sort(), ['families/f1', 'families/f1/notes/n1', 'families/f2', 'settings/ghost (missing)', 'settings/ghost/deep/d1', 'settings/matchCache']);
  assert.ok(calls.every(c => c.init.headers.authorization === 'Bearer T'));
});
await test('"busy" answers (503, 429) and network errors are retried with a growing wait, then it works', async () => {
  const answers = [() => json(503, { error: { message: 'unavailable' } }), () => { throw new Error('reset'); }, () => json(429, {}), () => json(200, { collectionIds: ['a'] })];
  const { fs, slept } = client((u, i, n) => answers[n - 1]());
  assert.deepEqual(await fs.listCollectionIds(), ['a']); assert.deepEqual(slept, [1000, 2000, 4000]);
});
await test('it gives up after the retries, and does not retry a refusal (403)', async () => {
  const a = client(() => json(503, { error: { message: 'down' } }), { retries: 2 });
  await assert.rejects(a.fs.listCollectionIds(), /HTTP 503 down/); assert.equal(a.calls.length, 3);
  const b = client(() => json(403, { error: { message: 'Missing or insufficient permissions.' } }));
  await assert.rejects(b.fs.listCollectionIds(), /HTTP 403 Missing or insufficient permissions/); assert.equal(b.calls.length, 1);
});
await test('getDocument: null for a document that does not exist, the document otherwise; ids with special characters are escaped', async () => {
  const a = client(() => json(404, { error: { message: 'not found' } }));
  assert.equal(await a.fs.getDocument('settings/x y'), null); assert.match(a.calls[0].url, /\/settings\/x%20y$/);
  const b = client(() => json(200, docOf('settings/matchCache')));
  assert.equal((await b.fs.getDocument('settings/matchCache')).fields.a.stringValue, 'settings/matchCache');
});
await test('setDocument replaces exactly one document in one commit (no update mask)', async () => {
  const { fs, calls } = client(() => json(200, {}));
  await fs.setDocument('settings/matchCache', { fetchedAt: 5, partial: false });
  assert.equal(calls[0].url, 'https://firestore.googleapis.com/v1/projects/az-carpool/databases/(default)/documents:commit');
  assert.deepEqual(JSON.parse(calls[0].init.body), { writes: [{ update: { name: `${ROOT}/settings/matchCache`, fields: { fetchedAt: { integerValue: '5' }, partial: { booleanValue: false } } } }] });
});
await test('deleteDocument deletes one document; with updateTime only that version (changed or gone = false, other errors still fail)', async () => {
  const a = client(() => json(200, {}));
  assert.equal(await a.fs.deleteDocument('deviations/Di_heen'), true);
  assert.equal(a.calls[0].init.method, 'DELETE'); assert.match(a.calls[0].url, /\/deviations\/Di_heen$/);
  const b = client(() => json(200, {}));
  await b.fs.deleteDocument('deviations/Di_heen', { updateTime: '2026-10-03T00:00:00.123456Z' });
  assert.match(b.calls[0].url, /\?currentDocument\.updateTime=2026-10-03T00%3A00%3A00\.123456Z$/);
  const c = client(() => json(400, { error: { message: 'the version does not match', status: 'FAILED_PRECONDITION' } }));
  assert.equal(await c.fs.deleteDocument('deviations/x', { updateTime: 'u' }), false); assert.equal(c.calls.length, 1);
  const d = client(() => json(404, { error: { message: 'not found' } }));
  assert.equal(await d.fs.deleteDocument('deviations/x', { updateTime: 'u' }), false);
  const e = client(() => json(403, { error: { message: 'Missing or insufficient permissions.' } }));
  await assert.rejects(e.fs.deleteDocument('deviations/x', { updateTime: 'u' }), /HTTP 403/);
  const f = client(() => json(400, { error: { message: 'bad', status: 'INVALID_ARGUMENT' } }));
  await assert.rejects(f.fs.deleteDocument('deviations/x', { updateTime: 'u' }), /HTTP 400/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
