import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('les créations Firestore sont bloquées avant toute validation ou écriture offline', async () => {
  const storage = await readSource('../js/storage.js');
  for (const operation of ['createSite', 'createItem', 'createDetail']) {
    assert.match(
      storage,
      new RegExp(`async function ${operation}\\([^]*?\\{\\n  const offlineError = blockOfflineWrite\\(\\);\\n  if \\(offlineError\\) return offlineError;`),
    );
  }
  assert.doesNotMatch(storage, /OfflineActionBuilder\.createDetailAction/);
  assert.doesNotMatch(storage, /OfflineSync\.addPendingAction/);
});

test('les modifications et suppressions principales utilisent la même barrière réseau', async () => {
  const storage = await readSource('../js/storage.js');
  for (const operation of ['updateSiteName', 'removeSite', 'updateItemName', 'removeItem', 'updateDetail', 'removeDetail']) {
    assert.match(
      storage,
      new RegExp(`async function ${operation}\\([^]*?\\{\\n  const offlineError = blockOfflineWrite\\(\\);`),
    );
  }
  assert.match(storage, /reason: OFFLINE_WRITE_BLOCKED, error: OFFLINE_WRITE_BLOCKED/);
});

test('les trois FAB suivent automatiquement l’état réseau et expliquent leur blocage', async () => {
  const [app, connectivity, cache] = await Promise.all([
    readSource('../js/app.js'),
    readSource('../js/connectivity.js'),
    readSource('../js/read-cache.js'),
  ]);
  assert.match(app, /\['openCreateSite', 'openCreateItem', 'openDetailFormButton'\]/);
  assert.match(app, /button\.disabled = !online/);
  assert.match(app, /Vérifiez votre connexion internet/);
  assert.match(connectivity, /navigator\.onLine !== false/);
  assert.match(connectivity, /addEventListener\('online', publishConnectivity\)/);
  assert.match(connectivity, /addEventListener\('offline', publishConnectivity\)/);
  assert.doesNotMatch(cache, /Mode hors connexion — données du cache local/);
});
