/** Petite enveloppe Promise autour d'IndexedDB, sans dépendance. */

export const STORES = ['artworks', 'assets', 'blobs', 'presentations', 'variants'] as const;
export type StoreName = (typeof STORES)[number];

export function openDatabase(name: string, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Ouverture IndexedDB impossible'));
    req.onblocked = () => reject(new Error('Base locale bloquée par un autre onglet'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transaction IndexedDB échouée'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Requête IndexedDB échouée'));
  });
}

export async function getAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  const result = await request(tx.objectStore(store).getAll());
  await done(tx);
  return result as T[];
}

export async function get<T>(db: IDBDatabase, store: StoreName, key: string): Promise<T | null> {
  const tx = db.transaction(store, 'readonly');
  const result = await request(tx.objectStore(store).get(key));
  await done(tx);
  return (result as T | undefined) ?? null;
}

export type WriteOp =
  | { type: 'put'; store: StoreName; key: string; value: unknown }
  | { type: 'delete'; store: StoreName; key: string };

/** Applique plusieurs écritures dans une seule transaction (tout ou rien). */
export async function write(db: IDBDatabase, ops: WriteOp[]): Promise<void> {
  if (ops.length === 0) return;
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const op of ops) {
    const s = tx.objectStore(op.store);
    if (op.type === 'put') s.put(op.value, op.key);
    else s.delete(op.key);
  }
  await done(tx);
}
