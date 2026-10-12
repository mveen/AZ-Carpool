// cron/lib/firestore-rest.mjs — a small Firestore client over Google's REST API (v1), without libraries.
// Reads whole collections (also sub-collections) and writes single documents. A write replaces the whole document.
const HOST = 'https://firestore.googleapis.com/v1';

// ---- Firestore "typed values" <-> plain JavaScript ----
export function decodeValue(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('stringValue' in v) return v.stringValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  throw new Error('Unknown Firestore value: ' + Object.keys(v).join(','));
}
export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decodeValue(v)]));
}
export function encodeValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new Error('Cannot store a number that is not finite');
    return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  }
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(encodeValue) } };
  if (typeof x === 'object') return { mapValue: { fields: encodeFields(x) } };
  throw new Error('Cannot store a value of type ' + typeof x);
}
export function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encodeValue(v)]));
}

const segments = path => path.split('/').map(encodeURIComponent).join('/');
const sleepMs = ms => new Promise(r => setTimeout(r, ms));

export function createFirestore({ projectId, getToken, fetchFn = fetch, sleep = sleepMs, retries = 4 }) {
  const root = `projects/${projectId}/databases/(default)/documents`;
  const base = `${HOST}/${root}`;

  // One call, with a time limit; waits and tries again on "busy" answers (429, 5xx) and network errors.
  async function call(method, url, body) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
      let res;
      try {
        res = await fetchFn(url, {
          method, signal: AbortSignal.timeout(30000),
          headers: { authorization: 'Bearer ' + await getToken(), 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) { last = new Error('network error: ' + ((e && e.message) || e)); continue; }
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (res.ok) return data;
      const msg = (data && data.error && (data.error.message || data.error.status)) || '';
      last = new Error(`Firestore ${method} failed: HTTP ${res.status} ${msg}`.trim());
      last.status = res.status;
      if (res.status !== 429 && res.status < 500) throw last;
    }
    throw last;
  }

  const api = {
    root,
    // Collection IDs directly under a document ('' = the database root).
    async listCollectionIds(docPath = '') {
      const ids = []; let pageToken;
      do {
        const r = await call('POST', `${base}${docPath ? '/' + segments(docPath) : ''}:listCollectionIds`, { pageSize: 100, ...(pageToken ? { pageToken } : {}) });
        ids.push(...(r.collectionIds || [])); pageToken = r.nextPageToken;
      } while (pageToken);
      return ids;
    },
    // Every document of a collection. showMissing also returns "empty" parents that only hold sub-collections.
    async listDocuments(collectionPath) {
      const docs = []; let pageToken;
      do {
        const q = new URLSearchParams({ pageSize: '300', showMissing: 'true', ...(pageToken ? { pageToken } : {}) });
        const r = await call('GET', `${base}/${segments(collectionPath)}?${q}`);
        docs.push(...(r.documents || [])); pageToken = r.nextPageToken;
      } while (pageToken);
      return docs;
    },
    // null when the document does not exist.
    async getDocument(path) {
      try { return await call('GET', `${base}/${segments(path)}`); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    // Replaces the whole document (the same as set() in the app).
    async setDocument(path, data) {
      await call('POST', `${HOST}/projects/${projectId}/databases/(default)/documents:commit`, {
        writes: [{ update: { name: `${root}/${path}`, fields: encodeFields(data) } }],
      });
    },
    // Walks the whole database: yields { path, doc, missing } for every document, sub-collections included.
    async *walk() {
      const rel = name => name.slice(root.length + 1);
      async function* collection(collectionPath) {
        for (const doc of await api.listDocuments(collectionPath)) {
          const path = rel(doc.name);
          yield { path, doc, missing: !doc.createTime };
          for (const sub of await api.listCollectionIds(path)) yield* collection(`${path}/${sub}`);
        }
      }
      for (const id of await api.listCollectionIds('')) yield* collection(id);
    },
  };
  return api;
}
