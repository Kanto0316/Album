import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadMaterialAdapter({ processAction, getFirestoreId, saveMapping }) {
  const source = await readFile(new URL('../js/material-offline-adapter.js', import.meta.url), 'utf8');
  const executableSource = source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/u, '');
  const window = {
    OfflineAdapter: { processAction },
    OfflineIdMapper: {
      init: async () => {},
      getFirestoreId,
      saveMapping,
    },
  };

  vm.runInNewContext(executableSource, { window, console, arrayUnion: (value) => value });
  await window.MaterialOfflineAdapter.init();
  return window.MaterialOfflineAdapter;
}

async function loadOfflineAdapter(addDoc) {
  const source = await readFile(new URL('../js/offline-adapter.js', import.meta.url), 'utf8');
  const executableSource = source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/u, '');
  const window = {};
  const collection = (...parts) => parts;
  vm.runInNewContext(executableSource, {
    window,
    console,
    addDoc,
    collection,
    doc: () => {},
    updateDoc: async () => {},
    deleteDoc: async () => {},
  });
  window.OfflineAdapter.init({});
  return window.OfflineAdapter;
}

test('OfflineAdapter retourne l’identifiant créé par Firestore', async () => {
  const adapter = await loadOfflineAdapter(async () => ({ id: 'firestore-created' }));
  const result = await adapter.processAction({
    id: 'action-add', action: 'add', collection: 'page1', payload: { name: 'Site' },
  });

  assert.deepEqual({ ...result }, {
    ok: true, actionId: 'action-add', firestoreId: 'firestore-created',
  });
});

test('crée un site via OfflineAdapter puis enregistre son mapping', async () => {
  const calls = [];
  const mappings = [];
  const adapter = await loadMaterialAdapter({
    processAction: async (action) => {
      calls.push(action);
      return { ok: true, actionId: action.id, firestoreId: 'firestore-site' };
    },
    getFirestoreId: async () => null,
    saveMapping: async (mapping) => mappings.push(mapping),
  });

  const result = await adapter.syncAction({
    id: 'action-1', type: 'createSite', localId: 'site_local_1', payload: { name: 'Site' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual({ ...calls[0], payload: { ...calls[0].payload } }, {
    id: 'action-1', action: 'add', collection: 'page1', payload: { name: 'Site' },
  });
  assert.deepEqual({ ...mappings[0] }, {
    localId: 'site_local_1', firestoreId: 'firestore-site', entityType: 'site',
  });
});

test('crée un OUT avec un identifiant de site Firestore existant', async () => {
  let mappedLookups = 0;
  let createdAction;
  const adapter = await loadMaterialAdapter({
    processAction: async (action) => {
      createdAction = action;
      return { ok: true, firestoreId: 'firestore-item' };
    },
    getFirestoreId: async () => { mappedLookups += 1; return null; },
    saveMapping: async () => {},
  });

  const result = await adapter.syncAction({
    type: 'createItem', localId: 'item_local_1', payload: { siteId: 'ABC123', name: 'OUT' },
  });

  assert.equal(result.ok, true);
  assert.equal(createdAction.payload.siteId, 'ABC123');
  assert.equal(mappedLookups, 0);
});

test('résout le mapping d’un site créé offline avant de créer un OUT', async () => {
  let createdAction;
  const adapter = await loadMaterialAdapter({
    processAction: async (action) => {
      createdAction = action;
      return { ok: true, firestoreId: 'firestore-item' };
    },
    getFirestoreId: async (id) => id === 'site_local_1' ? 'firestore-site' : null,
    saveMapping: async () => {},
  });

  const result = await adapter.syncAction({
    type: 'createItem', localId: 'item_local_1', payload: { siteId: 'site_local_1', name: 'OUT' },
  });

  assert.equal(result.ok, true);
  assert.equal(createdAction.payload.siteId, 'firestore-site');
});

test('retourne une erreur claire quand le mapping local est absent', async () => {
  const adapter = await loadMaterialAdapter({
    processAction: async () => assert.fail('La création ne doit pas être appelée'),
    getFirestoreId: async () => null,
    saveMapping: async () => {},
  });

  const result = await adapter.syncAction({
    type: 'createItem', localId: 'item_local_1', payload: { siteId: 'site_local_missing' },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Aucun identifiant Firestore trouvé pour siteId/);
});
