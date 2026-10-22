import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';

// Een nep-hostapp op http://localhost:<poort+1>/host/... sluit de widget in van de
// feedbackserver op 127.0.0.1:<poort>. De fake-device-vlaggen van Chromium leveren
// een piepende "microfoon". De hostapp draait als echte server en niet via
// page.route: zonder IP-adres ziet Chromium hem als publiek en blokkeert dan elk
// verzoek naar loopback (Local Network Access).

const PORT = Number(process.env.E2E_PORT ?? 8790);
const SERVER = `http://127.0.0.1:${PORT}`;
const HOST_PORT = PORT + 1;
const AUTH = { Authorization: `Basic ${Buffer.from('x:e2e').toString('base64')}` };

interface Recording {
  id: string;
  project: string;
  url: string;
  origin: string;
  durationMs: number;
  recovered: boolean;
  sizeBytes: number;
  audioType: string;
  context: Record<string, string>;
  timeline: { at: number; type: string; url?: string }[];
}

function hostPage(attrs = ''): string {
  return `<!doctype html><html lang="nl"><head><title>Host-app</title></head><body>
    <h1>Host-app</h1>
    <button id="spa">Naar instellingen</button>
    <script>
      window.appKeys = [];
      window.addEventListener('keydown', (e) => window.appKeys.push(e.key));
      window.appClicks = 0;
      document.addEventListener('click', () => window.appClicks++);
      document.getElementById('spa').onclick = () => history.pushState({}, '', '/host/instellingen?tab=profiel');
    </script>
    <script src="${SERVER}/widget.js" data-project="e2e" ${attrs.includes('data-allow-webdriver') ? '' : 'data-allow-webdriver'} data-context='{"omgeving":"test"}' ${attrs} defer></script>
  </body></html>`;
}

let hostAttrs = '';
let hostServer: Server;

test.beforeAll(async () => {
  hostServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(hostPage(hostAttrs));
  });
  await new Promise<void>((resolve) => hostServer.listen(HOST_PORT, '127.0.0.1', resolve));
});

test.afterAll(() => {
  hostServer.close();
});

function serveHost(attrs = ''): void {
  hostAttrs = attrs;
}

async function recordings(page: Page, project = 'e2e'): Promise<Recording[]> {
  const res = await page.request.get(`${SERVER}/api/recordings?project=${project}`, { headers: AUTH });
  return ((await res.json()) as { recordings: Recording[] }).recordings;
}

async function clearRecordings(page: Page): Promise<void> {
  for (const r of await recordings(page)) {
    await page.request.delete(`${SERVER}/api/recordings/${r.id}`, { headers: AUTH });
  }
}

const widget = (page: Page) => page.locator('audio-feedback-widget');
const button = (page: Page, name: string | RegExp) => widget(page).getByRole('button', { name });

test.beforeEach(async ({ page }) => {
  await clearRecordings(page);
});

test('opnemen, pauzeren, hervatten en versturen legt de pagina’s vast', async ({ page }) => {
  serveHost();
  await page.goto('/host/start');
  await expect(widget(page).getByText('Vertel wat je ziet of ervaart')).toBeVisible();

  await button(page, 'Opnemen').click();
  await expect(button(page, 'Pauzeren')).toBeVisible();
  await page.waitForTimeout(1500);

  await button(page, 'Pauzeren').click();
  await expect(widget(page).getByText('gepauzeerd')).toBeVisible();
  await page.waitForTimeout(1000);
  await button(page, 'Hervatten').click();

  // SPA-navigatie (pushState) en daarna een hash-wissel.
  await page.locator('#spa').click();
  await page.waitForTimeout(1300);
  await page.evaluate(() => (location.hash = '#/details/42'));
  await page.waitForTimeout(1300);

  await button(page, 'Stoppen').click();
  await expect(button(page, 'Versturen')).toBeVisible();
  await expect(widget(page).getByRole('list', { name: /Pagina/ })).toContainText('/host/instellingen?tab=profiel');

  await button(page, 'Versturen').click();
  await expect(widget(page).getByText('Bedankt! Je feedback is verstuurd.')).toBeVisible();

  const [rec] = await recordings(page);
  expect(rec).toBeTruthy();
  expect(rec!.url).toBe(`http://localhost:${HOST_PORT}/host/start`);
  expect(rec!.origin).toBe(`http://localhost:${HOST_PORT}`);
  expect(rec!.audioType).toBe('audio/webm');
  expect(rec!.sizeBytes).toBeGreaterThan(1000);
  expect(rec!.context).toEqual({ omgeving: 'test' });
  expect(rec!.recovered).toBe(false);
  // Pauze telt niet mee: ~1,5 + ~2,6 s opname, niet de seconde pauze erbij.
  expect(rec!.durationMs).toBeGreaterThan(3000);
  expect(rec!.durationMs).toBeLessThan(5500);

  const types = rec!.timeline.map((e) => e.type);
  expect(types).toEqual(['start', 'pause', 'resume', 'navigate', 'navigate', 'stop']);
  const urls = rec!.timeline.filter((e) => e.type === 'navigate').map((e) => e.url);
  expect(urls).toEqual([
    `http://localhost:${HOST_PORT}/host/instellingen?tab=profiel`,
    `http://localhost:${HOST_PORT}/host/instellingen?tab=profiel#/details/42`,
  ]);

  // De opgeslagen audio is af te spelen.
  const audio = await page.request.get(`${SERVER}/api/recordings/${rec!.id}/audio`, { headers: AUTH });
  expect(audio.status()).toBe(200);
});

test('toetsen en klikken op het kaartje lekken niet naar de app', async ({ page }) => {
  serveHost();
  await page.goto('/host/start');
  await button(page, 'Opnemen').click();
  await expect(button(page, 'Pauzeren')).toBeVisible();

  const clicksBefore = await page.evaluate(() => (window as unknown as { appClicks: number }).appClicks);
  // Met het toetsenbord bedienen: spatie op de gefocuste knop pauzeert, de app ziet niets.
  await button(page, 'Pauzeren').focus();
  await page.keyboard.press('Space');
  await expect(button(page, 'Hervatten')).toBeVisible();
  // Focus blijft in het kaartje bij toetsenbordbediening.
  await page.keyboard.press('Enter');
  await expect(button(page, 'Pauzeren')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { appKeys: string[] }).appKeys)).toEqual([]);

  // Na een muisklik laat het kaartje de focus los: de volgende spatie is weer voor de app.
  await button(page, 'Pauzeren').click();
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as unknown as { appKeys: string[] }).appKeys)).toEqual([' ']);
  await expect(button(page, 'Hervatten')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { appClicks: number }).appClicks)).toBe(clicksBefore);

  await button(page, 'Stoppen').click();
  await button(page, 'Weggooien').click();
  await expect(button(page, 'Opnemen')).toBeVisible();
  expect(await recordings(page)).toEqual([]);
});

test('een opname die door herladen werd afgebroken, wordt teruggeboden', async ({ page }) => {
  serveHost();
  await page.goto('/host/start');
  await button(page, 'Opnemen').click();
  await expect(button(page, 'Pauzeren')).toBeVisible();
  await page.waitForTimeout(2500);

  page.on('dialog', (d) => d.accept()); // beforeunload-waarschuwing
  await page.reload();
  await expect(widget(page).getByText('Er staat nog een opname klaar')).toBeVisible({ timeout: 10_000 });
  await button(page, 'Versturen').click();
  await expect(widget(page).getByText('Bedankt!')).toBeVisible();

  const [rec] = await recordings(page);
  expect(rec!.recovered).toBe(true);
  expect(rec!.durationMs).toBeGreaterThan(1000);
  expect(rec!.timeline.at(-1)!.type).toBe('stop');

  // Weg is weg: na nog een keer laden staat er niets meer klaar.
  await page.reload();
  await page.waitForTimeout(500);
  await expect(button(page, 'Opnemen')).toBeVisible();
});

test('minimaliseren onthoudt de stand en laat de lopende tijd zien', async ({ page }) => {
  serveHost();
  await page.goto('/host/start');
  await button(page, 'Opnemen').click();
  await button(page, 'Minimaliseren').click();
  const pill = button(page, /Feedback-kaartje openen, opname loopt/);
  await expect(pill).toBeVisible();
  await expect(pill).toContainText(/0:0[1-9]/);
  await pill.click();
  await button(page, 'Stoppen').click();
  await button(page, 'Weggooien').click();
  await button(page, 'Minimaliseren').click();

  await page.reload();
  await expect(button(page, 'Feedback-kaartje openen')).toBeVisible();
});

test('geweigerde microfoon geeft een begrijpelijke melding', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('nee', 'NotAllowedError'));
  });
  serveHost();
  await page.goto('/host/start');
  await button(page, 'Opnemen').click();
  await expect(widget(page).getByRole('alert')).toContainText('Geen toegang tot de microfoon');
  await button(page, 'Terug').click();
  await expect(button(page, 'Opnemen')).toBeVisible();
});

test('zonder data-allow-webdriver blijft de widget weg in geautomatiseerde browsers', async ({ page }) => {
  serveHost('data-allow-webdriver="false"');
  await page.goto('/host/start');
  await page.waitForFunction(() => !!(window as unknown as { AudioFeedback?: unknown }).AudioFeedback);
  await expect(widget(page)).toHaveCount(0);
});

test('het kaartje laat zich verslepen en blijft daar na herladen', async ({ page }) => {
  serveHost();
  await page.goto('/host/start');
  const head = widget(page).getByText('Feedback inspreken', { exact: true });
  const before = (await widget(page).boundingBox())!;
  const h = (await head.boundingBox())!;
  await page.mouse.move(h.x + 20, h.y + 8);
  await page.mouse.down();
  await page.mouse.move(h.x - 400, h.y - 300, { steps: 8 });
  await page.mouse.up();
  const after = (await widget(page).boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 300);
  expect(after.y).toBeLessThan(before.y - 200);

  await page.reload();
  const reloaded = (await widget(page).boundingBox())!;
  expect(Math.abs(reloaded.x - after.x)).toBeLessThan(2);
  expect(Math.abs(reloaded.y - after.y)).toBeLessThan(2);
});
