// Start de feedbackserver. Instellingen via omgevingsvariabelen; zie README.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { SiteStore } from './sites.ts';
import { Storage } from './storage.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

const port = Number(env.PORT ?? 8080);
const host = env.HOST ?? '0.0.0.0';
const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const retentionDays = Number(env.RETENTION_DAYS ?? 90);

const megabytes = (value: string | undefined, fallback: number) => Number(value ?? fallback) * 1024 * 1024;

const dataDir = resolve(env.DATA_DIR ?? join(root, 'data'));
const storage = new Storage(dataDir);
await storage.init();
const sites = new SiteStore(join(dataDir, 'sites.json'));
// ALLOWED_ORIGINS geldt alleen bij de eerste start; daarna is sites.json de bron (beheerd in /admin/sites).
const { seeded } = await sites.init(allowedOrigins);

const app = createApp({
  storage,
  sites,
  adminPassword: env.ADMIN_PASSWORD ?? '',
  // Onder de 10 MB die de Caddy op de host doorlaat, zodat wij de nette 413 geven.
  maxUploadBytes: megabytes(env.MAX_UPLOAD_MB, 9.5),
  maxStorageBytes: megabytes(env.MAX_STORAGE_MB, 2048),
  maxConcurrentUploads: Number(env.MAX_CONCURRENT_UPLOADS ?? 4),
  rateLimit: Number(env.RATE_LIMIT_PER_HOUR ?? 60),
  rateLimitGlobal: Number(env.RATE_LIMIT_GLOBAL_PER_HOUR ?? 600),
  retentionDays: retentionDays > 0 ? retentionDays : 0,
  demo: env.DEMO !== 'false',
  distDir: join(root, 'dist'),
  publicDir: join(root, 'public'),
  version: env.APP_VERSION ?? pkg.version,
  trustProxy: env.TRUST_PROXY !== 'false',
});

async function purge(): Promise<void> {
  if (!(retentionDays > 0)) return;
  const removed = await storage.purgeOlderThan(retentionDays).catch((err) => {
    console.error('[purge]', err);
    return 0;
  });
  if (removed) console.log(`[purge] ${removed} opname(s) ouder dan ${retentionDays} dagen verwijderd`);
}
await purge();
setInterval(purge, 6 * 60 * 60 * 1000).unref();

const server = createServer((req, res) => void app(req, res));
// Gelijk aan de time-out van de widget: 10 MB past daarin ook over een trage mobiele verbinding.
server.requestTimeout = 120 * 1000;
server.listen(port, host, () => {
  console.log(`audio-feedback ${pkg.version} op http://${host}:${port}`);
  const list = sites.list().map((s) => s.origin);
  console.log(`  sites (${seeded ? 'net gevuld uit ALLOWED_ORIGINS' : sites.file}): ${list.length ? list.join(', ') : '(geen; alleen de demo)'}`);
  if (!seeded && allowedOrigins.length) console.log('  ALLOWED_ORIGINS genegeerd: de sites staan in sites.json en worden beheerd in /admin/sites');
  if (!env.ADMIN_PASSWORD) console.log('  ADMIN_PASSWORD niet gezet: /admin staat uit');
  if (env.DEMO !== 'false') console.log('  demopagina staat aan (DEMO=false zet hem uit)');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
