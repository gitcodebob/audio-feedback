// Bouwt widget/src naar één zelfstandig bestand, dist/widget.js, dat elke app
// met een gewone scripttag kan laden: IIFE, geen afhankelijkheden, geen CSS-bestand.
// Apps laden niet dit bestand maar een vaste release; zie release.ts.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { widgetBuildOptions } from './widget-build-options.ts';

const watch = process.argv.includes('--watch');

const options: esbuild.BuildOptions = {
  ...widgetBuildOptions,
  outfile: 'dist/widget.js',
  minify: !watch,
  sourcemap: true,
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
