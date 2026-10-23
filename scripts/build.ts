// Bouwt widget/src naar één zelfstandig bestand, dist/widget.js, dat elke app
// met een gewone scripttag kan laden: IIFE, geen afhankelijkheden, geen CSS-bestand.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const options: esbuild.BuildOptions = {
  entryPoints: ['widget/src/index.ts'],
  outfile: 'dist/widget.js',
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15', 'firefox100', 'chrome100'],
  minify: !watch,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

// Montserrat (OFL) zelf hosten: geen verzoek naar Google Fonts vanuit de apps.
const fontDir = 'node_modules/@fontsource-variable/montserrat';
mkdirSync('dist/fonts', { recursive: true });
copyFileSync(`${fontDir}/files/montserrat-latin-wght-normal.woff2`, 'dist/fonts/montserrat-latin-wght-normal.woff2');
copyFileSync(`${fontDir}/LICENSE`, 'dist/fonts/LICENSE-montserrat.txt');

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
