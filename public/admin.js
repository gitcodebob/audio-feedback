// Beheerpagina: naar een tijd springen en opnames verwijderen.

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
