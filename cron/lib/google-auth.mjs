// cron/lib/google-auth.mjs — logs in to Google as a service account (no libraries: Node's own crypto and fetch).
// The key file is read from disk only; it is never printed, and errors never contain the key or the signed token.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SCOPE_DATASTORE = 'https://www.googleapis.com/auth/datastore';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const b64u = x => Buffer.from(x).toString('base64url');

export function readServiceAccount(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { throw new Error(`Cannot read the key file ${file} (${e.code || 'error'})`); }
  let key;
  try { key = JSON.parse(raw); } catch (e) { throw new Error(`The key file ${file} is not valid JSON`); }
  if (key.type !== 'service_account' || !key.client_email || !key.private_key) throw new Error(`The key file ${file} is not a service-account key`);
  return key;
}

// Pure: the signed login request (JWT, RS256) that Google exchanges for an access token.
export function signJwt({ account, scope, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: account.client_email, scope, aud: account.token_uri || DEFAULT_TOKEN_URL, iat, exp: iat + 3000 }));
  const sig = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${b64u(sig)}`;
}

export async function fetchAccessToken({ account, scope, fetchFn = fetch, now = Date.now() }) {
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt({ account, scope, now }) });
  const res = await fetchFn(account.token_uri || DEFAULT_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* handled below */ }
  if (!res.ok || !data.access_token) throw new Error(`Google login failed: HTTP ${res.status} ${data.error || ''} ${data.error_description || ''}`.trim());
  return { token: data.access_token, expiresAt: now + (Number(data.expires_in) || 3600) * 1000 };
}

// A function that returns a valid token, asking Google again only when the old one is nearly expired.
export function tokenProvider({ account, scope = SCOPE_DATASTORE, fetchFn = fetch, clock = Date.now }) {
  let cached = null;
  return async () => {
    if (!cached || cached.expiresAt - clock() < 120000) cached = await fetchAccessToken({ account, scope, fetchFn, now: clock() });
    return cached.token;
  };
}
