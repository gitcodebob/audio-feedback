// Wat er van een adres overblijft voordat het wordt opgeslagen. Gedeeld door de widget
// (die het de gebruiker laat zien vóór het versturen) en de server (die het bij
// ontvangst nog eens toepast, zodat ook een oude widget niet meer opslaat dan mag).

/** Per site in te stellen in /admin/sites. */
export interface UrlOptions {
  stripQuery: boolean;
  stripHash: boolean;
  /** Queryparameters die ook met stripQuery blijven staan, zoals een tab of een modus. */
  keepParams: string[];
}

/** Als er niets bekend is over de site: alleen het pad. */
export const STRICT_URL_OPTIONS: UrlOptions = { stripQuery: true, stripHash: true, keepParams: [] };

const MAX_URL_LENGTH = 2048;

export function cleanUrl(href: string, opts: UrlOptions): string {
  let out: string;
  try {
    const u = new URL(href);
    if (opts.stripQuery) {
      const kept = new URLSearchParams();
      for (const [k, v] of u.searchParams) if (opts.keepParams.includes(k)) kept.append(k, v);
      u.search = kept.toString();
    }
    if (opts.stripHash) u.hash = '';
    out = u.toString();
  } catch {
    // Geen geldige URL: dan weten we ook niet wat er weg moet, dus niets meesturen.
    return '';
  }
  return out.length > MAX_URL_LENGTH ? out.slice(0, MAX_URL_LENGTH) + '…' : out;
}
