// Proef op echte apps, zonder hun code aan te raken: laadt elke app in Chromium,
// voegt de widget toe zoals een scripttag dat zou doen, neemt met een nep-microfoon
// een paar seconden op terwijl er in de app genavigeerd wordt, en controleert wat
// er bij de feedbackserver aankomt. Schermafdrukken komen in test-results/hosts/.
//
//   node scripts/try-hosts.ts [naam...]
//
// Verwacht een draaiende feedbackserver op FEEDBACK_URL (standaard 127.0.0.1:8790)
// met ADMIN_PASSWORD gelijk aan FEEDBACK_ADMIN en de app-origins in ALLOWED_ORIGINS.

import { chromium, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = process.env.FEEDBACK_URL ?? 'http://127.0.0.1:8790';
const AUTH = `Basic ${Buffer.from(`x:${process.env.FEEDBACK_ADMIN ?? 'proef'}`).toString('base64')}`;
const OUT = join(import.meta.dirname, '..', 'test-results', 'hosts');

interface Host {
  name: string;
  url: string;
  /** Wat er moet gebeuren voordat de app bruikbaar is (inloggen e.d.). */
  setup?: (page: Page) => Promise<void>;
  /** Navigeren in de app terwijl de opname loopt. */
  navigate?: (page: Page) => Promise<void>;
  /** Een app-toestand die niet mag veranderen als toetsen in de widget blijven. */
  untouched?: (page: Page) => Promise<string>;
  /** Wachten op een vaste app-toestand vóór de toetsenproef. */
  ready?: (page: Page) => Promise<void>;
  /** Doen alsof er een mens achter zit: het spel slaat anders zijn startscherm over. */
  hideWebdriver?: boolean;
  /** Wat de app op de scripttag zou zetten, zodat de navigatie van de app in de tijdlijn komt. */
  config?: { keepParams?: string[]; stripHash?: boolean };
}

const hosts: Host[] = [
  {
    name: 'defend-greenland',
    url: process.env.WOF_URL ?? 'https://defend-greenland.hetzner.bobreijnders.nl/?quality=low',
    hideWebdriver: true,
    config: { keepParams: ['quality'], stripHash: false },
    ready: async (page) => {
      await page.waitForFunction(() => document.getElementById('ranglijst')?.checkVisibility(), null, { timeout: 30_000 });
    },
    // Na 5 s stilte op de titel komt de ranglijst op; Escape gaat daar terug naar de
    // titel, en Enter of spatie op de titel start het spel. Lekt er een toets uit de
    // widget naar window, dan verandert dus welk scherm er staat.
    untouched: (page) => page.evaluate(() => {
      const vis = (id: string) => document.getElementById(id)?.checkVisibility() ?? false;
      return `titel ${vis('start') ? 'zichtbaar' : 'weg'}, ranglijst ${vis('ranglijst') ? 'zichtbaar' : 'weg'}`;
    }),
    navigate: async (page) => {
      await page.evaluate(() => (location.hash = '#proef'));
    },
  },
  {
    name: 'elektra-ontwerper',
    url: process.env.ELEKTRA_URL ?? 'https://elektra-ontwerper.hetzner.bobreijnders.nl/',
    config: { keepParams: ['proef'] },
    navigate: async (page) => {
      await page.evaluate(() => history.replaceState(null, '', '?proef=1'));
    },
  },
  {
    name: 'meterkast',
    url: process.env.METERKAST_URL ?? 'http://localhost:8792/',
    config: { stripHash: false },
    setup: async (page) => {
      await page.getByLabel('Wachtwoord').fill(process.env.METERKAST_PASSWORD ?? 'proefwachtwoord');
      await page.getByRole('button', { name: 'Inloggen' }).click();
      await page.getByPlaceholder('Nieuw ontwerp').fill('Widgetproef');
      await page.getByRole('button', { name: 'Nieuw ontwerp' }).click();
      await page.waitForURL(/#\/ontwerp\//);
    },
    navigate: async (page) => {
      await page.getByRole('link', { name: 'Kasten' }).click();
      await page.waitForTimeout(1300);
      await page.getByRole('link', { name: 'Groepenlijst' }).click();
    },
  },
];

function launchEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  const sysroot = process.env.BROWSER_SYSROOT ?? '/home/botrey/projects/wings of fury/.browser-deps';
  const libs = ['root/usr/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib/x86_64-linux-gnu'].map((d) => join(sysroot, d)).filter(existsSync);
  if (libs.length) env.LD_LIBRARY_PATH = [...libs, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  const fonts = join(sysroot, 'root/usr/share/fonts');
  if (existsSync(fonts)) {
    const dir = join(OUT, '.fontconfig');
    mkdirSync(join(dir, 'cache'), { recursive: true });
    writeFileSync(join(dir, 'fonts.conf'), `<?xml version="1.0"?>\n<fontconfig><dir>${fonts}</dir><cachedir>${dir}/cache</cachedir></fontconfig>\n`);
    env.FONTCONFIG_FILE = join(dir, 'fonts.conf');
  }
  return env;
}

async function tryHost(host: Host): Promise<boolean> {
  const browser = await chromium.launch({
    env: launchEnv(),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      // Een publieke https-site die naar 127.0.0.1 post, blokkeert Chromium anders
      // (Local Network Access). In productie staat de server gewoon op internet.
      '--disable-features=LocalNetworkAccessChecks',
      '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  const appKeys: string[] = [];
  await page.exposeFunction('__proefKey', (k: string) => appKeys.push(k));

  if (host.hideWebdriver) {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  }
  // SwiftShader rendert WebGL in software; een schermafdruk van het spel duurt dan lang.
  const shot = (file: string) => page.screenshot({ path: join(OUT, `${host.name}-${file}.png`), timeout: 120_000 });
  await page.addInitScript(({ server, project, config }) => {
    (window as unknown as { AudioFeedbackConfig: object }).AudioFeedbackConfig = { ...config, allowWebdriver: true, project };
    // Luistert waar de apps zelf luisteren (window, bubbelfase): wat hier aankomt, zou de app ook zien.
    window.addEventListener('keydown', (e) => (window as unknown as { __proefKey: (k: string) => void }).__proefKey(e.key));
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('script');
      s.src = `${server}/widget.js`;
      document.body.appendChild(s);
    });
  }, { server: SERVER, project: host.name, config: host.config ?? {} });

  const ok = (cond: boolean, msg: string) => {
    console.log(`  ${cond ? '✔' : '✘'} ${msg}`);
    return cond;
  };
  let pass = true;
  try {
    console.log(`\n${host.name}  ${host.url}`);
    await page.goto(host.url, { waitUntil: 'load', timeout: 90_000 });
    await host.setup?.(page);
    const w = page.locator('audio-feedback-widget');
    const btn = (name: string | RegExp) => w.getByRole('button', { name });
    await btn('Opnemen').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot('1-kaartje');

    await btn('Opnemen').click();
    await btn('Pauzeren').waitFor();
    await page.waitForTimeout(1200);
    await host.navigate?.(page);
    await page.waitForTimeout(1300);

    // Toetsenbordbediening in de widget: spatie, Enter, Escape en Ctrl+Z mogen de app niet bereiken.
    await host.ready?.(page);
    const stateBefore = await host.untouched?.(page);
    appKeys.length = 0;
    await btn('Pauzeren').focus();
    await page.keyboard.press('Space');
    await btn('Hervatten').waitFor();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await btn('Pauzeren').waitFor();
    pass = ok(appKeys.length === 0, `toetsen in de widget blijven in de widget (app zag: ${JSON.stringify(appKeys)})`) && pass;
    if (host.untouched) {
      const after = await host.untouched(page);
      pass = ok(after === stateBefore, `app-toestand onveranderd (${after})`) && pass;
      // Tegenproef: dezelfde Escape buiten de widget moet de app wél bereiken,
      // anders bewijst de controle hierboven niets.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const control = await host.untouched(page);
      pass = ok(control !== after, `tegenproef: Escape buiten de widget komt wel aan (${control})`) && pass;
    }
    await shot('2-opname');

    await page.waitForTimeout(800);
    await btn('Stoppen').click();
    await btn('Versturen').click();
    await w.getByText('Bedankt!').waitFor({ timeout: 20_000 });
    await shot('3-verstuurd');

    const res = await fetch(`${SERVER}/api/recordings?project=${host.name}`, { headers: { authorization: AUTH } });
    const [rec] = ((await res.json()) as { recordings: { url: string; durationMs: number; sizeBytes: number; timeline: { type: string; url?: string }[] }[] }).recordings;
    pass = ok(!!rec, 'opname staat op de server') && pass;
    if (rec) {
      console.log(`    url: ${rec.url}`);
      console.log(`    duur: ${(rec.durationMs / 1000).toFixed(1)} s, ${Math.round(rec.sizeBytes / 1024)} kB`);
      for (const e of rec.timeline) console.log(`    · ${e.type}${e.url ? ` ${e.url}` : ''}`);
      if (host.navigate) pass = ok(rec.timeline.some((e) => e.type === 'navigate'), 'navigatie in de app staat in de tijdlijn') && pass;
    }
    const widgetErrors = errors.filter((e) => /widget\.js|audio-feedback|127\.0\.0\.1:8790/.test(e));
    pass = ok(widgetErrors.length === 0, `geen fouten van de widget${widgetErrors.length ? `: ${widgetErrors.join(' | ')}` : ''}`) && pass;
    if (errors.length > widgetErrors.length) {
      console.log(`    (fouten van de app zelf, los van de widget: ${errors.length - widgetErrors.length})`);
      for (const e of errors.filter((x) => !widgetErrors.includes(x)).slice(0, 5)) console.log(`      ${e.slice(0, 200)}`);
    }
  } catch (err) {
    pass = ok(false, `fout: ${(err as Error).message.split('\n')[0]}`);
    await page.screenshot({ path: join(OUT, `${host.name}-fout.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
  return pass;
}

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
let allOk = true;
for (const host of hosts.filter((h) => only.length === 0 || only.includes(h.name))) {
  allOk = (await tryHost(host)) && allOk;
}
process.exitCode = allOk ? 0 : 1;
