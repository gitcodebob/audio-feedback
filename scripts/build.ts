// Bouwt widget/src naar één zelfstandig bestand, dist/widget.js, dat elke app
// met een gewone scripttag kan laden: IIFE, geen afhankelijkheden, geen CSS-bestand.
import * as esbuild from 'esbuild';

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

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
