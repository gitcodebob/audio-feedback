// Beheerpagina: per opname de audio, de pagina's die erbij open stonden en wat de
// app meldde (klik op een tijd om daarheen te springen) en de context. Alle velden komen van
// clients en gaan dus door escape(); als link alleen http(s).

import type { Site } from './sites.ts';
import type { StoredRecording } from './storage.ts';
import type { TimelineEntry } from '../widget/src/types.ts';

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function time(ms: number): string {
  if (ms < 0) return `−${time(-ms)}`;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function link(url: string): string {
  const safe = /^https?:\/\//i.test(url) ? url : '';
  return safe ? `<a href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>` : escape(url);
}

const dateFormat = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' });

const TYPE_LABEL: Record<string, string> = {
  start: 'start op',
  navigate: 'naar',
  pause: 'pauze',
  resume: 'hervat',
  stop: 'einde',
};

function tags(values: Record<string, string> | undefined): string {
  return Object.entries(values ?? {})
    .map(([k, v]) => `<span class="tag">${escape(k)}: ${escape(v)}</span>`)
    .join(' ');
}

function seekButton(at: number): string {
  // Van vóór de start: daar is geen audio van, dus vanaf het begin afspelen.
  return at < 0
    ? `<button class="seek before" data-seek="0" title="Vóór de opname; afspelen vanaf het begin">${time(at)}</button>`
    : `<button class="seek" data-seek="${at}" title="Hier afspelen">${time(at)}</button>`;
}

function renderEntry(e: TimelineEntry): string {
  const what = TYPE_LABEL[e.type] ?? `<span class="tag app">${escape(e.type)}</span>`;
  const data = tags(e.data);
  return `<tr>
        <td>${seekButton(e.at)}</td>
        <td>${what}</td>
        <td>${e.label ? escape(e.label) : ''}${e.url ? link(e.url) : ''}${e.title ? `<div class="muted">${escape(e.title)}</div>` : ''}${data ? `<div>${data}</div>` : ''}</td>
      </tr>`;
}

function renderRecording(r: StoredRecording): string {
  const timeline = r.timeline.map(renderEntry).join('');
  const context = tags(r.context);
  return `<article class="rec" id="r-${r.id}">
    <header>
      <strong>${escape(r.project)}</strong>
      <span class="muted">${dateFormat.format(new Date(r.startedAt))} · ${time(r.durationMs)} · ${Math.round(r.sizeBytes / 1024)} kB · kenmerk <span class="code">${r.id.slice(0, 8)}</span></span>
      ${r.recovered ? '<span class="tag warn" title="Na een navigatie of crash teruggehaald; het laatste stukje kan ontbreken">teruggehaald</span>' : ''}
      <span class="spacer"></span>
      <a href="/api/recordings/${r.id}/audio" download="${escape(r.audioFile)}">download</a>
      <button class="delete" data-delete="${r.id}">verwijderen</button>
    </header>
    <audio controls preload="metadata" src="/api/recordings/${r.id}/audio" data-duration="${r.durationMs}"></audio>
    <table>${timeline}</table>
    ${context ? `<div>${context}</div>` : ''}
    <div class="muted small">${escape(r.origin)} · ${escape(r.client.userAgent)} · ${r.client.viewport.width}×${r.client.viewport.height} · ${escape(r.client.language)}</div>
  </article>`;
}

const STYLE = `
  @font-face { font-family: Montserrat; src: url(/fonts/montserrat-latin-wght-normal.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
  body { font: 14px/1.5 Montserrat, system-ui, sans-serif; margin: 0; background: #f6f8fa; color: #3c3c3c; }
  .bar { background: #242f36; color: #fff; }
  .bar > div { max-width: 960px; margin: 0 auto; padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
  .bar strong { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 18px; flex: 1; }
  .bar strong::before { content: ""; width: 5px; height: 22px; border-radius: 3px; background: #f8e800; }
  .bar a { color: #fff; text-decoration: none; font-weight: 500; padding: 6px 14px; border-radius: 999px; }
  .bar a:hover { color: #f8e800; }
  .bar a.active { background: #f8e800; color: #242f36; }
  a { color: #242f36; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  nav a { display: inline-block; padding: 6px 16px; border-radius: 999px; background: #fff; color: inherit; text-decoration: none; margin: 0 4px 4px 0; font-weight: 500; box-shadow: 0 1px 2px #0000001a; }
  nav a.active { background: #f8e800; color: #242f36; }
  .rec, .site { background: #fff; border-radius: 16px; padding: 18px; margin-top: 16px; display: grid; gap: 10px; box-shadow: 1px 10px 40px #0000001f; }
  .rec header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .spacer { flex: 1; }
  audio { width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 8px 3px 0; vertical-align: top; border-top: 1px solid #eef0f2; word-break: break-all; }
  td:first-child, td:nth-child(2) { white-space: nowrap; word-break: normal; width: 1%; }
  .muted { color: #77818b; }
  .small { font-size: 12px; }
  .tag { display: inline-block; font-size: 12px; background: #eef0f2; border-radius: 4px; padding: 1px 6px; }
  .tag.warn { background: #fff1d6; }
  .tag.app { background: #242f36; color: #fff; }
  button { font: inherit; cursor: pointer; }
  .seek { border: 0; background: #f8e800; color: #242f36; border-radius: 999px; padding: 1px 8px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .seek.before { background: #eef0f2; }
  .delete { border: 0; background: #f6f8fa; color: #d0021b; border-radius: 999px; padding: 4px 12px; }
  .delete:hover { background: #d0021b; color: #fff; }
  .empty { margin-top: 24px; color: #77818b; }
  .code { font-family: ui-monospace, monospace; color: #3c3c3c; }
  .note { font-size: 12px; color: #77818b; margin: 8px 0 0; }
  .site.new { border: 2px dashed #d5dade; box-shadow: none; }
  .site h2 { font-size: 15px; margin: 0; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  @media (max-width: 640px) { .fields { grid-template-columns: 1fr; } }
  label.field { display: grid; gap: 4px; font-weight: 500; }
  input[type=text] { font: inherit; padding: 7px 10px; border: 1px solid #d5dade; border-radius: 8px; background: #fff; color: inherit; min-width: 0; }
  input[type=text]:focus { outline: 2px solid #242f36; outline-offset: 1px; }
  .hint { font-weight: 400; font-size: 12px; color: #77818b; }
  fieldset { border: 1px solid #eef0f2; border-radius: 10px; padding: 8px 12px 10px; margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; }
  legend { font-weight: 500; padding: 0 4px; }
  fieldset label { display: inline-flex; align-items: center; gap: 6px; }
  .preview { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; background: #f6f8fa; border-radius: 10px; padding: 10px 12px; }
  .preview output { font-family: ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace; font-size: 12px; word-break: break-all; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .primary { border: 0; background: #f8e800; color: #242f36; border-radius: 999px; padding: 6px 18px; font-weight: 600; }
  .primary:hover { background: #242f36; color: #fff; }
  .ghost { border: 0; background: #f6f8fa; color: #242f36; border-radius: 999px; padding: 4px 12px; }
  .msg { font-size: 13px; }
  .msg.error { color: #d0021b; }
  details summary { cursor: pointer; color: #77818b; font-size: 13px; }
  pre { background: #f6f8fa; border-radius: 8px; padding: 10px 12px; overflow-x: auto; margin: 8px 0 0; font-size: 12px; }
`;

function page(active: 'opnames' | 'sites', body: string): string {
  const tab = (key: typeof active, href: string, label: string) =>
    `<a href="${href}" class="${key === active ? 'active' : ''}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${active === 'sites' ? 'Sites' : 'Opnames'} · ingesproken feedback</title>
<style>${STYLE}</style>
<script src="/admin.js" defer></script>
</head>
<body>
<header class="bar"><div><strong>Ingesproken feedback</strong>${tab('opnames', '/admin', 'Opnames')}${tab('sites', '/admin/sites', 'Sites')}</div></header>
<main>
${body}
</main>
</body>
</html>`;
}

export function renderAdmin(all: StoredRecording[], project: string): string {
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.project, (counts.get(r.project) ?? 0) + 1);
  const shown = project ? all.filter((r) => r.project === project) : all;
  const filters = [
    `<a href="/admin" class="${project ? '' : 'active'}">alle (${all.length})</a>`,
    ...[...counts].sort().map(([p, n]) =>
      `<a href="/admin?project=${encodeURIComponent(p)}" class="${p === project ? 'active' : ''}">${escape(p)} (${n})</a>`),
  ].join(' ');

  return page('opnames', `  <nav>${filters}</nav>
  <p class="note">Adressen, titels en context komen van de browser van wie insprak en zijn niet gecontroleerd. Klik alleen op links die je vertrouwt.
    Vraagt iemand om zijn opname, zoek dan op het kenmerk dat de widget na het versturen liet zien (Ctrl+F).</p>
  ${shown.length ? shown.map(renderRecording).join('') : '<p class="empty">Nog geen opnames.</p>'}`);
}

/** Een adres om de instellingen op uit te proberen, met wat er vaak in staat. */
function exampleUrl(origin: string): string {
  const base = origin === '*' ? 'https://mijn-app.example.nl' : origin.replace('://*.', '://app.');
  return `${base}/pagina?tab=2&token=geheim#/route/12`;
}

function renderSite(site: Site | null, base: string): string {
  const s = site ?? { id: '', origin: '', projects: [], stripQuery: true, stripHash: true, keepParams: [] };
  const query = !s.stripQuery ? 'all' : s.keepParams.length ? 'keep' : 'strip';
  const radio = (value: string, label: string) =>
    `<label><input type="radio" name="query" value="${value}"${query === value ? ' checked' : ''}> ${label}</label>`;
  const snippet = `<script src="${base}/widget.js" data-project="${s.projects[0] ?? 'mijn-app'}" defer></script>`;
  return `<form class="site${site ? '' : ' new'}" data-site="${s.id}" novalidate>
    <h2>${site ? escape(s.origin) : 'Site toevoegen'}</h2>
    <div class="fields">
      <label class="field">Website
        <input type="text" name="origin" value="${escape(s.origin)}" placeholder="https://mijn-app.example.nl" spellcheck="false" autocomplete="off">
        <span class="hint">Een adres van de app, of https://*.example.nl voor alle subdomeinen.</span></label>
      <label class="field">Projectnaam
        <input type="text" name="projects" value="${escape(s.projects.join(', '))}" placeholder="mijn-app" spellcheck="false" autocomplete="off">
        <span class="hint">Wat de app als data-project meegeeft. Meerdere met komma's; leeg is elke naam.</span></label>
    </div>
    <fieldset>
      <legend>Query (?…)</legend>
      ${radio('strip', 'Weglaten')}
      ${radio('keep', 'Alleen deze parameters:')}
      <input type="text" name="keepParams" value="${escape(s.keepParams.join(', '))}" placeholder="tab, proef" aria-label="Parameters die mee mogen" spellcheck="false" autocomplete="off">
      ${radio('all', 'Alles meesturen')}
    </fieldset>
    <fieldset>
      <legend>Hash (#…)</legend>
      <label><input type="checkbox" name="keepHash"${s.stripHash ? '' : ' checked'}> Hash meesturen</label>
      <span class="hint">Nodig bij apps met hash-routes, zoals #/ontwerp/12.</span>
    </fieldset>
    <div class="preview">
      <span class="hint">Probeer</span><input type="text" data-preview value="${escape(exampleUrl(s.origin || 'https://mijn-app.example.nl'))}" aria-label="Voorbeeldadres" spellcheck="false">
      <span class="hint">Bewaard</span><output data-preview-out></output>
    </div>
    <div class="row">
      <button class="primary">${site ? 'Opslaan' : 'Toevoegen'}</button>
      ${site ? '<button type="button" class="delete" data-delete-site>Verwijderen</button>' : ''}
      <span class="msg" role="status"></span>
    </div>
    ${site ? `<details><summary>Scripttag voor de app</summary>
      <pre><code>${escape(snippet)}</code></pre>
      <button type="button" class="ghost" data-copy="${escape(snippet)}">Kopiëren</button></details>` : ''}
  </form>`;
}

export function renderSites(sites: Site[], base: string): string {
  return page('sites', `  <h1>Sites</h1>
  <p class="note">Alleen deze websites mogen opnames insturen. Wat je hier instelt, geldt meteen bij de volgende opname: de app hoeft niet opnieuw te worden uitgerold.
    De widget en de server houden zich er allebei aan.</p>
  ${sites.map((s) => renderSite(s, base)).join('')}
  ${sites.length ? '' : '<p class="empty">Nog geen sites: alleen de demopagina kan opnames insturen.</p>'}
  ${renderSite(null, base)}`);
}
