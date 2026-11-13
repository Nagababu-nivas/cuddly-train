/*
 * IndexedDB persistence for audio blobs and artwork.
 * Metadata lives in localStorage; binary payloads live here.
 */

const DB_NAME = 'orange-library';
const LEGACY_DB_NAME = 'cadence-library';
const DB_VERSION = 1;
const AUDIO = 'audio';
const ARTWORK = 'artwork';

let dbPromise = null;
const memory = { [AUDIO]: new Map(), [ARTWORK]: new Map() };
let memoryOnly = false;

function openLegacyDb() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(LEGACY_DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function countStore(database, name) {
  return new Promise((resolve) => {
    try {
      const request = database.transaction(name, 'readonly').objectStore(name).count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

function copyStore(source, target, name) {
  return new Promise((resolve) => {
    try {
      const tx = source.transaction(name, 'readonly');
      const values = tx.objectStore(name).getAll();
      const keys = tx.objectStore(name).getAllKeys();
      tx.oncomplete = () => {
        const entries = values.result || [];
        const entryKeys = keys.result || [];
        if (!entries.length) {
          resolve();
          return;
        }
        try {
          const write = target.transaction(name, 'readwrite');
          const store = write.objectStore(name);
          entries.forEach((value, index) => store.put(value, entryKeys[index]));
          write.oncomplete = () => resolve();
          write.onerror = () => resolve();
          write.onabort = () => resolve();
        } catch {
          resolve();
        }
      };
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* Carry downloads and artwork from the pre-rename database into the new one. */
async function migrateLegacyLibrary(database) {
  try {
    if ((await countStore(database, AUDIO)) || (await countStore(database, ARTWORK))) return;
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases();
      if (!list.some((entry) => entry.name === LEGACY_DB_NAME)) return;
    }
    const legacy = await openLegacyDb();
    if (!legacy) return;
    if (legacy.objectStoreNames.contains(AUDIO)) await copyStore(legacy, database, AUDIO);
    if (legacy.objectStoreNames.contains(ARTWORK)) await copyStore(legacy, database, ARTWORK);
    legacy.close();
  } catch {
    /* migration is best effort */
  }
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      memoryOnly = true;
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
      if (!db.objectStoreNames.contains(ARTWORK)) db.createObjectStore(ARTWORK);
    };
    request.onsuccess = () => {
      const database = request.result;
      migrateLegacyLibrary(database).finally(() => resolve(database));
    };
    request.onerror = () => {
      console.warn('[orange] IndexedDB unavailable, falling back to memory', request.error);
      memoryOnly = true;
      resolve(null);
    };
    request.onblocked = () => {
      console.warn('[orange] IndexedDB upgrade blocked');
    };
  });
  return dbPromise;
}

async function transaction(storeName, mode, action) {
  const db = await openDb();
  if (!db) return action(null);
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (error) {
      reject(error);
      return;
    }
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = action(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

async function put(storeName, key, value) {
  if (memoryOnly) {
    memory[storeName].set(key, value);
    return key;
  }
  const db = await openDb();
  if (!db) {
    memory[storeName].set(key, value);
    return key;
  }
  // Keep an in-memory copy so object URLs can be created even if IDB is slow.
  memory[storeName].set(key, value);
  await transaction(storeName, 'readwrite', (store) => store.put(value, key));
  return key;
}

async function get(storeName, key) {
  if (memory[storeName].has(key)) return memory[storeName].get(key);
  if (memoryOnly) return null;
  const db = await openDb();
  if (!db) return null;
  return new Promise(async (resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => {
        if (request.result) memory[storeName].set(key, request.result);
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

async function remove(storeName, key) {
  memory[storeName].delete(key);
  if (memoryOnly) return;
  const db = await openDb();
  if (!db) return;
  await transaction(storeName, 'readwrite', (store) => store.delete(key));
}

async function clearStore(storeName) {
  memory[storeName].clear();
  if (memoryOnly) return;
  const db = await openDb();
  if (!db) return;
  await transaction(storeName, 'readwrite', (store) => store.clear());
}

async function keys(storeName) {
  if (memoryOnly) return Array.from(memory[storeName].keys());
  const db = await openDb();
  if (!db) return Array.from(memory[storeName].keys());
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

export const db = {
  async putAudio(key, blob) {
    return put(AUDIO, key, blob);
  },
  async getAudio(key) {
    return get(AUDIO, key);
  },
  async hasAudio(key) {
    return Boolean(await get(AUDIO, key));
  },
  async deleteAudio(key) {
    return remove(AUDIO, key);
  },
  async audioKeys() {
    return keys(AUDIO);
  },
  async putArtwork(key, blob) {
    return put(ARTWORK, key, blob);
  },
  async getArtwork(key) {
    return get(ARTWORK, key);
  },
  async deleteArtwork(key) {
    return remove(ARTWORK, key);
  },
  async artworkKeys() {
    return keys(ARTWORK);
  },
  async clearAudio() {
    return clearStore(AUDIO);
  },
  async clearArtwork() {
    return clearStore(ARTWORK);
  },
  async clearAll() {
    await clearStore(AUDIO);
    await clearStore(ARTWORK);
  },
  async estimate() {
    if (navigator.storage?.estimate) {
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        return { usage, quota };
      } catch {
        /* ignore */
      }
    }
    return { usage: 0, quota: 0 };
  },
};

export const idb = db;
