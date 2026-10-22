// Gedeeld door build.ts (dist/widget.js) en release.ts (releases/widget-<versie>.js),
// zodat een release precies dezelfde code is als wat er lokaal getest wordt.
import type { BuildOptions } from 'esbuild';

export const widgetBuildOptions: BuildOptions = {
  entryPoints: ['widget/src/index.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15', 'firefox100', 'chrome100'],
  legalComments: 'none',
};
