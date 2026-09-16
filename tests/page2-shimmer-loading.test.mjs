import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const storageSource = readFileSync(new URL('../js/storage.js', import.meta.url), 'utf8');

test('page 2 waits for every initial data read and one rendered frame', () => {
  assert.match(appSource, /let isPage2Loading = true/);
  assert.match(appSource, /itemsSubscription\.initialRead/);
  assert.match(appSource, /detailCountsSubscription\.initialRead/);
  assert.match(appSource, /detailDesignationsSubscription\.initialRead/);
  assert.match(appSource, /detailRowsSubscription\.initialRead/);
  assert.match(appSource, /initialPurchasesReady/);
  assert.match(appSource, /initialUserNamesReady/);
  assert.match(appSource, /requestAnimationFrame\(\(\) => resolve\(results\)\)/);
  assert.match(appSource, /isPage2Loading = false/);
  assert.match(appSource, /await initSiteDetailPage/);
});

test('storage subscriptions expose a settled server-or-cache initial read', () => {
  assert.match(storageSource, /unsubscribe\.initialRead = initialRead/);
  assert.match(storageSource, /return \{ source: 'server' \}/);
  assert.match(storageSource, /return \{ source: 'cache', error \}/);
  assert.match(storageSource, /applySnapshot\(offlineState\.snapshot\)/);
});

