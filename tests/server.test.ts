import { after, before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp, originAllowed, rateKey, type AppConfig } from '../server/app.ts';
import { Storage } from '../server/storage.ts';

const WEBM_HEAD = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
const ORIGIN = 'https://defend-greenland.hetzner.bobreijnders.nl';
const AUTH = { authorization: `Basic ${Buffer.from('beheer:geheim').toString('base64')}` };

let server: Server;
let base: string;
let dataDir: string;
let storage: Storage;

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

function config(storage: Storage, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    storage,
    allowedOrigins: [ORIGIN, 'https://*.example.nl', 'https://gebonden.example.org=alleen-dit|of-dit'],
    adminPassword: 'geheim',
    maxUploadBytes: 64 * 1024,
    maxStorageBytes: 0,
    maxConcurrentUploads: 4,
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
async function withApp(overrides: Partial<AppConfig>, fn: (base: string, storage: Storage) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'audio-feedback-'));
  const own = new Storage(dir);
  await own.init();
  const { server, base } = await listen(createApp(config(own, overrides)));
  try {
    await fn(base, own);
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
  ({ server, base } = await listen(createApp(config(storage))));
});

after(async () => {
  server.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('originAllowed', () => {
  test('exact en wildcard-subdomein', () => {
    assert.ok(originAllowed(ORIGIN, [ORIGIN]));
    assert.ok(originAllowed('https://app.example.nl', ['https://*.example.nl']));
    assert.ok(!originAllowed('https://example.nl', ['https://*.example.nl']));
    assert.ok(!originAllowed('https://evil-example.nl', ['https://*.example.nl']));
    assert.ok(!originAllowed('http://app.example.nl', ['https://*.example.nl']));
    assert.ok(originAllowed('https://wat.dan.ook', ['*']));
  });

  test('met =project mag een origin alleen onder die projecten insturen', () => {
    const rules = ['https://a.example.nl=a|a-test', 'https://*.example.org'];
    assert.ok(originAllowed('https://a.example.nl', rules));
    assert.ok(originAllowed('https://a.example.nl', rules, 'a'));
    assert.ok(originAllowed('https://a.example.nl', rules, 'a-test'));
    assert.ok(!originAllowed('https://a.example.nl', rules, 'b'));
    assert.ok(originAllowed('https://x.example.org', rules, 'wat-dan-ook'));
  });
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
  test('slaat audio en metadata op, met de URL en tijdlijn', async () => {
    const m = meta();
    const res = await post(m);
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    // De widget laat de bewaartermijn zien na het versturen.
    assert.deepEqual(await res.json(), { id: m.id, retentionDays: 90 });
    const stored = await storage.get(m.id);
    assert.ok(stored);
    assert.equal(stored.url, `${ORIGIN}/editor#3`);
    assert.equal(stored.timeline.length, 3);
    assert.equal(stored.timeline[1]!.url, `${ORIGIN}/editor#4`);
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
      timeline: [{ at: 0, type: 'start', url: 'javascript:x' }, { at: 1, type: 'hack' }, 'onzin'],
      context: { ok: 'ja', obj: { nested: true } },
    });
    assert.equal((await post(m)).status, 201);
    const stored = await storage.get(m.id);
    assert.deepEqual(stored!.timeline, [{ at: 0, type: 'start' }]);
    assert.deepEqual(stored!.context, { ok: 'ja' });
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

  test('de beheerpagina escapet wat clients insturen', async () => {
    const m = meta({ title: '<script>alert(1)</script>', context: { x: '"><img src=x onerror=alert(1)>' } });
    await post(m);
    const html = await (await fetch(`${base}/admin`, { headers: AUTH })).text();
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes(m.id));
    // Het kenmerk dat de widget na het versturen toont.
    assert.ok(html.includes(`kenmerk <span class="code">${m.id.slice(0, 8)}</span>`));
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
