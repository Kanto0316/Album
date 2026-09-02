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

async function loadOfflineAdapter(setDoc) {
  const source = await readFile(new URL('../js/offline-adapter.js', import.meta.url), 'utf8');
  const executableSource = source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/u, '');
  const window = {};
  const collection = (...parts) => parts;
  vm.runInNewContext(executableSource, {
    window,
    console,
    collection,
    doc: (...parts) => parts,
    setDoc,
    updateDoc: async () => {},
    deleteDoc: async () => {},
  });
  window.OfflineAdapter.init({});
  return window.OfflineAdapter;
}

test('une création offline utilise le localId comme identifiant Firestore', async () => {
  const writes = [];
  const adapter = await loadOfflineAdapter(async (reference, payload) => {
    writes.push({ reference, payload });
  });
  const result = await adapter.processAction({
    id: 'action-add', action: 'add', collection: 'page3',
    localId: 'detail_local_xxx', payload: { name: 'Article' },
  });

  assert.deepEqual({ ...result }, {
    ok: true, actionId: 'action-add', firestoreId: 'detail_local_xxx',
  });
  assert.deepEqual(writes, [{
    reference: [[{}, 'pages', 'page3', 'items'], 'detail_local_xxx'],
    payload: { name: 'Article' },
  }]);
});

test('rejouer la même création offline conserve un seul document Firestore', async () => {
  const firestore = new Map();
  const adapter = await loadOfflineAdapter(async (reference, payload) => {
    firestore.set(reference.at(-1), payload);
  });
  const action = {
    id: 'action-add', action: 'add', collection: 'page3',
    localId: 'detail_local_xxx', payload: { name: 'Article' },
  };

  await adapter.processAction(action);
  await adapter.processAction(action);

  assert.equal(firestore.size, 1);
  assert.deepEqual(firestore.get('detail_local_xxx'), { name: 'Article' });
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
    localId: 'site_local_1',
  });
  assert.deepEqual({ ...mappings[0] }, {
    localId: 'site_local_1', firestoreId: 'firestore-site', entityType: 'site',
  });
});

test('une erreur de mapping après setDoc permet une relance sans doublon', async () => {
  const firestore = new Map();
  const offlineAdapter = await loadOfflineAdapter(async (reference, payload) => {
    firestore.set(reference.at(-1), payload);
  });
  let mappingAttempts = 0;
  const materialAdapter = await loadMaterialAdapter({
    processAction: offlineAdapter.processAction,
    getFirestoreId: async (id) => id,
    saveMapping: async () => {
      mappingAttempts += 1;
      if (mappingAttempts === 1) throw new Error('Erreur mapping simulée');
    },
  });
  const action = {
    id: 'action-detail', type: 'createDetail', localId: 'detail_local_xxx',
    payload: { siteId: 'site-firestore', itemId: 'item-firestore', name: 'Article' },
  };

  const firstResult = await materialAdapter.syncAction(action);
  const secondResult = await materialAdapter.syncAction(action);

  assert.equal(firstResult.ok, false);
  assert.equal(secondResult.ok, true);
  assert.equal(firestore.size, 1);
  assert.equal(secondResult.firestoreId, 'detail_local_xxx');
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
