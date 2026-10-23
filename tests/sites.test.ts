import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeOrigin, parseSiteInput, SiteConflictError, SiteStore } from '../server/sites.ts';
import { ValidationError } from '../server/validate.ts';

async function store(seed: string[] = []): Promise<SiteStore> {
  const s = new SiteStore(join(await mkdtemp(join(tmpdir(), 'sites-')), 'sites.json'));
  await s.init(seed);
  return s;
}

describe('normalizeOrigin', () => {
  test('een geplakt adres wordt een origin', () => {
    assert.equal(normalizeOrigin(' HTTPS://Meterkast.Example.nl/ontwerp/12?x=1 '), 'https://meterkast.example.nl');
    assert.equal(normalizeOrigin('http://localhost:5173/'), 'http://localhost:5173');
  });

  test('wildcards en * blijven staan', () => {
    assert.equal(normalizeOrigin('https://*.example.nl'), 'https://*.example.nl');
    assert.equal(normalizeOrigin('*'), '*');
  });

  test('weigert wat geen website is', () => {
    for (const bad of ['', 'geen website', 'ftp://example.nl', 'https://*.nl', 'https://a*.example.nl', 'javascript:alert(1)']) {
      assert.throws(() => normalizeOrigin(bad), ValidationError, bad);
    }
  });
});

describe('parseSiteInput', () => {
  test('lijsten mogen als tekst met komma\'s, en standaard gaat alles weg', () => {
    assert.deepEqual(parseSiteInput({ origin: 'https://a.nl', projects: 'a, b ,a', keepParams: 'tab' }), {
      origin: 'https://a.nl', projects: ['a', 'b'], stripQuery: true, stripHash: true, keepParams: ['tab'],
    });
  });

  test('weigert ongeldige projecten en parameters', () => {
    assert.throws(() => parseSiteInput({ origin: 'https://a.nl', projects: ['../x'] }), ValidationError);
    assert.throws(() => parseSiteInput({ origin: 'https://a.nl', keepParams: ['a&b'] }), ValidationError);
  });
});

describe('SiteStore', () => {
  test('exact gaat voor een wildcard, en die gaat voor *', async () => {
    const s = await store(['*', 'https://*.example.nl', 'https://app.example.nl']);
    assert.equal(s.match('https://app.example.nl')!.origin, 'https://app.example.nl');
    assert.equal(s.match('https://x.example.nl')!.origin, 'https://*.example.nl');
    assert.equal(s.match('https://ander.nl')!.origin, '*');
  });

  test('wildcards: alleen subdomeinen, met hetzelfde protocol', async () => {
    const s = await store(['https://*.example.nl']);
    assert.ok(s.allows('https://app.example.nl'));
    assert.ok(!s.allows('https://example.nl'));
    assert.ok(!s.allows('https://evil-example.nl'));
    assert.ok(!s.allows('http://app.example.nl'));
  });

  test('projecten: leeg is elke naam, anders alleen die namen', async () => {
    const s = await store(['https://a.example.nl=a|a-test', 'https://*.example.org']);
    assert.ok(s.allows('https://a.example.nl'));
    assert.ok(s.allows('https://a.example.nl', 'a-test'));
    assert.ok(!s.allows('https://a.example.nl', 'b'));
    assert.ok(s.allows('https://x.example.org', 'wat-dan-ook'));
  });

  test('bewaart op schijf, en vult alleen uit de seed als er nog niets is', async () => {
    const s = await store(['https://a.nl']);
    const created = await s.create(parseSiteInput({ origin: 'https://b.nl', keepParams: ['tab'], stripHash: false }));
    await assert.rejects(s.create(parseSiteInput({ origin: 'https://b.nl' })), SiteConflictError);

    const again = new SiteStore(s.file);
    assert.deepEqual(await again.init(['https://iets-anders.nl']), { seeded: false });
    assert.deepEqual(again.list().map((x) => x.origin), ['https://a.nl', 'https://b.nl']);
    assert.deepEqual(again.get(created.id)!.keepParams, ['tab']);

    assert.ok(await again.update(created.id, parseSiteInput({ origin: 'https://b.nl' })));
    await assert.rejects(again.update(created.id, parseSiteInput({ origin: 'https://a.nl' })), SiteConflictError);
    assert.ok(await again.remove(created.id));
    assert.equal(await again.remove(created.id), false);
  });
});
