import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, STRICT_URL_OPTIONS } from '../widget/src/clean-url.ts';

const URL_WITH_SECRETS = 'https://app.example.nl/dossier/12?tab=notities&token=geheim#access_token=abc';

describe('cleanUrl', () => {
  test('laat standaard query en hash weg', () => {
    assert.equal(cleanUrl(URL_WITH_SECRETS, { stripQuery: true, stripHash: true, keepParams: [] }), 'https://app.example.nl/dossier/12');
  });

  test('houdt alleen de toegestane parameters over', () => {
    assert.equal(
      cleanUrl(URL_WITH_SECRETS, { stripQuery: true, stripHash: true, keepParams: ['tab'] }),
      'https://app.example.nl/dossier/12?tab=notities',
    );
  });

  test('met alles aan blijft de URL heel', () => {
    assert.equal(cleanUrl(URL_WITH_SECRETS, { stripQuery: false, stripHash: false, keepParams: [] }), URL_WITH_SECRETS);
  });

  test('een ongeldige URL gaat niet mee', () => {
    assert.equal(cleanUrl('geen url', { stripQuery: true, stripHash: true, keepParams: [] }), '');
  });
});

describe('STRICT_URL_OPTIONS', () => {
  test('houdt alleen het pad over', () => {
    assert.equal(cleanUrl(URL_WITH_SECRETS, STRICT_URL_OPTIONS), 'https://app.example.nl/dossier/12');
  });
});
