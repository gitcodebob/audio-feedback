// HTTP-laag zonder framework. Routes:
//   GET  /widget.js                  het script dat apps insluiten
//   POST /api/recordings             upload (multipart: meta + audio), CORS per origin
//   GET  /api/recordings             lijst              ┐
//   GET  /api/recordings/:id/audio   audio, met Range   ├ beheer, Basic auth
//   DELETE /api/recordings/:id       verwijderen        │
//   GET  /admin                      luisterpagina      ┘
//   GET  /                           demopagina
//   GET  /health

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { renderAdmin } from './admin.ts';
import { Storage, type StoredRecording } from './storage.ts';
import { AUDIO_TYPES, baseAudioType, parseMeta, sniffAudio, ValidationError } from './validate.ts';

export interface AppConfig {
  storage: Storage;
  /** Exacte origins, of met een wildcard-subdomein: https://*.example.nl. "*" staat alles toe. */
  allowedOrigins: string[];
  adminPassword: string;
  maxUploadBytes: number;
  /** Uploads per IP per uur. */
  rateLimit: number;
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

export function originAllowed(origin: string, allowed: string[]): boolean {
  for (const rule of allowed) {
    if (rule === '*' || rule === origin) return true;
    const m = /^(https?:\/\/)\*\.(.+)$/.exec(rule);
    if (m && origin.startsWith(m[1]!) && origin.endsWith(`.${m[2]}`)) return true;
  }
  return false;
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
  if (trustProxy && typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? '';
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

export function createApp(config: AppConfig) {
  const { storage } = config;
  const uploads = new Map<string, number[]>();

  function rateLimited(ip: string): boolean {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recent = (uploads.get(ip) ?? []).filter((t) => t > hourAgo);
    recent.push(Date.now());
    uploads.set(ip, recent);
    if (uploads.size > 10_000) uploads.clear();
    return recent.length > config.rateLimit;
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

  async function handleUpload(req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > config.maxUploadBytes) throw new HttpError(413, 'upload te groot');
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.startsWith('multipart/form-data')) throw new HttpError(415, 'verwacht multipart/form-data');
    if (rateLimited(clientIp(req, config.trustProxy))) throw new HttpError(429, 'te veel opnames, probeer het later opnieuw');

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
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) throw new ValidationError('audio ontbreekt');
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const sniffed = sniffAudio(bytes.subarray(0, 12));
    const claimed = baseAudioType(meta.mimeType);
    if (!sniffed) throw new ValidationError('audio is geen webm, ogg of mp4');
    if (sniffed !== claimed) meta.mimeType = sniffed;

    if (await storage.exists(meta.id)) return json(res, 200, { id: meta.id, duplicate: true });
    const { ext, contentType: audioType } = AUDIO_TYPES[sniffed]!;
    const record: StoredRecording = {
      ...meta,
      receivedAt: new Date().toISOString(),
      origin,
      audioFile: `${meta.id}.${ext}`,
      audioType,
      sizeBytes: bytes.length,
    };
    await storage.save(record, bytes);
    console.log(`[upload] ${record.project} ${record.id} ${Math.round(record.durationMs / 1000)}s ${record.url}`);
    json(res, 201, { id: meta.id });
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
        const host = req.headers.host ?? '';
        const sameOrigin = origin !== '' && hostOf(origin) === host;
        if (!origin || (!sameOrigin && !originAllowed(origin, config.allowedOrigins))) {
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
        return await handleUpload(req, res, origin);
      }

      if (method === 'GET' || method === 'HEAD') {
        if (path === '/widget.js') {
          return await serveFile(res, join(config.distDir, 'widget.js'), 'text/javascript; charset=utf-8', 'public, max-age=300');
        }
        if (path === '/widget.js.map') {
          return await serveFile(res, join(config.distDir, 'widget.js.map'), 'application/json', 'public, max-age=300');
        }
        if (path === '/health') return json(res, 200, { ok: true, version: config.version });
        if (path === '/' || path === '/demo' || path.startsWith('/demo/')) {
          return await serveFile(res, join(config.publicDir, 'demo.html'), 'text/html; charset=utf-8', 'no-cache');
        }
        if (path === '/admin.js') {
          return await serveFile(res, join(config.publicDir, 'admin.js'), 'text/javascript; charset=utf-8', 'no-cache');
        }
        if (path === '/admin') {
          if (!requireAdmin(req, res)) return;
          const records = await storage.list();
          const project = url.searchParams.get('project') ?? '';
          const html = renderAdmin(records, project);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
            'Referrer-Policy': 'no-referrer',
          });
          return void res.end(html);
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
      }

      const one = /^\/api\/recordings\/([0-9a-f-]{36})$/.exec(path);
      if (one && method === 'DELETE') {
        if (!requireAdmin(req, res)) return;
        // Basic auth gaat automatisch mee; zonder deze check kan een andere site een DELETE uitlokken.
        if (origin && hostOf(origin) !== req.headers.host) throw new HttpError(403, 'alleen vanaf de beheerpagina');
        return json(res, (await storage.remove(one[1]!)) ? 200 : 404, {});
      }

      json(res, 404, { error: 'niet gevonden' });
    } catch (err) {
      if (err instanceof ValidationError) return json(res, 400, { error: err.message });
      if (err instanceof HttpError) {
        if (err.status === 413) res.setHeader('Connection', 'close');
        return json(res, err.status, { error: err.message });
      }
      console.error('[error]', err);
      if (!res.headersSent) json(res, 500, { error: 'interne fout' });
      else res.destroy();
    }
  };
}
