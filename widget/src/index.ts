// Ingang van widget.js. Eén scripttag is genoeg:
//
//   <script src="https://feedback.example/widget.js" data-project="mijn-app" defer></script>
//
// Instellingen komen uit data-attributen op die tag, of uit window.AudioFeedbackConfig
// als die vóór het script staat. Met data-manual start er niets vanzelf en roept de
// app zelf AudioFeedback.init({...}) aan.

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
  if (d.stripQuery !== undefined) out.stripQuery = flag(d.stripQuery);
  if (d.stripHash !== undefined) out.stripHash = flag(d.stripHash);
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

function resolveConfig(options: InitOptions): WidgetConfig {
  const max = Number(options.maxDurationSec);
  const context: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.context ?? {})) context[String(k)] = String(v);
  return {
    endpoint: (options.endpoint ?? defaultEndpoint()).replace(/\/+$/, ''),
    project: options.project || location.hostname || 'onbekend',
    position: options.position ?? 'bottom-right',
    maxDurationSec: Number.isFinite(max) && max > 0 ? Math.min(max, MAX_DURATION_CAP_SEC) : 10 * 60,
    stripQuery: options.stripQuery ?? false,
    stripHash: options.stripHash ?? false,
    startMinimized: options.startMinimized ?? false,
    context,
  };
}

let instance: FeedbackWidget | null = null;
// setContext vóór init (of vóór DOMContentLoaded) mag niet verloren gaan.
const pendingContext: Record<string, string> = {};

function init(options: InitOptions = {}): FeedbackWidget | null {
  const merged: InitOptions = { ...window.AudioFeedbackConfig, ...fromScriptTag(), ...options };
  // Geautomatiseerde tests en screenshots van de host-app laten we met rust.
  if (navigator.webdriver && !merged.allowWebdriver) return null;
  if (merged.hosts?.length && !merged.hosts.includes(location.hostname.toLowerCase())) return null;
  instance?.destroy();
  merged.context = { ...merged.context, ...pendingContext };
  const start = () => (instance = new FeedbackWidget(resolveConfig(merged)));
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
    destroy: () => {
      instance?.destroy();
      instance = null;
    },
  };
  const manual = flag(script?.dataset.manual) ?? false;
  if (!manual) init();
}
