// Terra3D world — IndexedDB cache for Overpass responses and elevation tiles.
const DB_NAME = "terra3d-cache";
const STORE = "entries";
const VERSION = 1;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      const rq = indexedDB.open(DB_NAME, VERSION);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return _dbPromise;
}

export async function cacheGet(key, maxAgeMs = 0) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      tx.onsuccess = () => {
        const v = tx.result;
        if (!v) return resolve(null);
        if (maxAgeMs > 0 && Date.now() - v.t > maxAgeMs) return resolve(null);
        resolve(v.d);
      };
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function cachePut(key, data) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite").objectStore(STORE).put({ t: Date.now(), d: data }, key);
      tx.onsuccess = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false); // e.g. quota exceeded — caching is best-effort
    }
  });
}

export async function cacheClear() {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
    tx.onsuccess = () => resolve();
    tx.onerror = () => resolve();
  });
}
