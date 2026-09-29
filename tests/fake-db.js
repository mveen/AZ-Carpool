// fake-db.js — an in-memory stand-in for Firestore, used ONLY by the tests (nothing here ever touches the
// real database). It implements the same small SDK surface that data.js's createFirestoreDb() expects
// (doc/collection/getDoc/setDoc/onSnapshot/...), so the real adapter AND the app logic on top of it can be
// tested without any network.
//   const fake = createFakeFirestore({ 'families/f1': {...} });
//   const db = createFirestoreDb({ sdk: fake.sdk, firestoreDb: fake.firestoreDb, auth: fake.auth, calendarApiKey: 'k' });
//   fake.store        Map path -> data      fake.writes  [['set','groups/x'], ...]
//   fake.failWrites(prefix, message)        makes the next writes under that path prefix throw
const DEL = { __deleteField: true };
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

export function createFakeFirestore(seed = {}, { uid = 'test-uid' } = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, clone(v)]));
  const listeners = [];
  const writes = [];
  let failure = null;
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
  function collSnap(path) {
    const n = seg(path).length + 1;
    return { docs: [...store.keys()].filter(k => k.startsWith(path + '/') && seg(k).length === n).sort().map(docSnap) };
  }
  function checkFail(path) {
    if (failure && path.startsWith(failure.prefix)) { const f = failure; failure = null; throw new Error(f.message); }
  }
  function setDeep(o, key, val) {
    const parts = key.split('.'); let c = o;
    for (let i = 0; i < parts.length - 1; i++) { if (typeof c[parts[i]] !== 'object' || c[parts[i]] === null) c[parts[i]] = {}; c = c[parts[i]]; }
    if (val && val.__deleteField) delete c[parts[parts.length - 1]]; else c[parts[parts.length - 1]] = clone(val);
  }
  const api = {
    collection: (db, p) => ({ kind: 'coll', path: p }),
    doc: (db, ...s) => ({ kind: 'doc', path: s.join('/') }),
    getDoc: async r => docSnap(r.path),
    getDocs: async r => collSnap(r.path),
    setDoc: async (r, data, opts) => {
      checkFail(r.path);
      const v = clone(data); Object.keys(v).forEach(k => { if (v[k] && v[k].__deleteField) delete v[k]; });
      store.set(r.path, opts && opts.merge ? { ...(store.get(r.path) || {}), ...v } : v);
      writes.push(['set', r.path]); fire(r.path);
    },
    updateDoc: async (r, data) => {
      checkFail(r.path);
      if (!store.has(r.path)) throw new Error('No document to update: ' + r.path);
      const o = clone(store.get(r.path)); Object.entries(data).forEach(([k, v]) => setDeep(o, k, v));
      store.set(r.path, o); writes.push(['update', r.path]); fire(r.path);
    },
    deleteDoc: async r => { checkFail(r.path); store.delete(r.path); writes.push(['delete', r.path]); fire(r.path); },
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
    onSnapshot: (r, next) => {
      const l = { kind: r.kind, path: r.path, fire() { Promise.resolve().then(() => next(r.kind === 'doc' ? docSnap(r.path) : collSnap(r.path))); } };
      listeners.push(l); l.fire();
      return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    },
    signInAnonymously: async () => ({ user: { uid } }),
  };
  return {
    sdk: api, firestoreDb: {}, auth: {}, store, writes,
    listenerCount: () => listeners.length,
    failWrites: (prefix, message = 'permission-denied') => { failure = { prefix, message }; },
    get: p => clone(store.get(p)),
    collection: prefix => [...store.keys()].filter(k => k.startsWith(prefix + '/')).sort().map(k => [k.slice(prefix.length + 1), clone(store.get(k))]),
  };
}
