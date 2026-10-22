// Opnames staan als twee bestanden naast elkaar: <id>.<ext> met de audio en
// <id>.json met de metadata. De JSON wordt als laatste geschreven, dus zonder
// JSON is een opname niet compleet en tellen we hem niet mee.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecordingMeta } from '../widget/src/types.ts';

export interface StoredRecording extends RecordingMeta {
  receivedAt: string;
  origin: string;
  audioFile: string;
  audioType: string;
  sizeBytes: number;
}

const ID = /^[0-9a-f-]{36}$/;

export class Storage {
  readonly dir: string;
  private used = 0;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'recordings');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    this.used = (await this.list()).reduce((sum, r) => sum + r.sizeBytes, 0);
  }

  /** Audio van alle opnames samen, voor de bovengrens op de opslag. */
  get usedBytes(): number {
    return this.used;
  }

  async exists(id: string): Promise<boolean> {
    return stat(join(this.dir, `${id}.json`)).then(() => true, () => false);
  }

  /** Een Blob gaat als stream naar schijf, zonder er eerst nog een kopie van in het geheugen te maken. */
  async save(record: StoredRecording, audio: Blob | Uint8Array): Promise<void> {
    const audioPath = join(this.dir, record.audioFile);
    const metaPath = join(this.dir, `${record.id}.json`);
    const previous = await this.get(record.id);
    await writeFile(`${audioPath}.tmp`, audio instanceof Blob ? audio.stream() : audio);
    await rename(`${audioPath}.tmp`, audioPath);
    await writeFile(`${metaPath}.tmp`, JSON.stringify(record, null, 2));
    await rename(`${metaPath}.tmp`, metaPath);
    this.used += record.sizeBytes - (previous?.sizeBytes ?? 0);
  }

  async get(id: string): Promise<StoredRecording | null> {
    if (!ID.test(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as StoredRecording;
    } catch {
      return null;
    }
  }

  audioPath(record: StoredRecording): string {
    return join(this.dir, record.audioFile);
  }

  /** Nieuwste eerst. */
  async list(): Promise<StoredRecording[]> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const records = await Promise.all(files.map((f) => this.get(f.slice(0, -5))));
    return records
      .filter((r): r is StoredRecording => r !== null)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async remove(id: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    await rm(join(this.dir, `${id}.json`), { force: true });
    await rm(join(this.dir, record.audioFile), { force: true });
    this.used -= record.sizeBytes;
    return true;
  }

  /** Spraak is persoonsgegeven: opnames ouder dan de bewaartermijn gaan weg. */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const r of await this.list()) {
      if (Date.parse(r.receivedAt) < cutoff && (await this.remove(r.id))) removed++;
    }
    return removed;
  }
}
