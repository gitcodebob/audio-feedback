// Alles zit in een Shadow DOM, dus deze regels lekken niet naar de app en
// andersom. Alleen overerfbare eigenschappen (font, kleur) komen via de host
// binnen. De host krijgt inline all: initial, en dat wint ook van :host; daarom
// zetten .card en .pill zelf font en kleur.

export const css = /* css */ `
:host {
  all: initial;
  --af-bg: #ffffff;
  --af-fg: #1b1f24;
  --af-muted: #5b636e;
  --af-border: #d8dde3;
  --af-soft: #f1f3f5;
  --af-primary: #1f5fbf;
  --af-primary-fg: #ffffff;
  --af-record: #d0312d;
  --af-ok: #1e7f4f;
}
@media (prefers-color-scheme: dark) {
  :host {
    --af-bg: #1e2228;
    --af-fg: #e8ebef;
    --af-muted: #a3acb8;
    --af-border: #3a414b;
    --af-soft: #2a3038;
    --af-primary: #4c8ff0;
    --af-record: #ff5a52;
    --af-ok: #48c78e;
  }
}
@media print {
  :host { display: none !important; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.card, .pill {
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--af-fg);
  text-align: left;
  letter-spacing: normal;
}
.card {
  width: 288px;
  max-width: calc(100vw - 16px);
  background: var(--af-bg);
  border: 1px solid var(--af-border);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  background: var(--af-soft);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.head:active { cursor: grabbing; }
.title { flex: 1; font-weight: 600; font-size: 13px; }
.body { padding: 12px; display: grid; gap: 10px; }
.text { margin: 0; color: var(--af-muted); font-size: 13px; }
.text strong { color: var(--af-fg); }
.status { display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.time { font-size: 20px; font-weight: 600; }
.limit { color: var(--af-muted); font-size: 12px; }
.time.warn { color: var(--af-record); }

.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--af-record); flex: none; }
.dot.live { animation: af-pulse 1.2s ease-in-out infinite; }
.dot.paused { background: var(--af-muted); }
@keyframes af-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .dot.live { animation: none; } }

.meter { height: 6px; border-radius: 3px; background: var(--af-soft); overflow: hidden; }
.meter > i { display: block; height: 100%; width: 0; background: var(--af-ok); transition: width 80ms linear; }

.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > button { flex: 1; }
button {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--af-border);
  background: var(--af-bg);
  color: var(--af-fg);
  font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  white-space: nowrap;
}
button:hover { background: var(--af-soft); }
button:focus-visible { outline: 2px solid var(--af-primary); outline-offset: 2px; }
button:disabled { opacity: 0.55; cursor: default; }
button.primary { background: var(--af-primary); border-color: var(--af-primary); color: var(--af-primary-fg); }
button.record { background: var(--af-record); border-color: var(--af-record); color: #fff; }
button.primary:hover, button.record:hover { filter: brightness(1.08); }
button.icon { min-height: 28px; width: 28px; padding: 0; border-color: transparent; background: transparent; }
button.icon:hover { background: var(--af-border); }
svg { width: 16px; height: 16px; fill: currentColor; flex: none; }

audio { width: 100%; height: 36px; }
.pages { margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--af-muted); display: grid; gap: 2px; }
.pages li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ok { color: var(--af-ok); font-weight: 600; margin: 0; }
.error { color: var(--af-record); margin: 0; font-size: 13px; }

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--af-bg);
  border: 1px solid var(--af-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  font-variant-numeric: tabular-nums;
}
`;
