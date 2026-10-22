// Gedeeld tussen widget en server: wat er naast de audio wordt meegestuurd.

export interface TimelineEntry {
  /** Positie in de opname in ms (pauzes niet meegeteld). */
  at: number;
  type: 'start' | 'navigate' | 'pause' | 'resume' | 'stop';
  url?: string;
  title?: string;
}

export interface RecordingMeta {
  /** Door de client gekozen UUID; maakt opnieuw versturen veilig. */
  id: string;
  project: string;
  /** Wandkloktijd van de start, ISO 8601. */
  startedAt: string;
  durationMs: number;
  mimeType: string;
  /** De pagina waar de opname begon; latere navigatie staat in timeline. */
  url: string;
  title: string;
  timeline: TimelineEntry[];
  /** Vrije sleutel-waardeparen van de host-app, bijvoorbeeld een omgeving of versie. */
  context: Record<string, string>;
  client: {
    userAgent: string;
    language: string;
    viewport: { width: number; height: number };
    widgetVersion: string;
  };
  /** True als de opname na een afgebroken sessie (navigatie, crash) is teruggehaald. */
  recovered: boolean;
}
