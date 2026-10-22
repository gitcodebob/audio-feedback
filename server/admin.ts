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
  body { font: 14px/1.45 system-ui, sans-serif; margin: 0; background: #f4f5f7; color: #1b1f24; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  nav a { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #fff; border: 1px solid #d8dde3; color: inherit; text-decoration: none; margin: 0 4px 4px 0; }
  nav a.active { background: #1f5fbf; border-color: #1f5fbf; color: #fff; }
  .rec { background: #fff; border: 1px solid #d8dde3; border-radius: 10px; padding: 14px; margin-top: 14px; display: grid; gap: 10px; }
  .rec header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .spacer { flex: 1; }
  audio { width: 100%; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 8px 3px 0; vertical-align: top; border-top: 1px solid #eef0f2; word-break: break-all; }
  td:first-child, td:nth-child(2) { white-space: nowrap; word-break: normal; width: 1%; }
  .muted { color: #5b636e; }
  .small { font-size: 12px; }
  .tag { display: inline-block; font-size: 12px; background: #eef0f2; border-radius: 4px; padding: 1px 6px; }
  .tag.warn { background: #fff1d6; }
  button { font: inherit; cursor: pointer; }
  .seek { border: 0; background: #e8f0fc; color: #1f5fbf; border-radius: 4px; padding: 1px 6px; font-variant-numeric: tabular-nums; }
  .delete { border: 1px solid #e3b4b2; background: #fff; color: #b3261e; border-radius: 6px; padding: 2px 8px; }
  .empty { margin-top: 24px; color: #5b636e; }
</style>
<script src="/admin.js" defer></script>
</head>
<body>
<main>
  <h1>Ingesproken feedback</h1>
  <nav>${filters}</nav>
  ${shown.length ? shown.map(renderRecording).join('') : '<p class="empty">Nog geen opnames.</p>'}
</main>
</body>
</html>`;
}
