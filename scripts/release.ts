// Brengt de widget uit als releases/widget-<versie>.js: een bestand dat daarna nooit meer
// verandert. Apps laden dat met integrity="sha384-…", dus de browser voert het alleen uit als
// het byte voor byte is wat hier gebouwd is. Een gekaapte server kan dan geen code in de
// apps zetten. De releases staan in git, zodat oude versies na een uitrol blijven bestaan
// en elke hash na te lezen is.
//
//   node scripts/release.ts      bouwt de versie uit package.json en drukt de scripttag af

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { widgetBuildOptions } from './widget-build-options.ts';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'releases');
const manifestPath = join(dir, 'integrity.json');
const SERVER = 'https://audio-feedback.hetzner.bobreijnders.nl';

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const inWidget = /export const VERSION = '([^']+)'/.exec(readFileSync(join(root, 'widget/src/widget.ts'), 'utf8'))?.[1];
if (inWidget !== version) {
  console.error(`package.json zegt ${version}, widget/src/widget.ts zegt ${inWidget}. Maak ze gelijk.`);
  process.exit(1);
}

// Zonder sourcemap: de verwijzing naar widget.js.map zou bij een andere versie horen.
const result = await esbuild.build({ ...widgetBuildOptions, minify: true, write: false, outfile: 'widget.js' });
const code = result.outputFiles[0]!.contents;
const integrity = `sha384-${createHash('sha384').update(code).digest('base64')}`;

const file = join(dir, `widget-${version}.js`);
if (existsSync(file)) {
  if (!Buffer.from(readFileSync(file)).equals(Buffer.from(code))) {
    console.error(`widget-${version}.js bestaat al, met andere inhoud. Apps die hem laden, rekenen op die hash.`);
    console.error('Verhoog de versie in package.json en widget/src/widget.ts en draai dit opnieuw.');
    process.exit(1);
  }
  console.log(`widget-${version}.js bestaat al en is gelijk aan deze build.`);
} else {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, code);
  console.log(`releases/widget-${version}.js geschreven (${code.length} bytes).`);
}

const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>) : {};
manifest[version] = integrity;
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);

console.log(`
Scripttag voor de apps:

<script src="${SERVER}/widget-${version}.js"
  integrity="${integrity}" crossorigin="anonymous"
  data-project="…" defer></script>

Commit releases/ en rol uit; daarna kunnen de apps hun tag bijwerken.`);
