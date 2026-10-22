// Alles in meta komt van een willekeurige browser. We nemen alleen over wat we
// kennen, in de vorm die we verwachten, en kappen lange strings af.

import type { RecordingMeta, TimelineEntry } from '../widget/src/types.ts';

export class ValidationError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TIMELINE_TYPES = new Set<TimelineEntry['type']>(['start', 'navigate', 'pause', 'resume', 'stop']);
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;

export const AUDIO_TYPES: Record<string, { ext: string; contentType: string }> = {
  'audio/webm': { ext: 'webm', contentType: 'audio/webm' },
  'audio/ogg': { ext: 'ogg', contentType: 'audio/ogg' },
  'audio/mp4': { ext: 'm4a', contentType: 'audio/mp4' },
};

function str(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function num(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function httpUrl(value: unknown): string {
  const s = str(value, 4096);
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return s;
  } catch {
    // valt door naar leeg
  }
  return '';
}

/** "audio/webm;codecs=opus" → "audio/webm", als we dat type kennen. */
export function baseAudioType(mimeType: string): string | null {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  // Chrome labelt een audio-only opname soms als video/webm.
  const normalized = base === 'video/webm' ? 'audio/webm' : base;
  return normalized in AUDIO_TYPES ? normalized : null;
}

/** Herkent het containerformaat aan de eerste bytes, los van wat de client beweert. */
export function sniffAudio(head: Uint8Array): string | null {
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'audio/webm';
  if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) return 'audio/ogg';
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'audio/mp4';
  return null;
}

export function parseMeta(raw: unknown): RecordingMeta {
  let m: Record<string, unknown>;
  try {
    m = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    throw new ValidationError('meta is geen geldige JSON');
  }
  if (!m || typeof m !== 'object') throw new ValidationError('meta ontbreekt');
  if (typeof m.id !== 'string' || !UUID.test(m.id)) throw new ValidationError('ongeldig id');
  if (typeof m.project !== 'string' || !PROJECT.test(m.project)) throw new ValidationError('ongeldige projectnaam');
  const url = httpUrl(m.url);
  if (!url) throw new ValidationError('url ontbreekt of is geen http(s)-adres');
  const mimeType = str(m.mimeType, 100);
  if (!baseAudioType(mimeType)) throw new ValidationError('onbekend audioformaat');

  const startedAt = new Date(str(m.startedAt, 40));
  const timeline: TimelineEntry[] = (Array.isArray(m.timeline) ? m.timeline : [])
    .slice(0, 2000)
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && TIMELINE_TYPES.has(e.type as TimelineEntry['type']))
    .map((e) => {
      const entry: TimelineEntry = { at: num(e.at, 0, MAX_DURATION_MS), type: e.type as TimelineEntry['type'] };
      const u = httpUrl(e.url);
      if (u) entry.url = u;
      if (typeof e.title === 'string') entry.title = str(e.title, 300);
      return entry;
    });

  const context: Record<string, string> = {};
  if (m.context && typeof m.context === 'object') {
    for (const [k, v] of Object.entries(m.context as Record<string, unknown>).slice(0, 50)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') context[k.slice(0, 100)] = String(v).slice(0, 1000);
    }
  }

  const client = (m.client && typeof m.client === 'object' ? m.client : {}) as Record<string, unknown>;
  const viewport = (client.viewport && typeof client.viewport === 'object' ? client.viewport : {}) as Record<string, unknown>;

  return {
    id: m.id.toLowerCase(),
    project: m.project,
    startedAt: Number.isNaN(startedAt.getTime()) ? new Date().toISOString() : startedAt.toISOString(),
    durationMs: num(m.durationMs, 0, MAX_DURATION_MS),
    mimeType,
    url,
    title: str(m.title, 300),
    timeline,
    context,
    client: {
      userAgent: str(client.userAgent, 500),
      language: str(client.language, 35),
      viewport: { width: num(viewport.width, 0, 100_000), height: num(viewport.height, 0, 100_000) },
      widgetVersion: str(client.widgetVersion, 20),
    },
    recovered: m.recovered === true,
  };
}
