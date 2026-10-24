import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { appEvent, BUFFER_MS, EventBuffer } from '../widget/src/events.ts';

describe('appEvent', () => {
  test('neemt type, label en platte data over', () => {
    assert.deepEqual(appEvent('level', 'Nuuk', { golf: 2, zwaar: true, weg: { x: 1 } }), {
      type: 'level',
      label: 'Nuuk',
      data: { golf: '2', zwaar: 'true' },
    });
    assert.deepEqual(appEvent('game-over'), { type: 'game-over' });
  });

  test('weigert een ongeldig type en de types van de widget', () => {
    for (const bad of ['', '1e', 'met spatie', '<b>', 'x'.repeat(51), 42]) assert.equal(typeof appEvent(bad), 'string');
    assert.match(appEvent('navigate') as string, /van de widget zelf/);
  });
});

describe('EventBuffer', () => {
  test('geeft de laatste halve minuut terug, met at negatief ten opzichte van nu', () => {
    let now = 0;
    const buffer = new EventBuffer(() => now);
    buffer.push({ type: 'oud' });
    now = 10_000;
    buffer.push({ type: 'level', label: 'Nuuk' });
    now = BUFFER_MS + 5_000;
    assert.deepEqual(buffer.take(), [{ at: -25_000, type: 'level', label: 'Nuuk' }]);
    // Leeggehaald: een tweede opname krijgt ze niet nog eens.
    assert.deepEqual(buffer.take(), []);
  });

  test('houdt er hooguit 50 vast', () => {
    const buffer = new EventBuffer(() => 0);
    for (let i = 0; i < 80; i++) buffer.push({ type: 'tick', label: String(i) });
    const out = buffer.take();
    assert.equal(out.length, 50);
    assert.equal(out[0]!.label, '30');
  });
});
