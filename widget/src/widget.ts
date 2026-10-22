// Het zwevende kaartje en de toestandsmachine eromheen:
// idle → starting → recording ⇄ paused → review → uploading → sent.
// Een opname die nog niet verstuurd is (mislukte upload, of een pagina die
// tijdens het opnemen werd verlaten) komt bij het laden terug als "pending".

import { PageTracker } from './page-tracker.ts';
import { Recorder, RecorderError } from './recorder.ts';
import { SessionStore, type StoredSession } from './store.ts';
import { css } from './styles.ts';
import type { RecordingMeta, TimelineEntry } from './types.ts';
import { upload, UploadError } from './upload.ts';

export const VERSION = '0.1.0';

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface WidgetConfig {
  /** Basis-URL van de feedbackserver, zonder slash aan het eind. */
  endpoint: string;
  project: string;
  position: Corner;
  maxDurationSec: number;
  stripQuery: boolean;
  stripHash: boolean;
  startMinimized: boolean;
  context: Record<string, string>;
}

type View =
  | { name: 'idle' }
  | { name: 'starting' }
  | { name: 'recording' }
  | { name: 'paused' }
  | { name: 'review' }
  | { name: 'uploading' }
  | { name: 'sent' }
  | { name: 'pending' }
  | { name: 'error'; message: string; action: 'retry-upload' | 'back' | 'discard' };

/** Een tab die korter dan dit geleden nog schreef, neemt nog op; die opname is niet van ons. */
const HEARTBEAT_STALE_MS = 10_000;
const DRAG_THRESHOLD_PX = 4;
const MARGIN_PX = 16;

// Events die niet naar de app mogen doorlopen: een spel of editor met sneltoetsen
// op window ziet bij een Shadow DOM alleen de host als target, en zou anders
// spatie, Ctrl+Z en klikken op het kaartje als eigen invoer oppakken. pointerup en
// pointermove laten we bewust door, anders blijft een sleepactie van de app hangen.
const ISOLATED_EVENTS = [
  'keydown', 'keyup', 'keypress', 'pointerdown', 'mousedown', 'click',
  'dblclick', 'contextmenu', 'wheel', 'touchstart',
] as const;

const icons = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>',
  minimize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z"/></svg>',
};

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname + u.search + u.hash) || '/';
  } catch {
    return url;
  }
}

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface Anchor {
  h: 'left' | 'right';
  v: 'top' | 'bottom';
  x: number;
  y: number;
}

export class FeedbackWidget {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly store = new SessionStore();
  private recorder: Recorder | null = null;
  private tracker: PageTracker | null = null;
  private view: View = { name: 'idle' };
  private minimized: boolean;
  private session: StoredSession | null = null;
  private chunks: Blob[] = [];
  private seq = 0;
  private audioUrl = '';
  private ticker = 0;
  private sentTimer = 0;
  private context: Record<string, string>;
  private readonly storageKey: string;
  private readonly config: WidgetConfig;
  private releaseLock: (() => void) | null = null;

  constructor(config: WidgetConfig) {
    this.config = config;
    this.context = { ...config.context };
    this.storageKey = `audio-feedback:${config.project}`;
    this.minimized = this.loadPref('minimized') ?? config.startMinimized;

    this.host = document.createElement('audio-feedback-widget');
    this.host.setAttribute('data-version', VERSION);
    for (const [k, v] of Object.entries({ all: 'initial', position: 'fixed', 'z-index': '2147483000' })) {
      this.host.style.setProperty(k, v, 'important');
    }
    for (const type of ISOLATED_EVENTS) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.addEventListener('click', (e) => this.onClick(e as MouseEvent));
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e as PointerEvent));

    document.body.appendChild(this.host);
    this.applyAnchor(this.loadPref<Anchor>('anchor') ?? this.defaultAnchor());
    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.render();
    void this.checkPending();
    // Bij een herlaadactie kan de lock van de vorige pagina er net nog zijn.
    window.setTimeout(() => void this.checkPending(), 3_000);
  }

  setContext(values: Record<string, string>): void {
    Object.assign(this.context, values);
  }

  open(): void {
    this.setMinimized(false);
  }

  minimize(): void {
    this.setMinimized(true);
  }

  destroy(): void {
    void this.recorder?.stop();
    this.tracker?.stop();
    window.clearInterval(this.ticker);
    window.clearTimeout(this.sentTimer);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.releaseLock?.();
    this.host.remove();
  }

  // --- toestanden ---------------------------------------------------------

  /**
   * Een opname is van de tab die zijn Web Lock vasthoudt, van start tot versturen.
   * De browser laat die lock los als de pagina weggaat, dus een vrije lock op een
   * opname die nog "recording" heet, betekent: afgebroken, en nu van ons.
   */
  private claim(id: string): Promise<(() => void) | null> {
    const noop = () => {};
    if (!navigator.locks) return Promise.resolve(noop);
    return new Promise((resolve) => {
      navigator.locks
        .request(`audio-feedback:${id}`, { ifAvailable: true }, (lock) => {
          if (!lock) return resolve(null);
          return new Promise<void>((release) => resolve(release));
        })
        .catch(() => resolve(noop));
    });
  }

  private hold(release: () => void): void {
    this.releaseLock?.();
    this.releaseLock = release;
  }

  private async checkPending(): Promise<void> {
    if (this.view.name !== 'idle' || this.session) return;
    const now = Date.now();
    const candidates = (await this.store.sessions().catch(() => []))
      .filter((s) => s.meta.project === this.config.project)
      // Zonder Web Locks valt alleen op de hartslag te zien of een andere tab nog bezig is.
      .filter((s) => navigator.locks || s.status === 'ready' || now - s.heartbeat > HEARTBEAT_STALE_MS)
      .sort((a, b) => a.meta.startedAt.localeCompare(b.meta.startedAt));
    let found: StoredSession | undefined;
    let release: (() => void) | null = null;
    for (const c of candidates) {
      release = await this.claim(c.meta.id);
      if (release) {
        found = c;
        break;
      }
    }
    if (!found || !release) return;
    // Intussen op Opnemen gedrukt: dan blijft deze opname liggen voor later.
    if (this.view.name !== 'idle' || this.session) return release();
    this.hold(release);
    if (found.status === 'recording') {
      found.status = 'ready';
      found.meta.recovered = true;
      found.meta.timeline.push({ at: found.meta.durationMs, type: 'stop' });
    }
    if (found.meta.durationMs <= 0) {
      await this.store.remove(found.meta.id).catch(() => {});
      return;
    }
    this.session = found;
    this.chunks = [await this.store.audio(found.meta.id, found.meta.mimeType)];
    void this.store.putSession(found).catch(() => {});
    this.setView({ name: 'pending' });
  }

  private async startRecording(): Promise<void> {
    this.setView({ name: 'starting' });
    const recorder = new Recorder();
    try {
      await recorder.start();
    } catch (err) {
      const message = err instanceof RecorderError ? err.message : 'De opname kon niet starten.';
      this.setView({ name: 'error', message, action: 'back' });
      return;
    }
    this.recorder = recorder;
    recorder.onInterrupted = () => void this.stop();
    this.chunks = [];
    this.seq = 0;

    const meta: RecordingMeta = {
      id: uuid(),
      project: this.config.project,
      startedAt: new Date().toISOString(),
      durationMs: 0,
      mimeType: recorder.mimeType,
      url: '',
      title: document.title,
      timeline: [],
      context: { ...this.context },
      client: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        widgetVersion: VERSION,
      },
      recovered: false,
    };
    this.session = { meta, status: 'recording', heartbeat: Date.now() };
    const release = await this.claim(meta.id);
    if (release) this.hold(release);
    this.tracker = new PageTracker(
      { stripQuery: this.config.stripQuery, stripHash: this.config.stripHash },
      () => recorder.elapsedMs(),
      (entry) => this.addTimeline(entry),
    );
    meta.url = this.tracker.currentUrl();
    meta.timeline.push({ at: 0, type: 'start', url: meta.url, title: meta.title });
    this.tracker.start();

    recorder.onChunk = (chunk) => {
      this.chunks.push(chunk);
      const session = this.session;
      if (!session || session.meta.id !== meta.id) return;
      session.meta.durationMs = recorder.elapsedMs();
      session.heartbeat = Date.now();
      void this.store.putChunk(meta.id, this.seq++, chunk).catch(() => {});
      void this.store.putSession(session).catch(() => {});
    };
    void this.store.putSession(this.session).catch(() => {});

    this.ticker = window.setInterval(() => this.tick(), 100);
    this.setView({ name: 'recording' });
  }

  private addTimeline(entry: TimelineEntry): void {
    if (!this.session) return;
    this.session.meta.timeline.push(entry);
    void this.store.putSession(this.session).catch(() => {});
  }

  private pause(): void {
    if (!this.recorder) return;
    this.recorder.pause();
    this.addTimeline({ at: this.recorder.elapsedMs(), type: 'pause' });
    this.setView({ name: 'paused' });
  }

  private resume(): void {
    if (!this.recorder) return;
    this.recorder.resume();
    this.addTimeline({ at: this.recorder.elapsedMs(), type: 'resume' });
    this.setView({ name: 'recording' });
  }

  private async stop(): Promise<void> {
    const recorder = this.recorder;
    const session = this.session;
    if (!recorder || !session) return;
    window.clearInterval(this.ticker);
    this.tracker?.stop();
    this.tracker = null;
    await recorder.stop();
    this.recorder = null;
    session.meta.durationMs = recorder.elapsedMs();
    session.meta.timeline.push({ at: session.meta.durationMs, type: 'stop' });
    session.status = 'ready';
    void this.store.putSession(session).catch(() => {});
    this.setView({ name: 'review' });
  }

  private async send(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.setView({ name: 'uploading' });
    const audio = new Blob(this.chunks, { type: session.meta.mimeType });
    try {
      await upload(this.config.endpoint, { ...session.meta, context: { ...session.meta.context } }, audio);
    } catch (err) {
      const e = err instanceof UploadError ? err : new UploadError('Versturen lukte niet.', true);
      this.setView({ name: 'error', message: e.message, action: e.retryable ? 'retry-upload' : 'discard' });
      return;
    }
    await this.store.remove(session.meta.id).catch(() => {});
    this.clearSession();
    this.setView({ name: 'sent' });
    this.sentTimer = window.setTimeout(() => {
      if (this.view.name !== 'sent') return;
      this.setView({ name: 'idle' });
      void this.checkPending();
    }, 4_000);
  }

  private async discard(): Promise<void> {
    if (this.recorder) {
      window.clearInterval(this.ticker);
      this.tracker?.stop();
      this.tracker = null;
      await this.recorder.stop();
      this.recorder = null;
    }
    if (this.session) await this.store.remove(this.session.meta.id).catch(() => {});
    this.clearSession();
    this.setView({ name: 'idle' });
    void this.checkPending();
  }

  private clearSession(): void {
    this.releaseLock?.();
    this.releaseLock = null;
    this.session = null;
    this.chunks = [];
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = '';
  }

  private tick(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    const elapsed = recorder.elapsedMs();
    if (elapsed >= this.config.maxDurationSec * 1000 && recorder.state === 'recording') {
      void this.stop();
      return;
    }
    // Ook tijdens een pauze (dan komen er geen stukjes binnen) laten we zien dat we leven.
    const session = this.session;
    if (session && Date.now() - session.heartbeat > HEARTBEAT_STALE_MS / 3) {
      session.heartbeat = Date.now();
      void this.store.putSession(session).catch(() => {});
    }
    const left = this.config.maxDurationSec * 1000 - elapsed;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-time]')) {
      el.textContent = formatTime(elapsed);
      el.classList.toggle('warn', left <= 30_000);
    }
    const meter = this.root.querySelector<HTMLElement>('[data-meter]');
    if (meter) meter.style.width = `${Math.round(recorder.level() * 100)}%`;
  }

  // --- weergave -----------------------------------------------------------

  private setView(view: View): void {
    // Wie met het toetsenbord bedient, houdt focus in het kaartje na een wissel.
    const hadFocus = this.root.activeElement !== null;
    this.view = view;
    this.render();
    if (hadFocus) this.root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  private setMinimized(value: boolean): void {
    this.minimized = value;
    this.savePref('minimized', value);
    this.render();
  }

  private render(): void {
    const v = this.view;
    const busy = v.name === 'recording' || v.name === 'paused';
    const elapsed = this.recorder?.elapsedMs() ?? this.session?.meta.durationMs ?? 0;

    if (this.minimized) {
      const dot = busy ? `<span class="dot ${v.name === 'paused' ? 'paused' : 'live'}"></span>` : icons.mic;
      const label = busy ? `<span class="time" data-time style="font-size:14px">${formatTime(elapsed)}</span>` : 'Feedback inspreken';
      this.root.innerHTML = `<style>${css}</style>
        <button class="pill" data-action="expand" data-drag data-autofocus
          aria-label="Feedback-kaartje openen${busy ? ', opname loopt' : ''}">${dot}${label}</button>`;
      this.clampToViewport();
      return;
    }

    this.root.innerHTML = `<style>${css}</style>
      <section class="card" role="region" aria-label="Feedback inspreken">
        <div class="head" data-drag>
          <span class="title">Feedback inspreken</span>
          <button class="icon" data-action="minimize" title="Minimaliseren" aria-label="Minimaliseren">${icons.minimize}</button>
        </div>
        <div class="body" aria-live="polite">${this.renderBody(v, elapsed)}</div>
      </section>`;

    if (v.name === 'review' || v.name === 'pending') {
      const audio = this.root.querySelector('audio');
      if (audio) {
        if (!this.audioUrl) {
          this.audioUrl = URL.createObjectURL(new Blob(this.chunks, { type: this.session?.meta.mimeType }));
        }
        audio.src = this.audioUrl;
      }
    }
    this.clampToViewport();
  }

  private renderBody(v: View, elapsed: number): string {
    const max = formatTime(this.config.maxDurationSec * 1000);
    switch (v.name) {
      case 'idle':
        return `<p class="text">Vertel wat je ziet of ervaart. We sturen je opname mee met het adres van deze pagina, niet wat er op je scherm staat.</p>
          <div class="row"><button class="record" data-action="record" data-autofocus>${icons.mic}Opnemen</button></div>`;
      case 'starting':
        return `<p class="text">Microfoon wordt gestart… Sta de microfoon toe als je browser erom vraagt.</p>`;
      case 'recording':
      case 'paused': {
        const live = v.name === 'recording';
        return `<div class="status">
            <span class="dot ${live ? 'live' : 'paused'}"></span>
            <span class="time" data-time>${formatTime(elapsed)}</span>
            <span class="limit">/ ${max}${live ? '' : ' · gepauzeerd'}</span>
          </div>
          <div class="meter" aria-hidden="true"><i data-meter></i></div>
          <div class="row">
            ${live
              ? `<button data-action="pause" data-autofocus>${icons.pause}Pauzeren</button>`
              : `<button class="record" data-action="resume" data-autofocus>${icons.play}Hervatten</button>`}
            <button data-action="stop">${icons.stop}Stoppen</button>
          </div>`;
      }
      case 'review':
      case 'pending': {
        const intro = v.name === 'pending'
          ? `<p class="text"><strong>Er staat nog een opname klaar</strong> van ${formatTime(elapsed)} die niet is verstuurd.</p>`
          : `<p class="text">Luister eventueel terug en verstuur je feedback.</p>`;
        return `${intro}
          <audio controls preload="metadata"></audio>
          ${this.renderPages()}
          <div class="row">
            <button data-action="discard">Weggooien</button>
            <button class="primary" data-action="send" data-autofocus>Versturen</button>
          </div>`;
      }
      case 'uploading':
        return `<p class="text">Versturen…</p>`;
      case 'sent':
        return `<p class="ok">Bedankt! Je feedback is verstuurd.</p>
          <div class="row"><button data-action="new" data-autofocus>Nog een opname</button></div>`;
      case 'error': {
        const buttons = {
          'retry-upload': `<button data-action="later">Later</button><button class="primary" data-action="send" data-autofocus>Opnieuw proberen</button>`,
          discard: `<button data-action="discard" data-autofocus>Weggooien</button>`,
          back: `<button data-action="back" data-autofocus>Terug</button>`,
        }[v.action];
        return `<p class="error" role="alert">${escapeHtml(v.message)}</p><div class="row">${buttons}</div>`;
      }
    }
  }

  private renderPages(): string {
    const urls = [...new Set((this.session?.meta.timeline ?? []).filter((e) => e.url).map((e) => e.url!))];
    if (urls.length === 0) return '';
    const shown = urls.slice(0, 3).map((u) => `<li title="${escapeHtml(u)}">${escapeHtml(shortUrl(u))}</li>`).join('');
    const more = urls.length > 3 ? `<li>en ${urls.length - 3} meer</li>` : '';
    return `<ul class="pages" aria-label="Pagina's die worden meegestuurd">${shown}${more}</ul>`;
  }

  private onClick(e: MouseEvent): void {
    const button = (e.target as Element).closest<HTMLElement>('[data-action]');
    if (!button || this.dragMoved) return;
    // Na een muisklik de focus loslaten: anders gaat de volgende spatie in het
    // spel naar onze knop (en zou die bijvoorbeeld pauzeren).
    if (e.detail > 0) button.blur();
    switch (button.dataset.action) {
      case 'record':
      case 'new':
        window.clearTimeout(this.sentTimer);
        void this.startRecording();
        break;
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'stop': void this.stop(); break;
      case 'send': void this.send(); break;
      case 'discard': void this.discard(); break;
      case 'later':
        // Blijft in IndexedDB staan; bij het volgende laden bieden we hem opnieuw aan.
        this.clearSession();
        this.setView({ name: 'idle' });
        break;
      case 'back': this.setView({ name: 'idle' }); break;
      case 'minimize': this.setMinimized(true); break;
      case 'expand': this.setMinimized(false); break;
    }
  }

  // --- positie en slepen --------------------------------------------------

  private anchor: Anchor = { h: 'right', v: 'bottom', x: MARGIN_PX, y: MARGIN_PX };
  private dragMoved = false;

  private defaultAnchor(): Anchor {
    const [v, h] = this.config.position.split('-') as [Anchor['v'], Anchor['h']];
    return { h, v, x: MARGIN_PX, y: MARGIN_PX };
  }

  private applyAnchor(a: Anchor): void {
    this.anchor = a;
    const s = this.host.style;
    for (const side of ['left', 'right', 'top', 'bottom']) s.removeProperty(side);
    s.setProperty(a.h, `${Math.round(a.x)}px`, 'important');
    s.setProperty(a.v, `${Math.round(a.y)}px`, 'important');
  }

  private clampToViewport(): void {
    const { width, height } = this.host.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - height);
    const a = this.anchor;
    this.applyAnchor({ ...a, x: Math.min(Math.max(0, a.x), maxX), y: Math.min(Math.max(0, a.y), maxY) });
  }

  private readonly onResize = () => this.clampToViewport();

  private onPointerDown(e: PointerEvent): void {
    const handle = (e.target as Element).closest('[data-drag]');
    if (!handle || e.button !== 0) return;
    // Op de minimaliseerknop in de kop drukken is klikken, geen slepen.
    if ((e.target as Element).closest('[data-action]') && handle.matches('.head')) return;
    const start = this.host.getBoundingClientRect();
    const dx = e.clientX - start.left;
    const dy = e.clientY - start.top;
    const sx = e.clientX;
    const sy = e.clientY;
    this.dragMoved = false;

    const move = (ev: PointerEvent) => {
      if (!this.dragMoved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD_PX) return;
      this.dragMoved = true;
      const left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - start.width);
      const top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - start.height);
      // Verankeren aan de dichtstbijzijnde hoek: dan groeit het kaartje bij
      // openklappen van de rand af in plaats van eroverheen.
      const right = window.innerWidth - left - start.width;
      const bottom = window.innerHeight - top - start.height;
      this.applyAnchor({
        h: left <= right ? 'left' : 'right',
        v: top <= bottom ? 'top' : 'bottom',
        x: left <= right ? left : right,
        y: top <= bottom ? top : bottom,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (this.dragMoved) {
        this.savePref('anchor', this.anchor);
        // De click die na het loslaten komt, hoort bij het slepen.
        setTimeout(() => (this.dragMoved = false), 0);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // --- overig -------------------------------------------------------------

  private readonly onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.view.name !== 'recording' && this.view.name !== 'paused') return;
    // Wat er al is opgenomen staat in IndexedDB, maar een lopende opname
    // afbreken verrast mensen. De browser toont zijn eigen tekst.
    e.preventDefault();
    e.returnValue = '';
  };

  private loadPref<T>(key: string): T | undefined {
    try {
      const raw = localStorage.getItem(`${this.storageKey}:${key}`);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  private savePref(key: string, value: unknown): void {
    try {
      localStorage.setItem(`${this.storageKey}:${key}`, JSON.stringify(value));
    } catch {
      // Geen opslag (privémodus): dan onthouden we het niet.
    }
  }
}
