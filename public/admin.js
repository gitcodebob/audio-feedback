// Beheerpagina: naar een tijd springen, opnames verwijderen, downloadmenu's sluiten en sites beheren.

// MediaRecorder-webm heeft geen duur in de header, en dan kan de browser niet
// zoeken. Eén keer naar het einde springen laat hem de duur uitrekenen.
function ensureSeekable(audio) {
  if (Number.isFinite(audio.duration)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      audio.removeEventListener('durationchange', check);
      audio.currentTime = 0;
      resolve();
    };
    const check = () => Number.isFinite(audio.duration) && done();
    audio.addEventListener('durationchange', check);
    audio.currentTime = 1e9;
    setTimeout(done, 3000);
  });
}

document.addEventListener('click', async (e) => {
  const seek = e.target.closest('[data-seek]');
  if (seek) {
    const audio = seek.closest('.rec').querySelector('audio');
    if (audio.readyState === 0) {
      audio.load();
      await new Promise((r) => audio.addEventListener('loadedmetadata', r, { once: true }));
    }
    await ensureSeekable(audio);
    audio.currentTime = Number(seek.dataset.seek) / 1000;
    void audio.play();
    return;
  }
  const del = e.target.closest('[data-delete]');
  if (del) {
    if (!confirm('Deze opname definitief verwijderen?')) return;
    const res = await fetch(`/api/recordings/${del.dataset.delete}`, { method: 'DELETE' });
    if (res.ok) del.closest('.rec').remove();
    else alert('Verwijderen lukte niet.');
  }
});

// --- downloadmenu's ---------------------------------------------------------

// Een uitgeklapt menu gaat dicht bij een keuze, een klik ernaast of Escape.
document.addEventListener('click', (e) => {
  for (const menu of document.querySelectorAll('.split details[open]')) {
    if (!menu.contains(e.target) || e.target.closest('.menu a')) menu.open = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const menu of document.querySelectorAll('.split details[open]')) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});

// --- sites ------------------------------------------------------------------

const list = (value) => value.split(',').map((v) => v.trim()).filter(Boolean);

function urlOptions(form) {
  const query = form.elements.query.value;
  return {
    stripQuery: query !== 'all',
    keepParams: query === 'keep' ? list(form.elements.keepParams.value) : [],
    stripHash: !form.elements.keepHash.checked,
  };
}

// Dezelfde regels als widget/src/clean-url.ts, zodat het voorbeeld laat zien wat er echt bewaard wordt.
function cleanUrl(href, o) {
  try {
    const u = new URL(href);
    if (o.stripQuery) {
      const kept = new URLSearchParams();
      for (const [k, v] of u.searchParams) if (o.keepParams.includes(k)) kept.append(k, v);
      u.search = kept.toString();
    }
    if (o.stripHash) u.hash = '';
    return u.toString();
  } catch {
    return 'geen geldig adres';
  }
}

function updatePreview(form) {
  const input = form.querySelector('[data-preview]');
  form.querySelector('[data-preview-out]').textContent = input.value ? cleanUrl(input.value, urlOptions(form)) : '';
}

function message(form, text, isError) {
  const msg = form.querySelector('.msg');
  msg.textContent = text;
  msg.classList.toggle('error', isError);
}

async function send(form, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return true;
  const { error } = await res.json().catch(() => ({}));
  message(form, error ?? `Dat lukte niet (${res.status}).`, true);
  return false;
}

document.querySelectorAll('form.site').forEach(updatePreview);

document.addEventListener('input', (e) => {
  const form = e.target.closest('form.site');
  if (!form) return;
  // Wie parameters intikt, bedoelt "alleen deze".
  if (e.target.name === 'keepParams' && e.target.value.trim()) form.elements.query.value = 'keep';
  updatePreview(form);
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.site');
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.site;
  const body = { origin: form.elements.origin.value, projects: list(form.elements.projects.value), ...urlOptions(form) };
  message(form, 'Opslaan…', false);
  if (await send(form, id ? 'PUT' : 'POST', id ? `/api/sites/${id}` : '/api/sites', body)) location.reload();
});

document.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-delete-site]');
  if (del) {
    const form = del.closest('form.site');
    if (!confirm(`${form.elements.origin.value} verwijderen? Die site kan daarna geen opnames meer insturen.`)) return;
    if (await send(form, 'DELETE', `/api/sites/${form.dataset.site}`)) form.remove();
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard.writeText(copy.dataset.copy);
    copy.textContent = 'Gekopieerd';
    setTimeout(() => (copy.textContent = 'Kopiëren'), 1500);
  }
});
