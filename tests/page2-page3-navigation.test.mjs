import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

test('les cartes OUT transmettent exactement leur identifiant Firestore à page3', () => {
  assert.match(appSource, /data-item-open="\$\{escapeHtml\(item\.id\)\}"/);
  assert.match(appSource, /const itemId = String\(button\.dataset\.itemOpen \|\| ''\)\.trim\(\)/);
  assert.match(appSource, /page3\.html\?siteId=\$\{encodeURIComponent\(siteId\)\}&itemId=\$\{encodeURIComponent\(itemId\)\}/);
});

test('la navigation refuse les identifiants manquants et journalise la destination', () => {
  assert.match(appSource, /if \(!siteId\)/);
  assert.match(appSource, /if \(!itemId\)/);
  assert.match(appSource, /console\.log\(siteId, itemId, urlDestination\)/);
});

test('page3 lit siteId et itemId avec URLSearchParams avant de charger les détails', () => {
  assert.match(appSource, /const params = new URLSearchParams\(window\.location\.search\)/);
  assert.match(appSource, /const itemId = String\(params\.get\('itemId'\) \|\| ''\)\.trim\(\)/);
  assert.match(appSource, /StorageService\.subscribeDetails\(\s*siteId,\s*itemId,/);
});

test('page3 attend la réponse Firestore des OUT avant de conclure que l’OUT est absent', () => {
  assert.match(appSource, /let itemSnapshotsReceived = 0/);
  assert.match(appSource, /if \(!currentItem && itemSnapshotsReceived > 1\)/);
});
