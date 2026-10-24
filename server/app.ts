// HTTP-laag zonder framework. Routes:
//   GET  /widget.js                  het script dat apps insluiten
//   POST /api/recordings             upload (multipart: meta + audio), CORS per origin
//   GET  /api/recordings             lijst              ┐
//   GET  /api/recordings/:id/audio   audio, met Range   ├ beheer, Basic auth
//   GET  /api/recordings/:id/audio.mp3 als mp3 (ffmpeg) │
//   GET  /api/recordings/:id/events  events als JSON    │
//   DELETE /api/recordings/:id       verwijderen        │
//   GET  /admin                      luisterpagina      │
//   GET  /admin/sites                sitebeheer         │
//   GET  /api/sites                  sites als JSON     │
//   POST /api/sites                  site toevoegen     │
//   PUT  /api/sites/:id              site wijzigen      │
//   DELETE /api/sites/:id            site verwijderen   ┘
//   GET  /api/sites/config           URL-instellingen van de site die het vraagt (voor de widget)
//   GET  /openapi.yaml               de spec van upload en eventschema, voor wie een eigen client bouwt
//   GET  /                           demopagina (alleen met DEMO aan)
//   GET  /health

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { cleanUrl, STRICT_URL_OPTIONS, type UrlOptions } from '../widget/src/clean-url.ts';
import { eventsDocument, eventsFileName, mp3FileName, renderAdmin, renderSites } from './admin.ts';
import { Mp3Error, sendMp3 } from './mp3.ts';
import { parseSiteInput, SiteConflictError, type SiteStore } from './sites.ts';
import { Storage, type StoredRecording } from './storage.ts';
import { AUDIO_TYPES, baseAudioType, parseMeta, sniffAudio, ValidationError } from './validate.ts';

export interface AppConfig {
  storage: Storage;
  /** Welke sites mogen insturen, en wat er per site van de URL bewaard blijft. */
  sites: SiteStore;
  adminPassword: string;
  maxUploadBytes: number;
  /** Bovengrens voor alle opnames samen op schijf; daarboven gaan de oudste weg. 0 is geen grens. */
  maxStorageBytes: number;
  /** Uploads die tegelijk binnen mogen komen; elke upload staat even in het geheugen. */
  maxConcurrentUploads: number;
  /** Het ffmpeg-programma voor de mp3-download; een kale naam wordt in PATH gezocht. */
  ffmpegPath: string;
  /** mp3-omzettingen die tegelijk mogen lopen; elke is een ffmpeg-proces op een kleine CPU. */
  maxConcurrentConversions: number;
  /** Uploads per IP (IPv6: per /64) per uur. */
  rateLimit: number;
  /** Uploads per uur van alle IP's samen. */
  rateLimitGlobal: number;
  /** Gaat terug naar de widget, die het na het versturen laat zien. 0 is: alles bewaren. */
  retentionDays: number;
  /** Demopagina op /, en uploads vanaf de eigen origin onder het project "demo". */
  demo: boolean;
  /** Map met widget.js en de statische bestanden. */
  distDir: string;
  publicDir: string;
  version: string;
  trustProxy: boolean;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const fwd = req.headers['x-forwarded-for'];
  // Elke proxy zet achteraan wie hem aansprak. Het laatste adres komt dus van onze
  // eigen proxy (Caddy); wat ervoor staat, kan de client zelf hebben meegestuurd.
  if (trustProxy && typeof fwd === 'string') {
    const last = fwd.split(',').at(-1)!.trim();
    if (isIP(last)) return last;
  }
  return req.socket.remoteAddress ?? '';
}

/** De sleutel voor de rate limit. Eén IPv6-aansluiting heeft een heel /64, dus die tellen we samen. */
export function rateKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (isIP(ip) !== 6) return ip;
  const [head = '', tail = ''] = ip.split('%')[0]!.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Breekt de stream af zodra hij groter wordt dan max, ook zonder (eerlijke) Content-Length. */
function limitBytes(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > max) cb(new HttpError(413, 'upload te groot'));
      else cb(null, chunk);
    },
  });
}

const MAX_TRACKED_IPS = 10_000;
const DEMO_PROJECT = 'demo';
const MAX_JSON_BYTES = 64 * 1024;
const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; media-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function createApp(config: AppConfig) {
  const { storage } = config;
  const uploads = new Map<string, number[]>();
  let recentUploads: number[] = [];
  let activeUploads = 0;
  let activeConversions = 0;

  function rateLimited(ip: string): boolean {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const key = rateKey(ip);
    const recent = (uploads.get(key) ?? []).filter((t) => t > hourAgo);
    // Opnieuw invoegen zet de sleutel achteraan; vooraan staat dan wie het langst niets deed.
    uploads.delete(key);
    uploads.set(key, recent);
    while (uploads.size > MAX_TRACKED_IPS) uploads.delete(uploads.keys().next().value!);
    if (recent.length >= config.rateLimit) return true;
    recentUploads = recentUploads.filter((t) => t > hourAgo);
    if (recentUploads.length >= config.rateLimitGlobal) return true;
    recent.push(now);
    recentUploads.push(now);
    return false;
  }

  function isAdmin(req: IncomingMessage): boolean {
    if (!config.adminPassword) return false;
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    const a = Buffer.from(password);
    const b = Buffer.from(config.adminPassword);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
    if (isAdmin(req)) return true;
    if (!config.adminPassword) {
      json(res, 404, { error: 'beheer staat uit (ADMIN_PASSWORD is niet gezet)' });
      return false;
    }
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="audio-feedback", charset="UTF-8"', 'Cache-Control': 'no-store' });
    res.end();
    return false;
  }

  /** De demopagina op de eigen origin; alleen als die aanstaat. */
  function isDemoOrigin(req: IncomingMessage, origin: string): boolean {
    return config.demo && origin !== '' && hostOf(origin) === (req.headers.host ?? '');
  }

  /** Basic auth gaat automatisch mee; zonder deze check kan een andere site een wijziging uitlokken. */
  function requireSameOrigin(req: IncomingMessage, origin: string): void {
    if (origin && hostOf(origin) !== req.headers.host) throw new HttpError(403, 'alleen vanaf de beheerpagina');
  }

  /** Alleen application/json: een formulier van een andere site kan dat niet zonder preflight versturen. */
  async function readJson(req: IncomingMessage): Promise<unknown> {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'verwacht application/json');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) throw new HttpError(413, 'te groot');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'geen geldige JSON');
    }
  }

  /** Het adres waarop apps de widget laden, voor de scripttag in /admin/sites. */
  function publicBase(req: IncomingMessage): string {
    const fwd = req.headers['x-forwarded-proto'];
    const proto = config.trustProxy && typeof fwd === 'string' ? fwd.split(',')[0]!.trim() : 'http';
    return `${proto}://${req.headers.host ?? 'localhost'}`;
  }

  function sendAdminHtml(res: ServerResponse, html: string): void {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': ADMIN_CSP,
      'Referrer-Policy': 'no-referrer',
    });
    res.end(html);
  }

  async function serveFile(res: ServerResponse, path: string, type: string, cache: string): Promise<void> {
    let data: Buffer;
    try {
      data = await readFile(path);
    } catch {
      return json(res, 404, { error: 'niet gevonden' });
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': cache,
      // Ook te laden door apps die Cross-Origin-Embedder-Policy aanzetten.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(data);
  }

  async function handleUpload(req: IncomingMessage, res: ServerResponse, origin: string, sameOrigin: boolean): Promise<void> {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > config.maxUploadBytes) throw new HttpError(413, 'upload te groot');
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.startsWith('multipart/form-data')) throw new HttpError(415, 'verwacht multipart/form-data');
    if (activeUploads >= config.maxConcurrentUploads) {
      res.setHeader('Retry-After', '30');
      throw new HttpError(503, 'het is even druk, probeer het zo opnieuw');
    }
    if (rateLimited(clientIp(req, config.trustProxy))) throw new HttpError(429, 'te veel opnames, probeer het later opnieuw');
    activeUploads++;
    try {
      await receiveUpload(req, res, contentType, origin, sameOrigin);
    } finally {
      activeUploads--;
    }
  }

  async function receiveUpload(req: IncomingMessage, res: ServerResponse, contentType: string, origin: string, sameOrigin: boolean): Promise<void> {
    const limited = req.pipe(limitBytes(config.maxUploadBytes));
    req.on('error', (err) => limited.destroy(err));
    let form: FormData;
    try {
      form = await new Request('http://upload.local/', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: Readable.toWeb(limited) as ReadableStream,
        duplex: 'half',
      } as RequestInit).formData();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof HttpError) throw cause;
      throw new HttpError(400, 'ongeldige multipart-body');
    }

    const meta = parseMeta(form.get('meta'));
    // De demopagina staat open voor iedereen; zijn opnames blijven apart van die van de apps.
    const projectAllowed = sameOrigin ? meta.project === DEMO_PROJECT : config.sites.allows(origin, meta.project);
    if (!projectAllowed) throw new HttpError(403, `deze website mag niet insturen onder project ${meta.project}`);
    // Wat de widget ook stuurt: er blijft niet meer van de URL over dan in /admin/sites staat.
    const urlOptions: UrlOptions = (!sameOrigin && config.sites.match(origin)) || STRICT_URL_OPTIONS;
    meta.url = cleanUrl(meta.url, urlOptions);
    for (const entry of meta.timeline) {
      if (!entry.url) continue;
      const cleaned = cleanUrl(entry.url, urlOptions);
      if (cleaned) entry.url = cleaned;
      else delete entry.url;
    }
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) throw new ValidationError('audio ontbreekt');
    const sniffed = sniffAudio(new Uint8Array(await audio.slice(0, 12).arrayBuffer()));
    const claimed = baseAudioType(meta.mimeType);
    if (!sniffed) throw new ValidationError('audio is geen webm, ogg of mp4');
    if (sniffed !== claimed) meta.mimeType = sniffed;

    const reply = { id: meta.id, retentionDays: config.retentionDays };
    if (await storage.exists(meta.id)) return json(res, 200, { ...reply, duplicate: true });
    if (config.maxStorageBytes > 0 && audio.size > config.maxStorageBytes) {
      throw new HttpError(507, 'de opname is groter dan de hele opslag');
    }
    const { ext, contentType: audioType } = AUDIO_TYPES[sniffed]!;
    const record: StoredRecording = {
      ...meta,
      receivedAt: new Date().toISOString(),
      origin,
      audioFile: `${meta.id}.${ext}`,
      audioType,
      sizeBytes: audio.size,
    };
    const evicted = await storage.saveWithin(record, audio, config.maxStorageBytes);
    if (evicted) console.log(`[quota] opslag vol: ${evicted} oudste opname(s) verwijderd voor nieuwe feedback`);
    // Zonder URL: daar kunnen persoonsgegevens in staan, en de logs vallen buiten de bewaartermijn.
    console.log(`[upload] ${record.project} ${record.id} ${Math.round(record.durationMs / 1000)}s`);
    json(res, 201, reply);
  }

  async function serveAudio(req: IncomingMessage, res: ServerResponse, record: StoredRecording): Promise<void> {
    const path = storage.audioPath(record);
    const size = (await stat(path)).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    const headers: Record<string, string | number> = {
      'Content-Type': record.audioType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="${record.audioFile}"`,
    };
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return void res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    createReadStream(path).pipe(res);
  }

  async function serveMp3(req: IncomingMessage, res: ServerResponse, record: StoredRecording): Promise<void> {
    const headers = {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${mp3FileName(record)}"`,
    };
    // Een HEAD hoeft geen omzetting: de lengte kennen we toch niet van tevoren.
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return void res.end();
    }
    if (activeConversions >= config.maxConcurrentConversions) {
      res.setHeader('Retry-After', '10');
      throw new HttpError(503, 'het is even druk, probeer het zo opnieuw');
    }
    activeConversions++;
    try {
      await sendMp3(config.ffmpegPath, storage.audioPath(record), res, headers);
    } catch (err) {
      if (!(err instanceof Mp3Error)) throw err;
      console.error(`[mp3] ${record.id}: ${err.message}`);
      throw err.unavailable
        ? new HttpError(501, 'mp3-omzetting is niet beschikbaar op deze server (ffmpeg ontbreekt)')
        : new HttpError(500, 'omzetten naar mp3 lukte niet');
    } finally {
      activeConversions--;
    }
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';

    try {
      if (path === '/api/recordings' && (method === 'POST' || method === 'OPTIONS')) {
        // Zonder een geldige origin geen upload. Ook een fout krijgt CORS-headers,
        // anders ziet de widget alleen "netwerkfout" in plaats van de reden.
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
        const sameOrigin = isDemoOrigin(req, origin);
        if (!origin || (!sameOrigin && !config.sites.allows(origin))) {
          throw new HttpError(403, 'deze website mag geen feedback insturen');
        }
        if (method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          });
          return void res.end();
        }
        return await handleUpload(req, res, origin, sameOrigin);
      }

      if (method === 'GET' || method === 'HEAD') {
        if (path === '/widget.js') {
          return await serveFile(res, join(config.distDir, 'widget.js'), 'text/javascript; charset=utf-8', 'public, max-age=300');
        }
        if (path === '/widget.js.map') {
          return await serveFile(res, join(config.distDir, 'widget.js.map'), 'application/json', 'public, max-age=300');
        }
        if (path === '/fonts/montserrat-latin-wght-normal.woff2') {
          // Lettertypen laadt de browser altijd met CORS, ook vanaf een andere site.
          res.setHeader('Access-Control-Allow-Origin', '*');
          return await serveFile(res, join(config.distDir, 'fonts', 'montserrat-latin-wght-normal.woff2'), 'font/woff2', 'public, max-age=31536000, immutable');
        }
        if (path === '/openapi.yaml') {
          // Ook op te halen door een spec-viewer op een andere site.
          res.setHeader('Access-Control-Allow-Origin', '*');
          return await serveFile(res, join(config.publicDir, 'openapi.yaml'), 'application/yaml; charset=utf-8', 'public, max-age=300');
        }
        if (path === '/health') return json(res, 200, { ok: true, version: config.version });
        if (path === '/api/sites/config') {
          // De widget vraagt dit bij Opnemen; zo geldt een wijziging in beheer meteen.
          if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
          }
          const demo = isDemoOrigin(req, origin);
          const site = origin && !demo ? config.sites.match(origin) : null;
          if (!demo && !site) throw new HttpError(403, 'deze website staat niet in de lijst');
          const { stripQuery, stripHash, keepParams } = site ?? STRICT_URL_OPTIONS;
          return json(res, 200, { stripQuery, stripHash, keepParams });
        }
        if (config.demo && (path === '/' || path === '/demo' || path.startsWith('/demo/'))) {
          return await serveFile(res, join(config.publicDir, 'demo.html'), 'text/html; charset=utf-8', 'no-cache');
        }
        if (path === '/admin.js') {
          return await serveFile(res, join(config.publicDir, 'admin.js'), 'text/javascript; charset=utf-8', 'no-cache');
        }
        if (path === '/admin') {
          if (!requireAdmin(req, res)) return;
          const records = await storage.list();
          const project = url.searchParams.get('project') ?? '';
          return sendAdminHtml(res, renderAdmin(records, project));
        }
        if (path === '/admin/sites') {
          if (!requireAdmin(req, res)) return;
          return sendAdminHtml(res, renderSites(config.sites.list(), publicBase(req)));
        }
        if (path === '/api/recordings') {
          if (!requireAdmin(req, res)) return;
          const project = url.searchParams.get('project');
          const records = (await storage.list()).filter((r) => !project || r.project === project);
          return json(res, 200, { recordings: records });
        }
        const audio = /^\/api\/recordings\/([0-9a-f-]{36})\/audio$/.exec(path);
        if (audio) {
          if (!requireAdmin(req, res)) return;
          const record = await storage.get(audio[1]!);
          if (!record) return json(res, 404, { error: 'niet gevonden' });
          return await serveAudio(req, res, record);
        }
        const mp3 = /^\/api\/recordings\/([0-9a-f-]{36})\/audio\.mp3$/.exec(path);
        if (mp3) {
          if (!requireAdmin(req, res)) return;
          const record = await storage.get(mp3[1]!);
          if (!record) return json(res, 404, { error: 'niet gevonden' });
          return await serveMp3(req, res, record);
        }
        const events = /^\/api\/recordings\/([0-9a-f-]{36})\/events$/.exec(path);
        if (events) {
          if (!requireAdmin(req, res)) return;
          const record = await storage.get(events[1]!);
          if (!record) return json(res, 404, { error: 'niet gevonden' });
          // Ingesprongen: dit bestand is om te delen en te lezen, niet alleen voor een programma.
          const data = JSON.stringify(eventsDocument(record), null, 2);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(data),
            'Cache-Control': 'private, no-store',
            'Content-Disposition': `attachment; filename="${eventsFileName(record)}"`,
          });
          return void res.end(data);
        }
      }

      const one = /^\/api\/recordings\/([0-9a-f-]{36})$/.exec(path);
      if (one && method === 'DELETE') {
        if (!requireAdmin(req, res)) return;
        requireSameOrigin(req, origin);
        return json(res, (await storage.remove(one[1]!)) ? 200 : 404, {});
      }

      const siteId = /^\/api\/sites\/([0-9a-f-]{36})$/.exec(path)?.[1];
      if (path === '/api/sites' || siteId) {
        if (!requireAdmin(req, res)) return;
        if (path === '/api/sites' && method === 'GET') return json(res, 200, { sites: config.sites.list() });
        requireSameOrigin(req, origin);
        if (path === '/api/sites' && method === 'POST') {
          return json(res, 201, await config.sites.create(parseSiteInput(await readJson(req))));
        }
        if (siteId && method === 'PUT') {
          const site = await config.sites.update(siteId, parseSiteInput(await readJson(req)));
          return site ? json(res, 200, site) : json(res, 404, { error: 'niet gevonden' });
        }
        if (siteId && method === 'DELETE') return json(res, (await config.sites.remove(siteId)) ? 200 : 404, {});
        throw new HttpError(405, 'methode niet toegestaan');
      }

      json(res, 404, { error: 'niet gevonden' });
    } catch (err) {
      if (err instanceof ValidationError) return json(res, 400, { error: err.message });
      if (err instanceof SiteConflictError) return json(res, 409, { error: err.message });
      if (err instanceof HttpError) {
        // De body is nog niet gelezen; de verbinding hergebruiken heeft dan geen zin.
        if (err.status === 413 || err.status === 429 || err.status === 503) res.setHeader('Connection', 'close');
        return json(res, err.status, { error: err.message });
      }
      console.error('[error]', err);
      if (!res.headersSent) json(res, 500, { error: 'interne fout' });
      else res.destroy();
    }
  };
}
