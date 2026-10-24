import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Alle bestanden onder widget/src die de server (ook via via) importeert. */
function widgetImports(): Set<string> {
  const found = new Set<string>();
  const queue = readdirSync(join(root, 'server')).filter((f) => f.endsWith('.ts')).map((f) => join(root, 'server', f));
  while (queue.length) {
    const file = queue.pop()!;
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+\.ts)'/g)) {
      const target = resolve(dirname(file), spec!);
      const rel = relative(root, target);
      if (!rel.startsWith('widget/src/') || found.has(rel)) continue;
      found.add(rel);
      queue.push(target);
    }
  }
  return found;
}

test('de Dockerfile neemt elk bestand uit widget/src mee dat de server importeert', () => {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const copied = /^COPY (widget\/src\/.*) widget\/src\/$/m.exec(dockerfile)?.[1]!.split(/\s+/) ?? [];
  const missing = [...widgetImports()].filter((f) => !copied.includes(f));
  assert.deepEqual(missing, [], `ontbreekt in de COPY-regel van de Dockerfile: ${missing.join(', ')}`);
});
