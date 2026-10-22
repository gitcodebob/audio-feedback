// Elke seconde audio gaat meteen naar IndexedDB. Navigeert iemand tijdens het
// inspreken naar een andere pagina (of crasht de tab), dan is de opname tot
// dan toe niet weg: bij het volgende laden bieden we hem aan om te versturen.
// Ook een upload die mislukt blijft hier staan tot hij wel lukt.

import type { RecordingMeta } from './types.ts';

const DB_NAME = 'audio-feedback';
const DB_VERSION = 1;

export interface StoredSession {
  meta: RecordingMeta;
  status: 'recording' | 'ready';
  /** Laatste levensteken van de tab die opneemt; zo herkent een tweede tab een lopende opname. */
  heartbeat: number;
}

interface StoredChunk {
  sessionId: string;
  seq: number;
  data: Blob;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class SessionStore {
  private db: Promise<IDBDatabase | null>;

  constructor() {
    this.db = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('sessions', { keyPath: 'meta.id' });
        const chunks = db.createObjectStore('chunks', { keyPath: ['sessionId', 'seq'] });
        chunks.createIndex('bySession', 'sessionId');
      };
      req.onsuccess = () => resolve(req.result);
      // Privémodus of geblokkeerde opslag: dan werken we gewoon zonder.
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  async putSession(session: StoredSession): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(session);
    await done(tx);
  }

  async putChunk(sessionId: string, seq: number, data: Blob): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').put({ sessionId, seq, data } satisfies StoredChunk);
    await done(tx);
  }

  async sessions(): Promise<StoredSession[]> {
    const db = await this.db;
    if (!db) return [];
    const tx = db.transaction('sessions', 'readonly');
    return promisify(tx.objectStore('sessions').getAll() as IDBRequest<StoredSession[]>);
  }

  async audio(sessionId: string, mimeType: string): Promise<Blob> {
    const db = await this.db;
    if (!db) return new Blob([], { type: mimeType });
    const tx = db.transaction('chunks', 'readonly');
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
    const chunks = await promisify(tx.objectStore('chunks').getAll(range) as IDBRequest<StoredChunk[]>);
    chunks.sort((a, b) => a.seq - b.seq);
    return new Blob(chunks.map((c) => c.data), { type: mimeType });
  }

  async remove(sessionId: string): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
    tx.objectStore('sessions').delete(sessionId);
    tx.objectStore('chunks').delete(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  }
}
