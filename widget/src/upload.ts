import type { RecordingMeta } from './types.ts';

export class UploadError extends Error {
  /** False bij een definitieve weigering (ongeldig, te groot): opnieuw proberen helpt dan niet. */
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

/** Een multipart POST zonder eigen headers is een "simple request": geen CORS-preflight nodig. */
export async function upload(endpoint: string, meta: RecordingMeta, audio: Blob): Promise<void> {
  const body = new FormData();
  body.append('meta', JSON.stringify(meta));
  body.append('audio', audio, `${meta.id}.${extensionFor(meta.mimeType)}`);

  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/recordings`, {
      method: 'POST',
      body,
      credentials: 'omit',
      mode: 'cors',
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new UploadError('Versturen lukte niet. Controleer je verbinding en probeer het opnieuw.', true);
  }
  if (res.ok) return;
  if (res.status === 413) throw new UploadError('De opname is te groot om te versturen.', false);
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    const detail = await res.json().then((j: { error?: string }) => j.error, () => undefined);
    throw new UploadError(`De server weigerde de opname${detail ? `: ${detail}` : ''}.`, false);
  }
  throw new UploadError('De server is even niet bereikbaar. Probeer het straks opnieuw.', true);
}
