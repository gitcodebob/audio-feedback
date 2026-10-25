// Ingang van widget.js. Eén scripttag is genoeg:
//
//   <script src="https://feedback.example/widget.js" data-project="mijn-app" async></script>
//
// Instellingen komen uit data-attributen op die tag, of uit window.AudioFeedbackConfig
// als die vóór het script staat. Met data-manual start er niets vanzelf en roept de
// app zelf AudioFeedback.init({...}) aan.

import { appEvent, EventBuffer } from './events.ts';
import { SessionStore } from './store.ts';
import { FeedbackWidget, VERSION, type Corner, type WidgetConfig } from './widget.ts';

interface InitOptions extends Partial<WidgetConfig> {
  /** Ook tonen als de browser door een testtool wordt bestuurd (navigator.webdriver). */
  allowWebdriver?: boolean;
  /** Alleen tonen op deze hostnamen, zodat een devserver op localhost geen kaartje krijgt. */
  hosts?: string[];
}

interface AudioFeedbackApi {
  version: string;
  init(options?: InitOptions): FeedbackWidget | null;
  open(): void;
  minimize(): void;
  setContext(values: Record<string, string>): void;
  /**
   * Meldt iets uit de app, zoals een scherm of level. Tijdens een opname komt het op die plek
   * in de tijdlijn; daarbuiten bewaart de widget de laatste halve minuut, die meegaat als de
   * gebruiker op Opnemen drukt. Er gaat pas iets naar de server als de gebruiker verstuurt.
   */
  event(type: string, label?: string, data?: Record<string, string | number | boolean>): void;
  /** Gooit alle opnames weg die nog in deze browser staan, ook een lopende. Roep dit aan bij uitloggen. */
  clear(): Promise<void>;
  destroy(): void;
}

declare global {
  interface Window {
    AudioFeedback?: AudioFeedbackApi;
    AudioFeedbackConfig?: InitOptions;
  }
}

const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const MAX_DURATION_CAP_SEC = 30 * 60; // houdt een opname ruim onder de 10 MB van de proxy

// currentScript bestaat alleen tijdens het eerste uitvoeren, dus nu vastpakken.
const script = document.currentScript as HTMLScriptElement | null;

function flag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === '' || value === 'true' || value === '1';
}

function fromScriptTag(): InitOptions {
  if (!script) return {};
  const d = script.dataset;
  const out: InitOptions = {};
  if (d.endpoint) out.endpoint = d.endpoint;
  if (d.project) out.project = d.project;
  if (d.position && (CORNERS as string[]).includes(d.position)) out.position = d.position as Corner;
  if (d.maxDuration) out.maxDurationSec = Number(d.maxDuration);
  if (d.privacyUrl) out.privacyUrl = d.privacyUrl;
  if (d.minimized !== undefined) out.startMinimized = flag(d.minimized);
  if (d.allowWebdriver !== undefined) out.allowWebdriver = flag(d.allowWebdriver);
  if (d.hosts) out.hosts = d.hosts.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (d.context) {
    try {
      out.context = JSON.parse(d.context);
    } catch {
      console.warn('[audio-feedback] data-context is geen geldige JSON en wordt genegeerd');
    }
  }
  return out;
}

function defaultEndpoint(): string {
  try {
    if (script?.src) return new URL(script.src).origin;
  } catch {
    // Valt terug op de eigen origin.
  }
  return location.origin;
}

function httpUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const u = new URL(value, location.href);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch {
    // Valt door naar leeg.
  }
  console.warn('[audio-feedback] data-privacy-url is geen http(s)-adres en wordt genegeerd');
  return '';
}

function resolveConfig(options: InitOptions): WidgetConfig {
  const max = Number(options.maxDurationSec);
  const context: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.context ?? {})) context[String(k)] = String(v);
  return {
    endpoint: (options.endpoint ?? defaultEndpoint()).replace(/\/+$/, ''),
    project: options.project || location.hostname || 'onbekend',
    position: options.position ?? 'bottom-right',
    maxDurationSec: Number.isFinite(max) && max > 0 ? Math.min(max, MAX_DURATION_CAP_SEC) : 10 * 60,
    privacyUrl: httpUrl(options.privacyUrl),
    startMinimized: options.startMinimized ?? false,
    context,
  };
}

let instance: FeedbackWidget | null = null;
// setContext vóór init (of vóór DOMContentLoaded) mag niet verloren gaan.
const pendingContext: Record<string, string> = {};
// Events van vóór init gaan ook in de buffer; die blijft bij een nieuwe init dezelfde.
const events = new EventBuffer();

function init(options: InitOptions = {}): FeedbackWidget | null {
  const merged: InitOptions = { ...window.AudioFeedbackConfig, ...fromScriptTag(), ...options };
  // Geautomatiseerde tests en screenshots van de host-app laten we met rust.
  if (navigator.webdriver && !merged.allowWebdriver) return null;
  if (merged.hosts?.length && !merged.hosts.includes(location.hostname.toLowerCase())) return null;
  instance?.destroy();
  merged.context = { ...merged.context, ...pendingContext };
  const start = () => (instance = new FeedbackWidget(resolveConfig(merged), events));
  if (document.body) return start();
  document.addEventListener('DOMContentLoaded', start, { once: true });
  return null;
}

if (!window.AudioFeedback) {
  window.AudioFeedback = {
    version: VERSION,
    init,
    open: () => instance?.open(),
    minimize: () => instance?.minimize(),
    setContext: (values) => {
      Object.assign(pendingContext, values);
      instance?.setContext(values);
    },
    event: (type, label, data) => {
      const entry = appEvent(type, label, data);
      if (typeof entry === 'string') return console.warn(`[audio-feedback] event genegeerd: ${entry}`);
      if (instance) return instance.event(entry);
      events.fromApp = true;
      events.push(entry);
    },
    // Ook zonder kaartje (andere host, nog niet gestart): de opslag is van de origin, niet van de widget.
    clear: () => (instance ? instance.clear() : new SessionStore().clear().catch(() => {})),
    destroy: () => {
      instance?.destroy();
      instance = null;
    },
  };
  const manual = flag(script?.dataset.manual) ?? false;
  if (!manual) init();
}
