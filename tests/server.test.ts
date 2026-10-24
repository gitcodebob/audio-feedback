import { after, before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp, rateKey, type AppConfig } from '../server/app.ts';
import { SiteStore } from '../server/sites.ts';
import { Storage } from '../server/storage.ts';

const WEBM_HEAD = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
const ORIGIN = 'https://defend-greenland.hetzner.bobreijnders.nl';
const AUTH = { authorization: `Basic ${Buffer.from('beheer:geheim').toString('base64')}` };

let server: Server;
let base: string;
let dataDir: string;
let storage: Storage;
let sites: SiteStore;

const SEED = [ORIGIN, 'https://*.example.nl', 'https://gebonden.example.org=alleen-dit|of-dit'];

function meta(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    project: 'defend-greenland',
    startedAt: new Date().toISOString(),
    durationMs: 12_345,
    mimeType: 'audio/webm;codecs=opus',
    url: `${ORIGIN}/editor#3`,
    title: 'Editor',
    timeline: [
      { at: 0, type: 'start', url: `${ORIGIN}/editor#3`, title: 'Editor' },
      { at: 4000, type: 'navigate', url: `${ORIGIN}/editor#4` },
      { at: 12_345, type: 'stop' },
    ],
    context: { versie: '1.2' },
    client: { userAgent: 'test', language: 'nl', viewport: { width: 800, height: 600 }, widgetVersion: '0.1.0' },
    recovered: false,
    ...overrides,
  };
}

function post(
  m: unknown,
  opts: { origin?: string; audio?: Uint8Array<ArrayBuffer>; headers?: Record<string, string>; to?: string } = {},
) {
  const body = new FormData();
  body.append('meta', JSON.stringify(m));
  body.append('audio', new Blob([opts.audio ?? WEBM_HEAD], { type: 'audio/webm' }), 'a.webm');
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.origin !== '') headers.origin = opts.origin ?? ORIGIN;
  return fetch(`${opts.to ?? base}/api/recordings`, { method: 'POST', body, headers });
}

const root = resolve(import.meta.dirname, '..');

function config(storage: Storage, sites: SiteStore, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    storage,
    sites,
    adminPassword: 'geheim',
    maxUploadBytes: 64 * 1024,
    maxStorageBytes: 0,
    maxConcurrentUploads: 4,
    ffmpegPath: 'ffmpeg',
    maxConcurrentConversions: 2,
    rateLimit: 1000,
    rateLimitGlobal: 1000,
    retentionDays: 90,
    demo: false,
    distDir: join(root, 'dist'),
    publicDir: join(root, 'public'),
    version: 'test',
    trustProxy: false,
    ...overrides,
  };
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => void app(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  return { server, base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` };
}

/** Een eigen server met eigen opslag, voor instellingen die de andere tests in de weg zitten. */
async function withApp(
  overrides: Partial<AppConfig>,
  fn: (base: string, storage: Storage, sites: SiteStore) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'audio-feedback-'));
  const own = new Storage(dir);
  await own.init();
  const ownSites = new SiteStore(join(dir, 'sites.json'));
  await ownSites.init(SEED);
  const { server, base } = await listen(createApp(config(own, ownSites, overrides)));
  try {
    await fn(base, own, ownSites);
  } finally {
    server.closeAllConnections();
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'audio-feedback-'));
  storage = new Storage(dataDir);
  await storage.init();
  sites = new SiteStore(join(dataDir, 'sites.json'));
  await sites.init(SEED);
  ({ server, base } = await listen(createApp(config(storage, sites))));
});

after(async () => {
  server.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('rateKey', () => {
  test('IPv4 los, IPv6 per /64', () => {
    assert.equal(rateKey('203.0.113.7'), '203.0.113.7');
    assert.equal(rateKey('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(rateKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
    assert.equal(rateKey('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64');
    assert.equal(rateKey('2001:db8::1'), '2001:db8:0:0::/64');
    assert.notEqual(rateKey('2001:db8:1:2::1'), rateKey('2001:db8:1:3::1'));
  });
});

describe('upload', () => {
  test('slaat audio en metadata op, met de URL (standaard alleen het pad) en tijdlijn', async () => {
    const m = meta();
    const res = await post(m);
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    // De widget laat de bewaartermijn zien na het versturen.
    assert.deepEqual(await res.json(), { id: m.id, retentionDays: 90 });
    const stored = await storage.get(m.id);
    assert.ok(stored);
    // De site staat op de standaard: de server haalt de hash weg, ook al stuurde de widget hem mee.
    assert.equal(stored.url, `${ORIGIN}/editor`);
    assert.equal(stored.timeline.length, 3);
    assert.equal(stored.timeline[1]!.url, `${ORIGIN}/editor`);
    assert.equal(stored.origin, ORIGIN);
    assert.equal(stored.audioFile, `${m.id}.webm`);
    assert.deepEqual(stored.context, { versie: '1.2' });
  });

  test('dezelfde opname twee keer versturen geeft geen dubbele', async () => {
    const m = meta();
    assert.equal((await post(m)).status, 201);
    const again = await post(m);
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { duplicate: boolean }).duplicate, true);
  });

  test('weigert een origin die niet op de lijst staat', async () => {
    const res = await post(meta(), { origin: 'https://evil.example.com' });
    assert.equal(res.status, 403);
    // Wel leesbaar voor de widget, zodat die de reden kan tonen.
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://evil.example.com');
  });

  test('weigert zonder Origin-header', async () => {
    assert.equal((await post(meta(), { origin: '' })).status, 403);
  });

  test('een gebonden origin mag alleen onder zijn eigen projecten insturen', async () => {
    const origin = 'https://gebonden.example.org';
    assert.equal((await post(meta({ project: 'alleen-dit' }), { origin })).status, 201);
    const other = await post(meta({ project: 'defend-greenland' }), { origin });
    assert.equal(other.status, 403);
    assert.match(((await other.json()) as { error: string }).error, /defend-greenland/);
  });

  test('zonder demo mag de eigen origin niet insturen en is er geen demopagina', async () => {
    const own = new URL(base).origin;
    assert.equal((await post(meta(), { origin: own })).status, 403);
    assert.equal((await fetch(`${base}/`)).status, 404);
  });

  test('met demo mag de eigen origin insturen, maar alleen onder project demo', async () => {
    await withApp({ demo: true }, async (b) => {
      const origin = new URL(b).origin;
      assert.equal((await post(meta({ project: 'demo' }), { origin, to: b })).status, 201);
      // Anders zou iedereen via de demo "feedback van meterkast" kunnen insturen.
      assert.equal((await post(meta({ project: 'meterkast' }), { origin, to: b })).status, 403);
      assert.equal((await fetch(`${b}/`)).status, 200);
    });
  });

  test('de URL komt niet in de log', async () => {
    const log = mock.method(console, 'log', () => {});
    try {
      assert.equal((await post(meta({ url: `${ORIGIN}/geheim?token=abc` }))).status, 201);
      const lines = log.mock.calls.map((c) => c.arguments.join(' '));
      assert.ok(lines.some((l) => l.startsWith('[upload]')));
      assert.ok(!lines.some((l) => l.includes('token=abc') || l.includes('/geheim')));
    } finally {
      log.mock.restore();
    }
  });

  test('weigert iets dat geen audio is', async () => {
    const res = await post(meta(), { audio: new TextEncoder().encode('<html>niet echt audio</html>') });
    assert.equal(res.status, 400);
  });

  test('weigert een ongeldig id en een niet-http URL', async () => {
    assert.equal((await post(meta({ id: '../../etc/passwd' }))).status, 400);
    assert.equal((await post(meta({ url: 'javascript:alert(1)' }))).status, 400);
  });

  test('te groot geeft 413', async () => {
    const big = new Uint8Array(128 * 1024);
    big.set(WEBM_HEAD);
    assert.equal((await post(meta(), { audio: big })).status, 413);
  });

  test('preflight krijgt de juiste CORS-headers', async () => {
    const res = await fetch(`${base}/api/recordings`, { method: 'OPTIONS', headers: { origin: 'https://app.example.nl' } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example.nl');
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
  });

  test('vreemde velden in de tijdlijn en context worden weggefilterd', async () => {
    const m = meta({
      timeline: [{ at: 0, type: 'start', url: 'javascript:x' }, { at: 1, type: '<script>' }, { at: 2 }, 'onzin'],
      context: { ok: 'ja', obj: { nested: true } },
    });
    assert.equal((await post(m)).status, 201);
    const stored = await storage.get(m.id);
    assert.deepEqual(stored!.timeline, [{ at: 0, type: 'start' }]);
    assert.deepEqual(stored!.context, { ok: 'ja' });
  });

  test('events van de app gaan mee, ook die van vlak vóór de start', async () => {
    const m = meta({
      timeline: [
        { at: -12_000, type: 'level', label: 'Nuuk', data: { moeilijkheid: 'zwaar', golf: 3, nested: { x: 1 } } },
        { at: -90_000, type: 'screen', label: 'te lang geleden: wordt -30 s' },
        { at: 0, type: 'start', url: `${ORIGIN}/` },
        { at: 2_000, type: 'game-over', label: 'x'.repeat(500), url: `${ORIGIN}/?token=geheim` },
      ],
    });
    assert.equal((await post(m)).status, 201);
    const [level, screen, , over] = (await storage.get(m.id))!.timeline;
    assert.deepEqual(level, { at: -12_000, type: 'level', label: 'Nuuk', data: { moeilijkheid: 'zwaar', golf: '3' } });
    assert.equal(screen!.at, -30_000);
    assert.equal(over!.label!.length, 200);
    // Ook bij een event van de app blijft er van de URL niet meer over dan de site toestaat.
    assert.equal(over!.url, `${ORIGIN}/`);
  });

  test('hooguit 500 events van de app per opname; die van de widget blijven', async () => {
    const app = Array.from({ length: 600 }, (_, i) => ({ at: i, type: 'tick' }));
    const m = meta({ timeline: [...app, { at: 700, type: 'stop' }] });
    assert.equal((await post(m)).status, 201);
    const timeline = (await storage.get(m.id))!.timeline;
    assert.equal(timeline.filter((e) => e.type === 'tick').length, 500);
    assert.equal(timeline.at(-1)!.type, 'stop');
  });

  test('de OpenAPI-spec is op te halen', async () => {
    const res = await fetch(`${base}/openapi.yaml`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type')!, /yaml/);
    assert.match(await res.text(), /TimelineEntry:/);
  });
});

describe('sites', () => {
  const NEW = 'https://nieuw.example.com';
  const json = (body: unknown, extra: Record<string, string> = {}) =>
    ({ headers: { ...AUTH, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const config = (origin: string) => fetch(`${base}/api/sites/config`, { headers: { origin } });

  test('beheer vraagt om het wachtwoord', async () => {
    assert.equal((await fetch(`${base}/api/sites`)).status, 401);
    assert.equal((await fetch(`${base}/admin/sites`)).status, 401);
    assert.equal((await fetch(`${base}/api/sites`, { method: 'POST', ...json({ origin: NEW }), headers: { 'content-type': 'application/json' } })).status, 401);
  });

  test('de lijst begint met ALLOWED_ORIGINS, op de strenge standaard', async () => {
    const { sites: list } = (await (await fetch(`${base}/api/sites`, { headers: AUTH })).json()) as { sites: { origin: string; projects: string[]; stripQuery: boolean; stripHash: boolean }[] };
    const bound = list.find((s) => s.origin === 'https://gebonden.example.org')!;
    assert.deepEqual(bound.projects, ['alleen-dit', 'of-dit']);
    assert.equal(bound.stripQuery, true);
    assert.equal(bound.stripHash, true);
  });

  test('alleen JSON, en alleen vanaf de eigen origin', async () => {
    const form = await fetch(`${base}/api/sites`, { method: 'POST', headers: { ...AUTH, 'content-type': 'application/x-www-form-urlencoded' }, body: `origin=${NEW}` });
    assert.equal(form.status, 415);
    const crossSite = await fetch(`${base}/api/sites`, { method: 'POST', ...json({ origin: NEW }, { origin: 'https://evil.example.com' }) });
    assert.equal(crossSite.status, 403);
    assert.ok(!sites.match(NEW));
  });

  test('toevoegen, instellen, gebruiken en verwijderen', async () => {
    // Nog niet op de lijst: geen instellingen en geen upload.
    assert.equal((await config(NEW)).status, 403);
    assert.equal((await post(meta({ url: `${NEW}/x` }), { origin: NEW })).status, 403);

    const created = await fetch(`${base}/api/sites`, { method: 'POST', ...json({ origin: `${NEW}/een/pagina`, projects: 'nieuw' }) });
    assert.equal(created.status, 201);
    const site = (await created.json()) as { id: string; origin: string };
    assert.equal(site.origin, NEW, 'een geplakt adres wordt een origin');
    assert.equal((await fetch(`${base}/api/sites`, { method: 'POST', ...json({ origin: NEW }) })).status, 409);

    const put = await fetch(`${base}/api/sites/${site.id}`, {
      method: 'PUT', ...json({ origin: NEW, projects: ['nieuw'], stripQuery: true, keepParams: ['tab'], stripHash: false }),
    });
    assert.equal(put.status, 200);

    // De widget krijgt de nieuwe instellingen meteen.
    const res = await config(NEW);
    assert.equal(res.headers.get('access-control-allow-origin'), NEW);
    assert.deepEqual(await res.json(), { stripQuery: true, stripHash: false, keepParams: ['tab'] });

    // En de server houdt zich er bij een upload zelf ook aan.
    const m = meta({ project: 'nieuw', url: `${NEW}/x?tab=2&token=geheim#/route`, timeline: [{ at: 0, type: 'start', url: `${NEW}/x?token=geheim` }] });
    assert.equal((await post(m, { origin: NEW })).status, 201);
    const stored = (await storage.get(m.id))!;
    assert.equal(stored.url, `${NEW}/x?tab=2#/route`);
    assert.equal(stored.timeline[0]!.url, `${NEW}/x`);
    assert.equal((await post(meta({ project: 'ander', url: `${NEW}/x` }), { origin: NEW })).status, 403);

    assert.equal((await fetch(`${base}/api/sites/${site.id}`, { method: 'DELETE', headers: AUTH })).status, 200);
    assert.equal((await config(NEW)).status, 403);
    assert.equal((await post(meta({ project: 'nieuw', url: `${NEW}/x` }), { origin: NEW })).status, 403);
  });

  test('ongeldige invoer geeft 400 met een leesbare reden', async () => {
    for (const body of [{ origin: 'geen website' }, { origin: 'https://*.nl' }, { origin: NEW, projects: 'met spatie' }, { origin: NEW, keepParams: ['a=b'] }]) {
      const res = await fetch(`${base}/api/sites`, { method: 'POST', ...json(body) });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(((await res.json()) as { error: string }).error.length > 5);
    }
  });

  test('de demopagina krijgt de strenge standaard', async () => {
    await withApp({ demo: true }, async (b) => {
      const res = await fetch(`${b}/api/sites/config`, { headers: { origin: new URL(b).origin } });
      assert.deepEqual(await res.json(), { stripQuery: true, stripHash: true, keepParams: [] });
    });
  });

  test('de beheerpagina escapet en toont een scripttag met het publieke adres', async () => {
    await withApp({ trustProxy: true }, async (b, _storage, own) => {
      await own.create({ origin: 'https://*.escape.example.nl', projects: ['x'], stripQuery: true, stripHash: true, keepParams: ['"><b>'] });
      const html = await (await fetch(`${b}/admin/sites`, { headers: { ...AUTH, 'x-forwarded-proto': 'https' } })).text();
      assert.ok(!html.includes('"><b>'));
      // Achter Caddy: https uit X-Forwarded-Proto, en de host waarop de beheerder de pagina opende.
      assert.ok(html.includes(`&#60;script src=&#34;https://${new URL(b).host}/widget.js&#34; data-project=&#34;x&#34; defer&#62;`));
    });
  });
});

describe('misbruik beperken', () => {
  test('rate limit gebruikt het laatste adres uit X-Forwarded-For', async () => {
    await withApp({ rateLimit: 2, trustProxy: true }, async (b) => {
      // Wat vooraan staat, verzint de client; het laatste is van onze proxy.
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await post(meta(), { to: b, headers: { 'x-forwarded-for': `10.0.0.${i}, 198.51.100.9` } })).status);
      }
      assert.deepEqual(statuses, [201, 201, 429]);
    });
  });

  test('IPv6-adressen uit hetzelfde /64 tellen samen', async () => {
    await withApp({ rateLimit: 2, trustProxy: true }, async (b) => {
      const ip = (n: number) => ({ 'x-forwarded-for': `2001:db8:1:2::${n}` });
      assert.equal((await post(meta(), { to: b, headers: ip(1) })).status, 201);
      assert.equal((await post(meta(), { to: b, headers: ip(2) })).status, 201);
      assert.equal((await post(meta(), { to: b, headers: ip(3) })).status, 429);
      assert.equal((await post(meta(), { to: b, headers: { 'x-forwarded-for': '2001:db8:1:3::1' } })).status, 201);
    });
  });

  test('een globale limiet over alle IP\'s samen', async () => {
    await withApp({ rateLimitGlobal: 2, trustProxy: true }, async (b) => {
      const from = (n: number) => ({ to: b, headers: { 'x-forwarded-for': `198.51.100.${n}` } });
      assert.equal((await post(meta(), from(1))).status, 201);
      assert.equal((await post(meta(), from(2))).status, 201);
      assert.equal((await post(meta(), from(3))).status, 429);
    });
  });

  test('bij een volle opslag gaan de oudste opnames weg en blijft de nieuwe', async () => {
    await withApp({ maxStorageBytes: WEBM_HEAD.length * 2 }, async (b, own) => {
      const [a, bb, c] = [meta(), meta(), meta()];
      for (const m of [a, bb, c]) {
        assert.equal((await post(m, { to: b })).status, 201);
        await new Promise((r) => setTimeout(r, 5)); // receivedAt is op de milliseconde
      }
      assert.equal(await own.get(a.id), null, 'de oudste is weg');
      assert.ok(await own.get(bb.id));
      assert.ok(await own.get(c.id));
      assert.equal(own.usedBytes, WEBM_HEAD.length * 2);

    });
  });

  test('twee uploads tegelijk nemen samen niet meer ruimte dan er is', async () => {
    await withApp({}, async (b, own) => {
      // Er is nog plek voor precies één. Zonder slot zien ze allebei die plek, en nemen ze samen te veel.
      const max = WEBM_HEAD.length * 2;
      await post(meta(), { to: b });
      // Direct op de opslag: via HTTP komen ze zelden precies tegelijk aan.
      const record = (await own.list())[0]!;
      const fresh = [crypto.randomUUID(), crypto.randomUUID()];
      await Promise.all(fresh.map((id) =>
        own.saveWithin({ ...record, id, audioFile: `${id}.webm`, receivedAt: new Date().toISOString() }, WEBM_HEAD, max)));
      assert.deepEqual((await own.list()).map((r) => r.id).sort(), [...fresh].sort());
      assert.equal(own.usedBytes, max);
    });
  });

  test('een opname groter dan de hele opslag geeft 507 en laat de rest staan', async () => {
    await withApp({ maxStorageBytes: WEBM_HEAD.length + 4 }, async (b, own) => {
      const kept = meta();
      assert.equal((await post(kept, { to: b })).status, 201);
      const big = new Uint8Array(WEBM_HEAD.length * 2);
      big.set(WEBM_HEAD);
      assert.equal((await post(meta(), { to: b, audio: big })).status, 507);
      assert.ok(await own.get(kept.id));
    });
  });

  test('tegelijk verwijderen telt een opname maar één keer af', async () => {
    await withApp({}, async (b, own) => {
      const m = meta();
      await post(m, { to: b });
      const before = own.usedBytes;
      const results = await Promise.all([own.remove(m.id), own.remove(m.id)]);
      assert.deepEqual(results.sort(), [false, true]);
      assert.equal(own.usedBytes, before - WEBM_HEAD.length);
    });
  });

  test('de opslag telt bij het starten wat er al staat', async () => {
    const m = meta();
    await post(m);
    const again = new Storage(dataDir);
    await again.init();
    assert.equal(again.usedBytes, storage.usedBytes);
    assert.ok(again.usedBytes >= WEBM_HEAD.length);
  });

  test('te veel uploads tegelijk geeft 503 met Retry-After', async () => {
    await withApp({ maxConcurrentUploads: 1 }, async (b) => {
      // Een upload die blijft hangen houdt de enige plek bezet.
      const { port } = new URL(b);
      const slow = request({
        host: '127.0.0.1', port, path: '/api/recordings', method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'multipart/form-data; boundary=x' },
      });
      slow.on('error', () => {});
      slow.write('--x\r\n');
      await new Promise((r) => setTimeout(r, 100));
      const res = await post(meta(), { to: b });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('retry-after'), '30');
      slow.destroy();
    });
  });
});

describe('beheer', () => {
  test('lijst en audio vragen om het wachtwoord', async () => {
    assert.equal((await fetch(`${base}/api/recordings`)).status, 401);
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    const wrong = { authorization: `Basic ${Buffer.from('x:fout').toString('base64')}` };
    assert.equal((await fetch(`${base}/api/recordings`, { headers: wrong })).status, 401);
  });

  test('lijst, audio met Range, en verwijderen', async () => {
    const m = meta({ project: 'meterkast' });
    await post(m);
    const list = (await (await fetch(`${base}/api/recordings?project=meterkast`, { headers: AUTH })).json()) as {
      recordings: { id: string }[];
    };
    assert.deepEqual(list.recordings.map((r) => r.id), [m.id]);

    const full = await fetch(`${base}/api/recordings/${m.id}/audio`, { headers: AUTH });
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'audio/webm');
    assert.deepEqual(new Uint8Array(await full.arrayBuffer()), WEBM_HEAD);

    const part = await fetch(`${base}/api/recordings/${m.id}/audio`, { headers: { ...AUTH, range: 'bytes=4-7' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 4-7/${WEBM_HEAD.length}`);
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), WEBM_HEAD.subarray(4, 8));

    const crossSite = await fetch(`${base}/api/recordings/${m.id}`, { method: 'DELETE', headers: { ...AUTH, origin: 'https://evil.example.com' } });
    assert.equal(crossSite.status, 403);
    assert.equal((await fetch(`${base}/api/recordings/${m.id}`, { method: 'DELETE', headers: AUTH })).status, 200);
    assert.equal(await storage.get(m.id), null);
  });

  test('events als JSON-download, met de gegevens van de opname maar zonder die van de opslag', async () => {
    const m = meta({
      project: 'meterkast',
      timeline: [
        { at: -3_000, type: 'screen', label: 'Groepenlijst' },
        { at: 0, type: 'start', url: `${ORIGIN}/editor#3`, title: 'Editor' },
        { at: 65_000, type: 'error', label: 'Opslaan mislukt', data: { status: 500 } },
      ],
    });
    await post(m);
    const url = `${base}/api/recordings/${m.id}/events`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(`${base}/api/recordings/${crypto.randomUUID()}/events`, { headers: AUTH })).status, 404);

    const res = await fetch(url, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="meterkast-${m.id.slice(0, 8)}-events.json"`);
    const doc = (await res.json()) as Record<string, unknown>;
    assert.equal(doc.id, m.id);
    assert.equal(doc.kenmerk, m.id.slice(0, 8));
    assert.equal(doc.project, 'meterkast');
    assert.deepEqual(doc.context, { versie: '1.2' });
    assert.deepEqual(doc.events, [
      { time: '−0:03', at: -3_000, type: 'screen', label: 'Groepenlijst' },
      { time: '0:00', at: 0, type: 'start', url: `${ORIGIN}/editor`, title: 'Editor' },
      { time: '1:05', at: 65_000, type: 'error', label: 'Opslaan mislukt', data: { status: '500' } },
    ]);
    for (const key of ['audioFile', 'sizeBytes', 'origin', 'timeline']) assert.ok(!(key in doc), key);

    const html = await (await fetch(`${base}/admin`, { headers: AUTH })).text();
    assert.ok(html.includes(`href="/api/recordings/${m.id}/events" download="meterkast-${m.id.slice(0, 8)}-events.json"`));
  });

  test('de beheerpagina escapet wat clients insturen', async () => {
    const m = meta({
      title: '<script>alert(1)</script>',
      context: { x: '"><img src=x onerror=alert(1)>' },
      timeline: [{ at: -3_000, type: 'level', label: '<b>vet</b>', data: { k: '<i>schuin</i>' } }],
    });
    await post(m);
    const html = await (await fetch(`${base}/admin`, { headers: AUTH })).text();
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<b>vet</b>') && !html.includes('<i>schuin</i>'));
    // Van vóór de start: als negatieve tijd, en afspelen begint dan bij 0.
    assert.ok(html.includes('data-seek="0" title="Vóór de opname; afspelen vanaf het begin">−0:03</button>'));
    assert.ok(html.includes(m.id));
    // Het kenmerk dat de widget na het versturen toont.
    assert.ok(html.includes(`kenmerk <span class="code">${m.id.slice(0, 8)}</span>`));
  });
});

describe('mp3-download', () => {
  let toolDir: string;
  before(async () => {
    toolDir = await mkdtemp(join(tmpdir(), 'audio-feedback-ffmpeg-'));
  });
  after(() => rm(toolDir, { recursive: true, force: true }));

  /** Een ffmpeg-vervanger: schrijft zijn argumenten naast zich neer en doet verder wat het script zegt. */
  async function fakeFfmpeg(name: string, body: string): Promise<string> {
    const path = join(toolDir, name);
    await writeFile(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "$0.args"\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  const mp3Url = (base: string, id: string) => `${base}/api/recordings/${id}/audio.mp3`;

  test('vraagt om het wachtwoord en kent alleen bestaande opnames', async () => {
    const m = meta();
    await post(m);
    assert.equal((await fetch(mp3Url(base, m.id))).status, 401);
    assert.equal((await fetch(mp3Url(base, crypto.randomUUID()), { headers: AUTH })).status, 404);
  });

  test('geeft wat ffmpeg van de bewaarde audio maakt, als download', async () => {
    const ffmpegPath = await fakeFfmpeg('ok', `printf 'ID3-nep-mp3'`);
    await withApp({ ffmpegPath }, async (base, own) => {
      const m = meta({ project: 'meterkast' });
      await post(m, { to: base });
      const res = await fetch(mp3Url(base, m.id), { headers: AUTH });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'audio/mpeg');
      assert.equal(res.headers.get('content-disposition'), `attachment; filename="meterkast-${m.id.slice(0, 8)}.mp3"`);
      assert.equal(await res.text(), 'ID3-nep-mp3');

      const args = (await readFile(`${ffmpegPath}.args`, 'utf8')).split('\n');
      assert.equal(args[args.indexOf('-i') + 1], own.audioPath((await own.get(m.id))!));
      assert.ok(args.includes('libmp3lame'));
      assert.deepEqual(args.slice(args.indexOf('-f')), ['-f', 'mp3', 'pipe:1', '']);

      const html = await (await fetch(`${base}/admin`, { headers: AUTH })).text();
      assert.ok(html.includes(`href="/api/recordings/${m.id}/audio.mp3" download="meterkast-${m.id.slice(0, 8)}.mp3"`));
    });
  });

  test('een HEAD start ffmpeg niet', async () => {
    await withApp({ ffmpegPath: join(toolDir, 'bestaat-niet') }, async (base) => {
      const m = meta();
      await post(m, { to: base });
      const res = await fetch(mp3Url(base, m.id), { method: 'HEAD', headers: AUTH });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    });
  });

  test('een mislukte omzetting wordt een nette fout, zonder de uitvoer van ffmpeg', async () => {
    const ffmpegPath = await fakeFfmpeg('kapot', `echo 'geheim pad /data/recordings' >&2; exit 1`);
    const logged = mock.method(console, 'error', () => {});
    try {
      await withApp({ ffmpegPath }, async (base) => {
        const m = meta();
        await post(m, { to: base });
        const res = await fetch(mp3Url(base, m.id), { headers: AUTH });
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: 'omzetten naar mp3 lukte niet' });
      });
      // Wel in de serverlog, voor wie uitzoekt waarom.
      assert.ok(logged.mock.calls.some((c) => String(c.arguments[0]).includes('geheim pad')));
    } finally {
      logged.mock.restore();
    }
  });

  test('zonder ffmpeg: 501 met uitleg', async () => {
    const logged = mock.method(console, 'error', () => {});
    try {
      await withApp({ ffmpegPath: join(toolDir, 'bestaat-niet') }, async (base) => {
        const m = meta();
        await post(m, { to: base });
        const res = await fetch(mp3Url(base, m.id), { headers: AUTH });
        assert.equal(res.status, 501);
        assert.match(((await res.json()) as { error: string }).error, /ffmpeg/);
      });
    } finally {
      logged.mock.restore();
    }
  });

  test('een omzetting die halverwege stukgaat, lijkt niet compleet', async () => {
    const ffmpegPath = await fakeFfmpeg('halverwege', `printf 'half'; sleep 0.2; exit 1`);
    await withApp({ ffmpegPath }, async (base) => {
      const m = meta();
      await post(m, { to: base });
      await assert.rejects(async () => (await fetch(mp3Url(base, m.id), { headers: AUTH })).arrayBuffer());
    });
  });

  test('te veel omzettingen tegelijk: 503 met Retry-After, en ffmpeg stopt als de client weggaat', async () => {
    // Geeft meteen een stukje en blijft dan hangen, zodat de eerste omzetting bezet blijft.
    const ffmpegPath = await fakeFfmpeg('traag', `printf 'x'; exec sleep 5`);
    await withApp({ ffmpegPath, maxConcurrentConversions: 1 }, async (base) => {
      const m = meta();
      await post(m, { to: base });
      const first = new AbortController();
      const running = await fetch(mp3Url(base, m.id), { headers: AUTH, signal: first.signal });
      assert.equal(running.status, 200);

      const busy = await fetch(mp3Url(base, m.id), { headers: AUTH });
      assert.equal(busy.status, 503);
      assert.equal(busy.headers.get('retry-after'), '10');

      first.abort();
      // De plek komt vrij zodra ffmpeg gestopt is; de sleep van 5 seconden loopt niet uit.
      const started = Date.now();
      let status = 503;
      while (status === 503 && Date.now() - started < 2000) {
        await new Promise((r) => setTimeout(r, 50));
        const retry = await fetch(mp3Url(base, m.id), { headers: AUTH, signal: AbortSignal.timeout(500) }).catch(() => null);
        status = retry?.status ?? 503;
        retry?.body?.cancel().catch(() => {});
      }
      assert.equal(status, 200);
    });
  });

  // De echte ffmpeg: alleen waar die is (in de Docker-image altijd).
  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  test('met echte ffmpeg: een WebM met Opus wordt een mp3 van de juiste duur', { skip: !hasFfmpeg && 'ffmpeg ontbreekt' }, async () => {
    const webm = spawnSync(
      'ffmpeg',
      ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libopus', '-b:a', '32k', '-f', 'webm', 'pipe:1'],
      { maxBuffer: 1 << 20 },
    );
    assert.equal(webm.status, 0, String(webm.stderr));
    const m = meta();
    const posted = await post(m, { audio: new Uint8Array(webm.stdout) });
    assert.equal(posted.status, 201);

    const res = await fetch(mp3Url(base, m.id), { headers: AUTH });
    assert.equal(res.status, 200);
    const mp3 = new Uint8Array(await res.arrayBuffer());
    // Drie seconden op 64 kbit/s is 24 kB; een paar frames meer of minder is geen punt.
    assert.ok(mp3.length > 20_000 && mp3.length < 28_000, `${mp3.length} bytes`);
    // Het begint met een MPEG-frame (11 bits sync), niet met een Xing-header met nul frames.
    assert.ok(mp3[0] === 0xff && (mp3[1]! & 0xe0) === 0xe0, 'geen MPEG-frame aan het begin');
    assert.ok(!Buffer.from(mp3.subarray(0, 200)).includes('Xing') && !Buffer.from(mp3.subarray(0, 200)).includes('Info'));

    // En ffmpeg zelf leest het weer, met de duur van de opname (zonder Xing-header uit de bitrate).
    const file = join(toolDir, 'echt.mp3');
    await writeFile(file, mp3);
    const probe = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-f', 'null', '-']);
    assert.match(String(probe.stderr), /Duration: 00:00:0[23]\./);
  });
});

describe('bewaartermijn', () => {
  test('ruimt opnames op die ouder zijn dan de termijn', async () => {
    const m = meta();
    await post(m);
    const record = (await storage.get(m.id))!;
    await storage.save({ ...record, receivedAt: new Date(Date.now() - 100 * 86_400_000).toISOString() }, WEBM_HEAD);
    assert.ok((await storage.purgeOlderThan(90)) >= 1);
    assert.equal(await storage.get(m.id), null);
  });
});
