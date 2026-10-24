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
  timeline: { at: number; type: string; url?: string; label?: string; data?: Record<string, string> }[];
}

type EventFn = (type: string, label?: string, data?: Record<string, string | number | boolean>) => void;

/** AudioFeedback.event() in de pagina, zoals een app het aanroept. */
function appEvent(page: Page, ...args: Parameters<EventFn>): Promise<void> {
  return page.evaluate((a) => (window as unknown as { AudioFeedback: { event: EventFn } }).AudioFeedback.event(...a), args);
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

interface SiteSettings {
  stripQuery?: boolean;
  stripHash?: boolean;
  keepParams?: string[];
}

/** Zet de instellingen van de host-app in /api/sites, zoals een beheerder dat in /admin/sites doet. */
async function setSite(page: Page, settings: SiteSettings = {}): Promise<void> {
  const res = await page.request.get(`${SERVER}/api/sites`, { headers: AUTH });
  const { sites } = (await res.json()) as { sites: { id: string; origin: string }[] };
  const site = sites.find((s) => s.origin === `http://localhost:${HOST_PORT}`)!;
  const put = await page.request.put(`${SERVER}/api/sites/${site.id}`, {
    headers: AUTH,
    data: { origin: site.origin, projects: [], stripQuery: true, stripHash: true, keepParams: [], ...settings },
  });
  expect(put.ok()).toBe(true);
}

const widget = (page: Page) => page.locator('audio-feedback-widget');
const button = (page: Page, name: string | RegExp) => widget(page).getByRole('button', { name });

test.beforeEach(async ({ page }) => {
  await clearRecordings(page);
  await setSite(page);
});

test('opnemen, pauzeren, hervatten en versturen legt de pagina’s vast', async ({ page }) => {
  // Query en hash gaan alleen mee als dat in /admin/sites aanstaat.
  await setSite(page, { keepParams: ['tab'], stripHash: false });
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
  // ~1,5 + ~2,6 s opname. De bovengrens is ruim: op een drukke machine duren de klikken langer.
  expect(rec!.durationMs).toBeGreaterThan(3000);
  expect(rec!.durationMs).toBeLessThan(8000);

  const types = rec!.timeline.map((e) => e.type);
  expect(types).toEqual(['start', 'pause', 'resume', 'navigate', 'navigate', 'stop']);
  // De pauze telt niet mee: hervatten ligt op hetzelfde punt in de opname als pauzeren,
  // terwijl er een seconde tussen zat.
  const [, pause, resume] = rec!.timeline;
  expect(resume!.at - pause!.at).toBeLessThan(150);
  const urls = rec!.timeline.filter((e) => e.type === 'navigate').map((e) => e.url);
  expect(urls).toEqual([
    `http://localhost:${HOST_PORT}/host/instellingen?tab=profiel`,
    `http://localhost:${HOST_PORT}/host/instellingen?tab=profiel#/details/42`,
  ]);

  // De opgeslagen audio is af te spelen.
  const audio = await page.request.get(`${SERVER}/api/recordings/${rec!.id}/audio`, { headers: AUTH });
  expect(audio.status()).toBe(200);
});

test('standaard gaan query en hash niet mee; het bedankje noemt kenmerk en bewaartermijn', async ({ page }) => {
  serveHost('data-privacy-url="https://example.nl/privacy"');
  await page.goto('/host/start?zoek=jan%40example.nl#access_token=abc');
  const privacy = widget(page).getByRole('link', { name: 'Hoe we hiermee omgaan' });
  await expect(privacy).toHaveAttribute('href', 'https://example.nl/privacy');
  await expect(privacy).toHaveAttribute('target', '_blank');

  await button(page, 'Opnemen').click();
  await expect(button(page, 'Pauzeren')).toBeVisible();
  await page.evaluate(() => history.pushState({}, '', '/host/herstel?token=geheim#code=xyz'));
  await page.waitForTimeout(1300);
  await button(page, 'Stoppen').click();
  await expect(widget(page).getByRole('list', { name: /Pagina/ })).not.toContainText('geheim');
  await button(page, 'Versturen').click();
  await expect(widget(page).getByText('Bedankt! Je feedback is verstuurd.')).toBeVisible();

  const [rec] = await recordings(page);
  expect(rec!.url).toBe(`http://localhost:${HOST_PORT}/host/start`);
  expect(rec!.timeline.filter((e) => e.url).map((e) => e.url)).toEqual([
    `http://localhost:${HOST_PORT}/host/start`,
    `http://localhost:${HOST_PORT}/host/herstel`,
  ]);
  await expect(widget(page).getByText(`Kenmerk ${rec!.id.slice(0, 8)}`)).toBeVisible();
  await expect(widget(page).getByText('We bewaren hem 90 dagen.')).toBeVisible();
});

test('events van de app gaan mee, met de halve minuut vóór Opnemen', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => void (m.type() === 'warning' && warnings.push(m.text())));
  serveHost();
  await page.goto('/host/start');
  await expect(widget(page).getByText('Vertel wat je ziet of ervaart')).toBeVisible();
  await expect(widget(page).getByText('wat je in de app doet')).toHaveCount(0);

  // Vóór de opname: in de buffer, net als een paginawissel.
  await appEvent(page, 'level', 'Nuuk', { golf: 2 });
  await appEvent(page, 'navigate', 'mag niet: type van de widget');
  await expect(widget(page).getByText('wat je in de app doet')).toBeVisible();
  await page.locator('#spa').click();
  await page.waitForTimeout(1300);

  await button(page, 'Opnemen').click();
  await expect(button(page, 'Pauzeren')).toBeVisible();
  await page.waitForTimeout(800);
  await appEvent(page, 'screen', 'Pauzemenu');
  await button(page, 'Pauzeren').click();
  await appEvent(page, 'screen', 'Opties');
  await button(page, 'Hervatten').click();
  await page.waitForTimeout(500);
  await button(page, 'Stoppen').click();

  // De gebruiker ziet vóór het versturen wat de app gemeld heeft.
  const listed = widget(page).getByRole('list', { name: /Gebeurtenissen uit de app/ });
  await expect(listed).toContainText('level: Nuuk');
  await expect(listed).toContainText('screen: Opties');
  await expect(widget(page).getByRole('list', { name: /Pagina/ })).toContainText('/host/instellingen');
  await button(page, 'Versturen').click();
  await expect(widget(page).getByText('Bedankt! Je feedback is verstuurd.')).toBeVisible();

  const [rec] = await recordings(page);
  expect(rec!.timeline.map((e) => e.type)).toEqual(['level', 'navigate', 'start', 'screen', 'pause', 'screen', 'resume', 'stop']);
  const [level, nav, , menu, pause, options] = rec!.timeline;
  expect(level).toMatchObject({ type: 'level', label: 'Nuuk', data: { golf: '2' } });
  // Van vóór de start: negatief, de wissel daarna dichter bij 0.
  expect(level!.at).toBeLessThan(-1000);
  expect(nav!.at).toBeGreaterThan(level!.at);
  expect(nav!.at).toBeLessThanOrEqual(0);
  expect(nav!.url).toBe(`http://localhost:${HOST_PORT}/host/instellingen`);
  expect(menu!.at).toBeGreaterThan(500);
  // In een pauze ligt een event op het punt waar de opname stilstaat.
  expect(options!.at).toBe(pause!.at);
  expect(warnings.some((w) => w.includes('"navigate" is van de widget zelf'))).toBe(true);
});

test('in /admin/sites ingesteld, geldt meteen bij de volgende opname', async ({ browser, page }) => {
  const admin = await browser.newContext({ httpCredentials: { username: 'beheer', password: 'e2e' } });
  const adminPage = await admin.newPage();
  await adminPage.goto(`${SERVER}/admin/sites`);
  const form = adminPage.locator('form.site', { has: adminPage.getByRole('heading', { name: `http://localhost:${HOST_PORT}` }) });

  // Het voorbeeld laat zien wat er bewaard blijft, al tijdens het instellen.
  await form.getByLabel('Voorbeeldadres').fill(`http://localhost:${HOST_PORT}/x?tab=2&token=geheim#/route`);
  await expect(form.locator('output')).toHaveText(`http://localhost:${HOST_PORT}/x`);
  await form.getByLabel('Parameters die mee mogen').fill('tab');
  await expect(form.getByLabel('Alleen deze parameters:')).toBeChecked();
  await form.getByLabel('Hash meesturen').check();
  await expect(form.locator('output')).toHaveText(`http://localhost:${HOST_PORT}/x?tab=2#/route`);
  await form.getByRole('button', { name: 'Opslaan' }).click();
  await adminPage.waitForLoadState('load');
  await expect(form.getByLabel('Parameters die mee mogen')).toHaveValue('tab');
  await admin.close();

  // De app is niet aangepast of opnieuw geladen met andere attributen.
  serveHost();
  await page.goto('/host/start?tab=2&token=geheim#/route');
  await button(page, 'Opnemen').click();
  await expect(button(page, 'Pauzeren')).toBeVisible();
  await page.waitForTimeout(1200);
  await button(page, 'Stoppen').click();
  await expect(widget(page).getByRole('list', { name: /Pagina/ })).toContainText('/host/start?tab=2#/route');
  await button(page, 'Versturen').click();
  await expect(widget(page).getByText('Bedankt!')).toBeVisible();
  const [rec] = await recordings(page);
  expect(rec!.url).toBe(`http://localhost:${HOST_PORT}/host/start?tab=2#/route`);
});

test('zonder antwoord over de site-instellingen gaat alleen het pad mee', async ({ page }) => {
  await setSite(page, { stripQuery: false, stripHash: false });
  await page.route('**/api/sites/config', (route) => route.abort());
  serveHost();
  await page.goto('/host/start?token=geheim#access_token=abc');
  await button(page, 'Opnemen').click();
  await expect(button(page, 'Pauzeren')).toBeVisible();
  await page.waitForTimeout(1200);
  await button(page, 'Stoppen').click();
  await expect(widget(page).getByRole('list', { name: /Pagina/ })).not.toContainText('geheim');
  await button(page, 'Versturen').click();
  await expect(widget(page).getByText('Bedankt!')).toBeVisible();
  const [rec] = await recordings(page);
  expect(rec!.url).toBe(`http://localhost:${HOST_PORT}/host/start`);
});

test('AudioFeedback.clear() gooit een klaarstaande opname weg', async ({ page }) => {
  serveHost();
  await page.goto('/host/start');
  await button(page, 'Opnemen').click();
  await page.waitForTimeout(1500);
  await button(page, 'Stoppen').click();
  await button(page, 'Versturen').waitFor();

  // Bijvoorbeeld bij uitloggen.
  await page.evaluate(() => (window as unknown as { AudioFeedback: { clear(): Promise<void> } }).AudioFeedback.clear());
  await expect(button(page, 'Opnemen')).toBeVisible();
  await page.reload();
  await page.waitForTimeout(3500);
  await expect(widget(page).getByText('Er staat nog een opname klaar')).toHaveCount(0);
  expect(await recordings(page)).toEqual([]);
});

test('een opname die niet verstuurd is, verdwijnt na een dag uit de browser', async ({ page }) => {
  serveHost();
  await page.goto('/host/start');
  await button(page, 'Opnemen').click();
  await page.waitForTimeout(1500);
  await button(page, 'Stoppen').click();
  await button(page, 'Versturen').waitFor();

  // Een dag en een uur later, op dezelfde computer.
  await page.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 25 * 60 * 60 * 1000;
  });
  await page.reload();
  await page.waitForTimeout(3500);
  await expect(widget(page).getByText('Er staat nog een opname klaar')).toHaveCount(0);
  await expect(button(page, 'Opnemen')).toBeVisible();
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

test('met data-hosts verschijnt de widget alleen op die hostnamen', async ({ page }) => {
  serveHost('data-hosts="app.example.nl, localhost"');
  await page.goto('/host/start');
  await expect(button(page, 'Opnemen')).toBeVisible();
  serveHost('data-hosts="app.example.nl"');
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
