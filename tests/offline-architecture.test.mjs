import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const REQUIRED_MESSAGE = 'Connexion Internet requise pour enregistrer cette modification.';

async function executeBrowserScript(path, window) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  vm.runInNewContext(source, { window, console, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
}

test('l’adaptateur offline refuse les créations, modifications et suppressions', async () => {
  const window = {};
  await executeBrowserScript('../js/offline-adapter.js', window);
  window.OfflineAdapter.init({});

  for (const action of ['add', 'update', 'delete', 'createDetail']) {
    const result = await window.OfflineAdapter.processAction({ id: action, action });
    assert.deepEqual({ ...result }, { ok: false, actionId: action, error: REQUIRED_MESSAGE });
  }
});

test('l’adaptateur métier ne rejoue aucune action locale', async () => {
  const window = {};
  await executeBrowserScript('../js/material-offline-adapter.js', window);
  const report = await window.MaterialOfflineAdapter.syncActions([{ id: 1 }, { id: 2 }]);
  assert.equal(report.total, 2);
  assert.equal(report.success, 0);
  assert.equal(report.failed, 2);
  assert.equal(report.errors[0].error, REQUIRED_MESSAGE);
});

test('la reconnexion ne déclenche aucune synchronisation différée', async () => {
  const listeners = new Map();
  let adapterCalls = 0;
  const window = {
    navigator: { onLine: false },
    OfflineAdapter: { init: () => { adapterCalls += 1; } },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    dispatchEvent: () => {},
  };
  await executeBrowserScript('../js/sync-manager.js', window);
  await window.SyncManager.init({ firebaseDb: {} });
  assert.equal(window.SyncManager.getStatus(), 'offline');

  listeners.get('offlineStatusChanged')({ detail: { online: true } });
  assert.equal(window.SyncManager.getStatus(), 'idle');
  assert.equal(adapterCalls, 1);
  assert.deepEqual({ ...await window.SyncManager.sync() }, {
    status: 'disabled', total: 0, success: 0, failed: 0,
  });
});

test('StorageService tente Firestore avant d’appliquer le cache et ne crée plus d’action en attente', async () => {
  const source = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
  const remoteRead = source.indexOf('const remote = await loadRemoteSnapshot()');
  const fallbackRead = source.indexOf("console.warn('[Storage] Firestore indisponible");
  assert.ok(remoteRead >= 0 && fallbackRead > remoteRead);
  assert.doesNotMatch(source, /OfflineSync\.addPendingAction/);
  assert.doesNotMatch(source, /OfflineActionBuilder\.createDetailAction/);
  assert.match(source, /createDetail: firestoreRequiredWrite\(createDetail\)/);
  assert.match(source, /removeDetail: firestoreRequiredWrite\(removeDetail\)/);
  assert.match(source, /addDetailReturn: firestoreRequiredWrite\(addDetailReturn\)/);
});
