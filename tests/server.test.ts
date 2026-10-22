import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp, originAllowed } from '../server/app.ts';
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

function post(m: unknown, opts: { origin?: string; audio?: Uint8Array<ArrayBuffer> } = {}) {
  const body = new FormData();
  body.append('meta', JSON.stringify(m));
  body.append('audio', new Blob([opts.audio ?? WEBM_HEAD], { type: 'audio/webm' }), 'a.webm');
  const headers: Record<string, string> = {};
  if (opts.origin !== '') headers.origin = opts.origin ?? ORIGIN;
  return fetch(`${base}/api/recordings`, { method: 'POST', body, headers });
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'audio-feedback-'));
  storage = new Storage(dataDir);
  await storage.init();
  const root = resolve(import.meta.dirname, '..');
  const app = createApp({
    storage,
    allowedOrigins: [ORIGIN, 'https://*.example.nl'],
    adminPassword: 'geheim',
    maxUploadBytes: 64 * 1024,
    rateLimit: 1000,
    distDir: join(root, 'dist'),
    publicDir: join(root, 'public'),
    version: 'test',
    trustProxy: false,
  });
  server = createServer((req, res) => void app(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
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
});

describe('upload', () => {
  test('slaat audio en metadata op, met de URL en tijdlijn', async () => {
    const m = meta();
    const res = await post(m);
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
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
