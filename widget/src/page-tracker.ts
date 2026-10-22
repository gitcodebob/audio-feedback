// Houdt bij welke pagina er tijdens de opname open stond. Single-page apps
// wisselen van URL zonder te herladen, dus naast popstate/hashchange kijken we
// elke seconde of location.href veranderd is. history.pushState patchen zou
// preciezer zijn, maar dat is ingrijpen in de app die ons insluit.

import type { TimelineEntry } from './types.ts';

export interface UrlOptions {
  stripQuery: boolean;
  stripHash: boolean;
  /** Queryparameters die ook met stripQuery blijven staan, zoals een tab of een modus. */
  keepParams: string[];
}

const MAX_URL_LENGTH = 2048;
const POLL_MS = 1_000;

export function cleanUrl(href: string, opts: UrlOptions): string {
  let out = href;
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

export class PageTracker {
  private last = '';
  private timer = 0;
  private readonly check = () => this.sample();
  private readonly opts: UrlOptions;
  private readonly now: () => number;
  private readonly onEntry: (entry: TimelineEntry) => void;

  constructor(opts: UrlOptions, now: () => number, onEntry: (entry: TimelineEntry) => void) {
    this.opts = opts;
    this.now = now;
    this.onEntry = onEntry;
  }

  currentUrl(): string {
    return cleanUrl(location.href, this.opts);
  }

  start(): void {
    this.last = this.currentUrl();
    window.addEventListener('popstate', this.check);
    window.addEventListener('hashchange', this.check);
    this.timer = window.setInterval(this.check, POLL_MS);
  }

  stop(): void {
    window.removeEventListener('popstate', this.check);
    window.removeEventListener('hashchange', this.check);
    window.clearInterval(this.timer);
  }

  private sample(): void {
    const url = this.currentUrl();
    if (url === this.last) return;
    this.last = url;
    this.onEntry({ at: this.now(), type: 'navigate', url, title: document.title });
  }
}
