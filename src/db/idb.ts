/**
 * A small IndexedDB wrapper. Records and their pending sync operations live in the same
 * database so a single transaction can commit both (R33).
 */

export const DB_NAME = 'clearing';
export const DB_VERSION = 1;

export const STORE_RECORDS = 'records';
export const STORE_OPS = 'ops';
export const STORE_META = 'meta';

let handle: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openDb(): Promise<IDBDatabase> {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) db.createObjectStore(STORE_RECORDS);
      if (!db.objectStoreNames.contains(STORE_OPS)) db.createObjectStore(STORE_OPS, { keyPath: 'opId' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return handle;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return promisify(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function getAllWithKeys<T>(store: string): Promise<{ key: string; value: T }[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const objectStore = tx.objectStore(store);
  const [keys, values] = await Promise.all([
    promisify(objectStore.getAllKeys() as IDBRequest<IDBValidKey[]>),
    promisify(objectStore.getAll() as IDBRequest<T[]>),
  ]);
  return keys.map((key, i) => ({ key: String(key), value: values[i] as T }));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readonly');
  return promisify(tx.objectStore(STORE_META).get(key) as IDBRequest<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put(value, key);
  await transactionDone(tx);
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export interface DurableWrite {
  /** `${table}:${id}` -> the full record, or `null` to remove it. */
  records: Map<string, unknown | null>;
  ops: unknown[];
  meta?: Record<string, unknown>;
  /** Op ids to remove, used when the server acknowledges them. */
  ackOpIds?: string[];
}

/**
 * Writes records, queued operations and metadata in one transaction. Either the whole
 * change lands or none of it does, so a pending write can never be orphaned from the
 * record it describes.
 */
export async function commit(write: DurableWrite): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_RECORDS, STORE_OPS, STORE_META], 'readwrite');
  const records = tx.objectStore(STORE_RECORDS);
  for (const [key, value] of write.records) {
    if (value === null) records.delete(key);
    else records.put(value, key);
  }
  const ops = tx.objectStore(STORE_OPS);
  for (const op of write.ops) ops.put(op);
  for (const opId of write.ackOpIds ?? []) ops.delete(opId);
  if (write.meta) {
    const meta = tx.objectStore(STORE_META);
    for (const [key, value] of Object.entries(write.meta)) meta.put(value, key);
  }
  await transactionDone(tx);
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_RECORDS, STORE_OPS, STORE_META], 'readwrite');
  tx.objectStore(STORE_RECORDS).clear();
  tx.objectStore(STORE_OPS).clear();
  tx.objectStore(STORE_META).clear();
  await transactionDone(tx);
}
