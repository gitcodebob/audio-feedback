// Events van de app (AudioFeedback.event) en de buffer van vlak vóór de start. Gedeeld
// door de widget (die invoer van de app controleert) en de server (die alles nog eens
// controleert, want meta komt van een willekeurige browser).

import { WIDGET_EVENT_TYPES, type TimelineEntry } from './types.ts';

export const EVENT_TYPE = /^[A-Za-z][A-Za-z0-9._:-]{0,49}$/;
export const MAX_LABEL = 200;
const MAX_DATA_KEYS = 20;
const MAX_DATA_KEY = 50;
const MAX_DATA_VALUE = 500;
/** Zo ver terug gaat de buffer: wat er gebeurde vlak voordat de gebruiker op Opnemen drukte. */
export const BUFFER_MS = 30_000;
const BUFFER_MAX = 50;
/** Events van de app per opname. Een app die in een lus meldt, vult anders IndexedDB en de upload. */
export const MAX_APP_EVENTS = 500;

/** Een event zonder positie: die krijgt het pas als duidelijk is waar in de opname het valt. */
export type PendingEntry = Omit<TimelineEntry, 'at'>;

export function isWidgetType(type: string): boolean {
  return (WIDGET_EVENT_TYPES as readonly string[]).includes(type);
}

/** Platte sleutel-waardeparen; wat geen tekst, getal of boolean is, valt weg. */
export function cleanData(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_DATA_KEYS)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k.slice(0, MAX_DATA_KEY)] = String(v).slice(0, MAX_DATA_VALUE);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Controleert wat de app meldt: het event, of de reden waarom het niet mee kan. */
export function appEvent(type: unknown, label?: unknown, data?: unknown): PendingEntry | string {
  if (typeof type !== 'string' || !EVENT_TYPE.test(type)) {
    return `type moet beginnen met een letter, met daarna letters, cijfers of . _ : - (hooguit 50 tekens)`;
  }
  if (isWidgetType(type)) return `type "${type}" is van de widget zelf`;
  const entry: PendingEntry = { type };
  if (typeof label === 'string' && label) entry.label = label.slice(0, MAX_LABEL);
  const d = cleanData(data);
  if (d) entry.data = d;
  return entry;
}

/**
 * Houdt de events van de laatste BUFFER_MS bij, alleen in het geheugen. Ze gaan pas mee
 * als de gebruiker een opname start (en daarna verstuurt); anders vallen ze er vanzelf af.
 */
export class EventBuffer {
  /** True zodra de app een event gemeld heeft; dan noemt het kaartje dat vooraf. */
  fromApp = false;
  private items: { time: number; entry: PendingEntry }[] = [];
  private readonly clock: () => number;

  constructor(clock: () => number = () => performance.now()) {
    this.clock = clock;
  }

  push(entry: PendingEntry): void {
    this.items.push({ time: this.clock(), entry });
    this.prune();
  }

  /** Haalt de buffer leeg; at is negatief, het aantal ms vóór nu. */
  take(): TimelineEntry[] {
    this.prune();
    const now = this.clock();
    const out = this.items.map(({ time, entry }) => ({ at: -Math.round(now - time) || 0, ...entry }));
    this.items = [];
    return out;
  }

  private prune(): void {
    const cutoff = this.clock() - BUFFER_MS;
    this.items = this.items.filter((i) => i.time >= cutoff).slice(-BUFFER_MAX);
  }
}
