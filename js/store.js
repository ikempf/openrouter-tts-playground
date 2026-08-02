const KEYS = {
  apiKey: 'or_tts.api_key',
  form: 'or_tts.form',
  takes: 'or_tts.takes',
  catalog: 'or_tts.catalog',
};

const DB_NAME = 'or-tts-playground';
const DB_VERSION = 1;
const AUDIO_STORE = 'audio';

function readJson(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function createMemoryAudioStore() {
  const blobs = new Map();
  return {
    async put(id, blob) { blobs.set(id, blob); },
    async get(id) { return blobs.get(id); },
    async remove(id) { blobs.delete(id); },
    async clear() { blobs.clear(); },
    async usage() {
      let total = 0;
      for (const blob of blobs.values()) total += blob.size;
      return total;
    },
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// A `put` request succeeding is not the same as the write landing. Quota is
// checked at commit, so QuotaExceededError typically arrives as a transaction
// abort *after* request.onsuccess has already fired. Resolving on the request
// would settle the promise first and leave the later onabort rejection to be
// swallowed -- putAudio would report `{ ok: true }` for a write that never
// happened, suppressing both the quota banner and the orphaned-blob cleanup.
// So: writes resolve in transaction.oncomplete, carrying the result captured
// in request.onsuccess. Reads keep resolving on the request itself -- a
// readonly transaction has nothing to commit, and the value is wanted as soon
// as it exists.
function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE, mode);
    const request = run(transaction.objectStore(AUDIO_STORE));
    const fail = () => reject(
      transaction.error ?? new Error('The IndexedDB transaction was aborted.'),
    );
    transaction.onerror = fail;
    transaction.onabort = fail;

    if (mode === 'readwrite') {
      let result;
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
    } else if (request) {
      request.onsuccess = () => resolve(request.result);
    } else {
      transaction.oncomplete = () => resolve(undefined);
    }
  });
}

export function createIdbAudioStore() {
  let dbPromise = null;
  const db = () => {
    if (!dbPromise) {
      dbPromise = openDb().catch(error => {
        dbPromise = null; // Clear on failure to allow retry
        throw error; // Re-throw so caller still sees the error
      });
    }
    return dbPromise;
  };
  return {
    async put(id, blob) { await tx(await db(), 'readwrite', (s) => s.put(blob, id)); },
    async get(id) { return tx(await db(), 'readonly', (s) => s.get(id)); },
    async remove(id) { await tx(await db(), 'readwrite', (s) => s.delete(id)); },
    async clear() { await tx(await db(), 'readwrite', (s) => s.clear()); },
    async usage() {
      const blobs = await tx(await db(), 'readonly', (s) => s.getAll());
      return (blobs ?? []).reduce((total, blob) => total + (blob?.size ?? 0), 0);
    },
  };
}

export function createStore({ storage = localStorage, audio = createIdbAudioStore() } = {}) {
  const writeTakes = (takes) => storage.setItem(KEYS.takes, JSON.stringify(takes));
  const readTakes = () => readJson(storage, KEYS.takes, []);

  return {
    getApiKey: () => storage.getItem(KEYS.apiKey) ?? '',
    setApiKey: (key) => storage.setItem(KEYS.apiKey, key),

    getForm: () => readJson(storage, KEYS.form, {}),
    setForm: (form) => storage.setItem(KEYS.form, JSON.stringify(form)),

    getCatalog: () => readJson(storage, KEYS.catalog, null),
    setCatalog: (models) => storage.setItem(KEYS.catalog, JSON.stringify(models)),

    listTakes: () => [...readTakes()].sort((a, b) => b.ts - a.ts),
    addTake(take) { writeTakes([...readTakes(), take]); },
    updateTake(id, patch) {
      writeTakes(readTakes().map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    async removeTake(id) {
      writeTakes(readTakes().filter((t) => t.id !== id));
      await audio.remove(id);
    },

    async putAudio(id, blob) {
      try {
        await audio.put(id, blob);
        return { ok: true };
      } catch (cause) {
        return { ok: false, message: `Could not store audio: ${cause.message}` };
      }
    },
    getAudio: (id) => audio.get(id),
    clearAudio: () => audio.clear(),
    audioUsage: () => audio.usage(),
  };
}
