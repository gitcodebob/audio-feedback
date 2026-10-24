// Gedeeld tussen widget en server: wat er naast de audio wordt meegestuurd.

/** Types die de widget zelf vastlegt. Al het andere komt van de app, via AudioFeedback.event(). */
export const WIDGET_EVENT_TYPES = ['start', 'navigate', 'pause', 'resume', 'stop'] as const;

/**
 * Eén gebeurtenis in de opname: een paginawissel van de widget, of iets dat de app meldt,
 * zoals een scherm of level. Beide hebben dezelfde vorm.
 */
export interface TimelineEntry {
  /**
   * Positie in de opname in ms (pauzes niet meegeteld). Negatief: zoveel ms vóór de start.
   * Zo gaat mee wat er gebeurde vlak voordat de gebruiker op Opnemen drukte.
   */
  at: number;
  /** Een van WIDGET_EVENT_TYPES, of een eigen type van de app, zoals "screen" of "level". */
  type: string;
  url?: string;
  title?: string;
  /** Korte omschrijving voor de beheerpagina, zoals "Level 3: Nuuk". */
  label?: string;
  /** Vrije sleutel-waardeparen van de app. */
  data?: Record<string, string>;
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
