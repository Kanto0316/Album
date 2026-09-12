import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const REQUIRED_MESSAGE = 'Connexion Internet obligatoire pour enregistrer cette modification.';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('la lecture tente explicitement le serveur avant le cache local', async () => {
  const storage = await source('js/storage.js');
  assert.match(storage, /getDocsFromServer\(pageRef\)/);
  assert.match(storage, /const remote = await loadRemoteSnapshot\(\);[\s\S]*applySnapshot\(remote\);[\s\S]*persistOfflineState\(\);/);
  assert.match(storage, /catch \(_error\) \{[\s\S]*applySnapshot\(offlineState\?\.snapshot/);
});

test('la création de détail ne possède plus de branche d’écriture offline', async () => {
  const storage = await source('js/storage.js');
  const createDetail = storage.slice(storage.indexOf('async function createDetail('), storage.indexOf('async function updateDetail('));
  assert.doesNotMatch(createDetail, /addPendingAction|OfflineActionBuilder|navigator\.onLine/);
  assert.match(createDetail, /await addDoc\(makePageItemsCollection\('page3'\)/);
});

test('toutes les primitives d’écriture passent par une transaction serveur', async () => {
  const storage = await source('js/storage.js');
  for (const primitive of ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'runTransaction']) {
    assert.match(storage, new RegExp(`async function ${primitive}\\(`));
  }
  assert.match(storage, /firestoreRunTransaction/);
  assert.match(storage, new RegExp(REQUIRED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

async function loadOfflineSync({ online = true } = {}) {
  const code = await source('js/offline-sync.js');
  const listeners = {};
  const window = {
    navigator: { onLine: online },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    dispatchEvent: () => {},
  };
  vm.runInNewContext(code, { window, CustomEvent: class {}, console });
  return window.OfflineSync;
}

test('la file pendingActions est désactivée et vide', async () => {
  const offline = await loadOfflineSync();
  await assert.rejects(offline.addPendingAction({ type: 'createDetail' }), { message: REQUIRED_MESSAGE });
  assert.deepEqual(Array.from(await offline.getPendingActions()), []);
  assert.equal(await offline.getPendingCount(), 0);
  assert.equal(JSON.stringify(await offline.syncPendingActions()), JSON.stringify({ ready: false, reason: 'disabled', actions: [] }));
});

test('le gestionnaire ne rejoue rien au retour du réseau', async () => {
  const code = await source('js/sync-manager.js');
  const listeners = {};
  const window = {
    OfflineSync: { init: async () => {}, isOnline: () => true },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
  vm.runInNewContext(code, { window, CustomEvent: class {}, console });
  await window.SyncManager.init();
  listeners.offlineStatusChanged({ detail: { online: true } });
  assert.equal(window.SyncManager.getStatus(), 'idle');
  assert.deepEqual({ ...(await window.SyncManager.sync()) }, { status: 'disabled', total: 0, success: 0, failed: 0 });
  assert.equal(window.SyncManager.isSynchronizing(), false);
});
