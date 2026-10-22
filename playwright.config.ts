import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Op deze machine mist Chromium systeembibliotheken. BROWSER_SYSROOT wijst naar een
// map met uitgepakte .deb's (zoals .browser-deps van wings-of-fury); bestaat hij
// niet, dan draait Chromium gewoon met wat het systeem heeft.
const sysroot = process.env.BROWSER_SYSROOT ?? '/home/botrey/projects/wings of fury/.browser-deps';
const libDirs = ['root/usr/lib/x86_64-linux-gnu', 'root/usr/lib', 'root/lib/x86_64-linux-gnu']
  .map((d) => join(sysroot, d))
  .filter((d) => existsSync(d));
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
if (libDirs.length) env.LD_LIBRARY_PATH = [...libDirs, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
// Zonder eigen fonts.conf zoekt fontconfig in /etc/fonts en vindt niets: dan staat
// er geen letter op de pagina en is elke tekst "onzichtbaar" voor Playwright.
const fontDir = join(sysroot, 'root', 'usr', 'share', 'fonts');
if (existsSync(fontDir)) {
  const dir = join(import.meta.dirname, 'test-results', '.fontconfig');
  mkdirSync(join(dir, 'cache'), { recursive: true });
  const conf = join(dir, 'fonts.conf');
  writeFileSync(conf, `<?xml version="1.0"?>\n<fontconfig><dir>${fontDir}</dir><cachedir>${join(dir, 'cache')}</cachedir></fontconfig>\n`);
  env.FONTCONFIG_FILE = conf;
}

export const PORT = Number(process.env.E2E_PORT ?? 8790);

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    // De host-app (e2e/widget.spec.ts) draait op localhost:PORT+1, de feedbackserver
    // op 127.0.0.1:PORT: twee origins, dus de upload is echt cross-origin.
    baseURL: `http://localhost:${PORT + 1}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          env,
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    command: 'node server/index.ts',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: join(tmpdir(), `audio-feedback-e2e-${process.pid}`),
      ADMIN_PASSWORD: 'e2e',
      ALLOWED_ORIGINS: `http://localhost:${PORT + 1}`,
      TRUST_PROXY: 'false',
    },
  },
});
