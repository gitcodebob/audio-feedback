// Beheerpagina: per opname de audio, de pagina's die erbij open stonden (klik
// op een tijd om daarheen te springen) en de context. Alle velden komen van
// clients en gaan dus door escape(); als link alleen http(s).

import type { StoredRecording } from './storage.ts';

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function time(ms: number): string {
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

function renderRecording(r: StoredRecording): string {
  const timeline = r.timeline
    .map((e) => `<tr>
        <td><button class="seek" data-seek="${e.at}" title="Hier afspelen">${time(e.at)}</button></td>
        <td>${TYPE_LABEL[e.type] ?? escape(e.type)}</td>
        <td>${e.url ? link(e.url) : ''}${e.title ? `<div class="muted">${escape(e.title)}</div>` : ''}</td>
      </tr>`)
    .join('');
  const context = Object.entries(r.context)
    .map(([k, v]) => `<span class="tag">${escape(k)}: ${escape(v)}</span>`)
    .join(' ');
  return `<article class="rec" id="r-${r.id}">
    <header>
      <strong>${escape(r.project)}</strong>
      <span class="muted">${dateFormat.format(new Date(r.startedAt))} · ${time(r.durationMs)} · ${Math.round(r.sizeBytes / 1024)} kB</span>
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

export function renderAdmin(all: StoredRecording[], project: string): string {
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.project, (counts.get(r.project) ?? 0) + 1);
  const shown = project ? all.filter((r) => r.project === project) : all;
  const filters = [
    `<a href="/admin" class="${project ? '' : 'active'}">alle (${all.length})</a>`,
    ...[...counts].sort().map(([p, n]) =>
      `<a href="/admin?project=${encodeURIComponent(p)}" class="${p === project ? 'active' : ''}">${escape(p)} (${n})</a>`),
  ].join(' ');

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ingesproken feedback</title>
<style>
  @font-face { font-family: Montserrat; src: url(/fonts/montserrat-latin-wght-normal.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
  body { font: 14px/1.5 Montserrat, system-ui, sans-serif; margin: 0; background: #f6f8fa; color: #3c3c3c; }
  .bar { background: #242f36; color: #fff; }
  .bar div { max-width: 960px; margin: 0 auto; padding: 18px 16px; display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 18px; }
  .bar div::before { content: ""; width: 5px; height: 22px; border-radius: 3px; background: #f8e800; }
  a { color: #242f36; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  nav a { display: inline-block; padding: 6px 16px; border-radius: 999px; background: #fff; color: inherit; text-decoration: none; margin: 0 4px 4px 0; font-weight: 500; box-shadow: 0 1px 2px #0000001a; }
  nav a.active { background: #f8e800; color: #242f36; }
  .rec { background: #fff; border-radius: 16px; padding: 18px; margin-top: 16px; display: grid; gap: 10px; box-shadow: 1px 10px 40px #0000001f; }
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
  button { font: inherit; cursor: pointer; }
  .seek { border: 0; background: #f8e800; color: #242f36; border-radius: 999px; padding: 1px 8px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .delete { border: 0; background: #f6f8fa; color: #d0021b; border-radius: 999px; padding: 4px 12px; }
  .delete:hover { background: #d0021b; color: #fff; }
  .empty { margin-top: 24px; color: #77818b; }
</style>
<script src="/admin.js" defer></script>
</head>
<body>
<header class="bar"><div>Ingesproken feedback</div></header>
<main>
  <nav>${filters}</nav>
  ${shown.length ? shown.map(renderRecording).join('') : '<p class="empty">Nog geen opnames.</p>'}
</main>
</body>
</html>`;
}
