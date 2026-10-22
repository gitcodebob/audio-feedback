// Start de feedbackserver. Instellingen via omgevingsvariabelen; zie README.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Storage } from './storage.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

const port = Number(env.PORT ?? 8080);
const host = env.HOST ?? '0.0.0.0';
const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const retentionDays = Number(env.RETENTION_DAYS ?? 90);

const storage = new Storage(resolve(env.DATA_DIR ?? join(root, 'data')));
await storage.init();

const app = createApp({
  storage,
  allowedOrigins,
  adminPassword: env.ADMIN_PASSWORD ?? '',
  // Onder de 10 MB die de Caddy op de host doorlaat, zodat wij de nette 413 geven.
  maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 9.5) * 1024 * 1024,
  rateLimit: Number(env.RATE_LIMIT_PER_HOUR ?? 60),
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
server.requestTimeout = 5 * 60 * 1000;
server.listen(port, host, () => {
  console.log(`audio-feedback ${pkg.version} op http://${host}:${port}`);
  console.log(`  toegestane origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : '(alleen eigen origin)'}`);
  if (!env.ADMIN_PASSWORD) console.log('  ADMIN_PASSWORD niet gezet: /admin staat uit');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
