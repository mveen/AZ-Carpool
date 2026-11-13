// fake-db.js — an in-memory stand-in for Firestore, used ONLY by the tests (nothing here ever touches the
// real database). It implements the same small SDK surface that data.js's createFirestoreDb() expects
// (doc/collection/getDoc/setDoc/onSnapshot/...), so the real adapter AND the app logic on top of it can be
// tested without any network.
//   const fake = createFakeFirestore({ 'families/f1': {...} });
//   const db = createFirestoreDb({ sdk: fake.sdk, firestoreDb: fake.firestoreDb, auth: fake.auth, calendarApiKey: 'k' });
//   fake.store        Map path -> data      fake.writes  [['set','groups/x'], ...]
//   fake.failWrites(prefix, message, code)  makes the next writes under that path prefix throw (code defaults to 'permission-denied' for that message)
//   fake.failReads(prefix, code)            makes the next getDoc under that path prefix throw an error with that code
//   fake.signOutCount()                     how often signOut was called
const DEL = { __deleteField: true };
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

export function createFakeFirestore(seed = {}, { uid = 'test-uid' } = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, clone(v)]));
  const listeners = [];
  const writes = [];
  let failure = null, readFailure = null, signOuts = 0, interference = null;
  const versions = new Map();   // path -> how often it was written (a transaction that read it re-runs when this changed)
  const bump = path => versions.set(path, (versions.get(path) || 0) + 1);
  const seg = p => p.split('/');

  function fire(path) {
    listeners.slice().forEach(l => {
      if (l.kind === 'doc' && l.path === path) l.fire();
      if (l.kind === 'coll' && path.startsWith(l.path + '/') && seg(path).length === seg(l.path).length + 1) l.fire();
    });
  }
  function docSnap(path) {
    const has = store.has(path);
    return { id: seg(path).pop(), exists: () => has, data: () => has ? clone(store.get(path)) : undefined, metadata: { hasPendingWrites: false } };
  }
  function collSnap(path, filters = []) {
    const n = seg(path).length + 1;
    return { docs: [...store.keys()].filter(k => k.startsWith(path + '/') && seg(k).length === n && filters.every(f => (store.get(k) || {})[f.field] === f.value)).sort().map(docSnap) };
  }
  function checkFail(path) {
    if (failure && path.startsWith(failure.prefix)) { const f = failure; failure = null; throw Object.assign(new Error(f.message), f.code ? { code: f.code } : {}); }
  }
  function checkReadFail(path) {
    if (readFailure && path.startsWith(readFailure.prefix)) { const f = readFailure; readFailure = null; throw Object.assign(new Error('Missing or insufficient permissions.'), { code: f.code }); }
  }
  function setDeep(o, key, val) {
    const parts = key.split('.'); let c = o;
    for (let i = 0; i < parts.length - 1; i++) { if (typeof c[parts[i]] !== 'object' || c[parts[i]] === null) c[parts[i]] = {}; c = c[parts[i]]; }
    if (val && val.__deleteField) delete c[parts[parts.length - 1]]; else c[parts[parts.length - 1]] = clone(val);
  }
  const api = {
    collection: (db, p) => ({ kind: 'coll', path: p }),
    query: (ref, ...filters) => ({ ...ref, filters }),
    where: (field, op, value) => { if (op !== '==') throw new Error('fake where: only =='); return { field, value }; },
    doc: (db, ...s) => ({ kind: 'doc', path: s.join('/') }),
    getDoc: async r => { checkReadFail(r.path); return docSnap(r.path); },
    getDocs: async r => collSnap(r.path),
    setDoc: async (r, data, opts) => {
      checkFail(r.path);
      const v = clone(data); Object.keys(v).forEach(k => { if (v[k] && v[k].__deleteField) delete v[k]; });
      store.set(r.path, opts && opts.merge ? { ...(store.get(r.path) || {}), ...v } : v);
      writes.push(['set', r.path]); bump(r.path); fire(r.path);
    },
    updateDoc: async (r, data) => {
      checkFail(r.path);
      if (!store.has(r.path)) throw new Error('No document to update: ' + r.path);
      const o = clone(store.get(r.path)); Object.entries(data).forEach(([k, v]) => setDeep(o, k, v));
      store.set(r.path, o); writes.push(['update', r.path]); bump(r.path); fire(r.path);
    },
    deleteDoc: async r => { checkFail(r.path); store.delete(r.path); writes.push(['delete', r.path]); bump(r.path); fire(r.path); },
    deleteField: () => DEL,
    writeBatch: () => {
      const ops = [];
      const b = {
        set: (r, d, o) => { ops.push(() => api.setDoc(r, d, o)); return b; },
        update: (r, d) => { ops.push(() => api.updateDoc(r, d)); return b; },
        delete: r => { ops.push(() => api.deleteDoc(r)); return b; },
        commit: async () => { for (const f of ops) await f(); },
      };
      return b;
    },
    // Like Firestore: fn reads, then writes; when a document it read was written by someone else before the commit, fn runs again on the new state.
    runTransaction: async (dbArg, fn) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map(), ops = [];
        const tx = {
          get: async r => { if (ops.length) throw new Error('Firestore transactions require all reads to be executed before all writes.'); checkReadFail(r.path); reads.set(r.path, versions.get(r.path) || 0); return docSnap(r.path); },
          set: (r, d, o) => { ops.push(() => api.setDoc(r, d, o)); return tx; },
          delete: r => { ops.push(() => api.deleteDoc(r)); return tx; },
        };
        const result = await fn(tx);
        if (interference) { const i = interference; interference = null; await api.setDoc({ kind: 'doc', path: i.path }, i.data); }   // the other parent saves just now
        if ([...reads].some(([p, v]) => (versions.get(p) || 0) !== v)) continue;
        for (const op of ops) await op();
        return result;
      }
      throw Object.assign(new Error('Transaction failed: too much contention'), { code: 'aborted' });
    },
    onSnapshot: (r, next) => {
      const l = { kind: r.kind, path: r.path, fire() { Promise.resolve().then(() => next(r.kind === 'doc' ? docSnap(r.path) : collSnap(r.path, r.filters))); } };
      listeners.push(l); l.fire();
      return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    },
    signInAnonymously: async () => ({ user: { uid } }),
    signOut: async () => { signOuts++; },
  };
  return {
    sdk: api, firestoreDb: {}, auth: {}, store, writes,
    listenerCount: () => listeners.length,
    failWrites: (prefix, message = 'permission-denied', code = message === 'permission-denied' ? 'permission-denied' : undefined) => { failure = { prefix, message, code }; },
    failReads: (prefix, code = 'permission-denied') => { readFailure = { prefix, code }; },   // the next getDoc under that prefix throws, like Firestore does
    signOutCount: () => signOuts,
    interfereNextTransaction: (path, data) => { interference = { path, data }; },   // simulates somebody else writing between the read and the commit of the next transaction
    get: p => clone(store.get(p)),
    collection: prefix => [...store.keys()].filter(k => k.startsWith(prefix + '/')).sort().map(k => [k.slice(prefix.length + 1), clone(store.get(k))]),
  };
}
