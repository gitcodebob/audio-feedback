// Alles zit in een Shadow DOM, dus deze regels lekken niet naar de app en
// andersom. Alleen overerfbare eigenschappen (font, kleur) komen via de host
// binnen. De host krijgt inline all: initial, en dat wint ook van :host; daarom
// zetten .card en .pill zelf font en kleur.
//
// Huisstijl naar topicus.nl: geel en donkerblauw, Montserrat, pilvormige knoppen
// die bij hover van onderen vollopen met de andere kleur.

export const FONT_FAMILY = 'AF Montserrat';

export const css = /* css */ `
:host {
  all: initial;
  --af-yellow: #f8e800;
  --af-darkblue: #242f36;
  --af-bg: #ffffff;
  --af-head: var(--af-darkblue);
  --af-head-fg: #ffffff;
  --af-fg: #3c3c3c;
  --af-muted: #77818b;
  --af-soft: #f6f8fa;
  --af-line: #eaedf0;
  --af-secondary: var(--af-darkblue);
  --af-secondary-fg: #ffffff;
  --af-record: #d0021b;
  --af-ok: #3f8a10;
  --af-focus: var(--af-darkblue);
}
@media (prefers-color-scheme: dark) {
  :host {
    --af-bg: #242f36;
    --af-head: #1a2227;
    --af-fg: #ffffff;
    --af-muted: #b3bcc4;
    --af-soft: #2e3b43;
    --af-line: #3a4852;
    --af-secondary: #3a4852;
    --af-record: #ff5a5f;
    --af-ok: #7ed321;
    --af-focus: var(--af-yellow);
  }
}
@media print {
  :host { display: none !important; }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.card, .pill {
  font: 500 14px/1.5 "${FONT_FAMILY}", Montserrat, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--af-fg);
  text-align: left;
  letter-spacing: normal;
}
.card {
  width: 300px;
  max-width: calc(100vw - 16px);
  background: var(--af-bg);
  border-radius: 16px;
  box-shadow: 1px 10px 40px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 16px;
  background: var(--af-head);
  color: var(--af-head-fg);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.head:active { cursor: grabbing; }
.head::before {
  content: "";
  width: 4px;
  height: 18px;
  border-radius: 2px;
  background: var(--af-yellow);
  flex: none;
}
.title { flex: 1; font-weight: 600; font-size: 14px; }
.body { padding: 16px; display: grid; gap: 12px; }
.text { margin: 0; color: var(--af-muted); font-size: 13px; font-weight: 400; }
.text strong { color: var(--af-fg); font-weight: 600; }
.text a { color: var(--af-fg); text-decoration: underline; text-underline-offset: 2px; }
.text a:focus-visible { outline: 2px solid var(--af-focus); outline-offset: 2px; border-radius: 2px; }
.code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: 0.02em; }
.status { display: flex; align-items: baseline; gap: 8px; font-variant-numeric: tabular-nums; }
.time { font-size: 24px; font-weight: 600; line-height: 1; }
.limit { color: var(--af-muted); font-size: 12px; }
.time.warn { color: var(--af-record); }

.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--af-record); flex: none; align-self: center; }
.dot.live { animation: af-pulse 1.2s ease-in-out infinite; }
.dot.paused { background: var(--af-muted); }
@keyframes af-pulse { 50% { opacity: 0.3; } }

.meter { height: 6px; border-radius: 3px; background: var(--af-line); overflow: hidden; }
.meter > i { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--af-yellow); transition: width 80ms linear; }

.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > button { flex: 1; }

/* Knop: de hoverkleur ligt als tweede helft van een verloop klaar en schuift van onderen in beeld. */
button {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 18px;
  border-radius: 999px;
  --b: var(--af-secondary);
  --b-fg: var(--af-secondary-fg);
  --h: var(--af-yellow);
  --h-fg: var(--af-darkblue);
  background: linear-gradient(to top, var(--h) 50%, var(--b) 50%) top / 100% 200% no-repeat;
  color: var(--b-fg);
  font: 500 14px/1 "${FONT_FAMILY}", Montserrat, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  white-space: nowrap;
  transition: background-position 0.25s ease-in-out, color 0.2s ease-in;
}
button:hover { background-position: bottom; color: var(--h-fg); }
button:focus-visible { outline: 2px solid var(--af-focus); outline-offset: 2px; }
button:disabled { opacity: 0.55; cursor: default; }
button.primary, button.record { --b: var(--af-yellow); --b-fg: var(--af-darkblue); --h: var(--af-darkblue); --h-fg: #ffffff; }
button.ghost { --b: var(--af-soft); --b-fg: var(--af-fg); }
/* Donker thema: donkerblauw is daar de achtergrond, dus de gele knop vult zich met wit. */
@media (prefers-color-scheme: dark) {
  button.primary, button.record { --h: #ffffff; --h-fg: var(--af-darkblue); }
}
button.icon {
  min-height: 30px; width: 30px; padding: 0;
  --b: transparent; --b-fg: currentColor; --h: rgba(255, 255, 255, 0.14); --h-fg: currentColor;
}
button.icon:focus-visible { outline-color: var(--af-yellow); }
svg { width: 16px; height: 16px; fill: currentColor; flex: none; }

audio { width: 100%; height: 36px; }
.pages { margin: 0; padding: 10px 12px; list-style: none; font-size: 12px; font-weight: 400; color: var(--af-muted); display: grid; gap: 2px; background: var(--af-soft); border-radius: 8px; }
.pages li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ok { color: var(--af-fg); font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px; }
.ok::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--af-ok); flex: none; }
.error { color: var(--af-record); margin: 0; font-size: 13px; }

.pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 20px;
  --b: var(--af-darkblue);
  --b-fg: #ffffff;
  color: var(--b-fg);
  box-shadow: 1px 10px 40px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.1);
  font-variant-numeric: tabular-nums;
}
.pill > svg { color: var(--af-yellow); }
.pill:hover { color: var(--h-fg); }
.pill:hover > svg { color: inherit; }
.pill .time { font-size: 14px; }

/* Het bolletje waar de pil in wegzakt als niemand hem gebruikt: bijna onzichtbaar tot de muis (of toets) erbij komt. */
.bubble {
  width: 32px;
  height: 32px;
  min-height: 0;
  padding: 0;
  --b: var(--af-darkblue);
  --b-fg: #ffffff;
  color: var(--b-fg);
  opacity: 0.4;
  box-shadow: 1px 4px 16px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.1);
  transition: background-position 0.25s ease-in-out, color 0.2s ease-in, opacity 0.2s ease-in;
}
.bubble > svg { color: var(--af-yellow); }
.bubble:hover, .bubble:focus-visible { opacity: 1; }
.bubble:hover > svg { color: inherit; }

@media (prefers-reduced-motion: reduce) {
  .dot.live { animation: none; }
  button, .bubble { transition: none; }
}
`;
