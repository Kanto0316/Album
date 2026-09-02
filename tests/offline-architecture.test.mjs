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

async function loadOfflineAdapter({ afterTransaction } = {}) {
  const source = await readFile(new URL('../js/offline-adapter.js', import.meta.url), 'utf8');
  const executableSource = source.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/u, '');
  const window = {};
  const database = { type: 'database' };
  const documents = new Map();
  const calls = {
    transactions: 0,
    markerReads: 0,
    sets: [],
    updates: [],
    deletes: [],
  };
  const pathOf = (reference) => reference.path.join('/');
  const collection = (parent, ...parts) => ({
    path: [...(parent.path || []), ...parts],
  });
  const doc = (parent, id) => ({ path: [...parent.path, id] });
  const setDoc = async (reference, payload) => {
    calls.sets.push({ reference, payload });
    documents.set(pathOf(reference), { ...payload });
  };
  const updateDoc = async (reference, payload) => {
    calls.updates.push({ reference, payload });
    documents.set(pathOf(reference), { ...documents.get(pathOf(reference)), ...payload });
  };
  const deleteDoc = async (reference) => {
    calls.deletes.push(reference);
    documents.delete(pathOf(reference));
  };
  const increment = (value) => ({ increment: value });
  const runTransaction = async (_database, callback) => {
    calls.transactions += 1;
    const transaction = {
      get: async (reference) => {
        calls.markerReads += 1;
        return { exists: () => documents.has(pathOf(reference)) };
      },
      set: (reference, payload) => {
        calls.sets.push({ reference, payload });
        documents.set(pathOf(reference), { ...payload });
      },
      update: (reference, payload) => {
        calls.updates.push({ reference, payload });
        const current = { ...documents.get(pathOf(reference)) };
        for (const [key, value] of Object.entries(payload)) {
          current[key] = value && typeof value.increment === 'number'
            ? (current[key] || 0) + value.increment
            : value;
        }
        documents.set(pathOf(reference), current);
      },
    };

    await callback(transaction);
    await afterTransaction?.({ calls, documents });
  };

  vm.runInNewContext(executableSource, {
    window,
    console,
    collection,
    doc,
    increment,
    runTransaction,
    setDoc,
    updateDoc,
    deleteDoc,
  });
  window.OfflineAdapter.init(database);
  return { adapter: window.OfflineAdapter, calls, documents };
}

function createDetailAction() {
  return {
    id: 'action-detail',
    action: 'createDetail',
    collection: 'page3',
    parentCollection: 'page2',
    localId: 'detail_local_xxx',
    itemId: 'item-firestore',
    idempotencyKey: 'createDetail:detail_local_xxx',
    articleCountDelta: 2,
    payload: { itemId: 'item-firestore', name: 'Article' },
  };
}

test('createDetail utilise le localId et écrit le détail, le compteur et la marque en transaction', async () => {
  const { adapter, calls, documents } = await loadOfflineAdapter();
  documents.set('pages/page2/items/item-firestore', { articleCount: 4 });

  const result = await adapter.processAction(createDetailAction());

  assert.deepEqual({ ...result }, {
    ok: true, actionId: 'action-detail', firestoreId: 'detail_local_xxx',
  });
  assert.equal(calls.transactions, 1);
  assert.deepEqual(documents.get('pages/page3/items/detail_local_xxx'), {
    itemId: 'item-firestore', name: 'Article',
  });
  assert.equal(documents.get('pages/page2/items/item-firestore').articleCount, 6);
  assert.deepEqual(documents.get('offlineCreateDetailOperations/createDetail:detail_local_xxx'), {
    operation: 'createDetail',
    localId: 'detail_local_xxx',
    itemId: 'item-firestore',
    articleCountDelta: 2,
  });
});

test('une création de site offline utilise toujours le localId comme identifiant Firestore', async () => {
  const { adapter, calls } = await loadOfflineAdapter();
  const result = await adapter.processAction({
    id: 'action-add', action: 'add', collection: 'page1',
    localId: 'site_local_xxx', payload: { name: 'Site' },
  });

  assert.deepEqual({ ...result }, {
    ok: true, actionId: 'action-add', firestoreId: 'site_local_xxx',
  });
  assert.equal(calls.sets[0].reference.path.join('/'), 'pages/page1/items/site_local_xxx');
  assert.deepEqual(calls.sets[0].payload, { name: 'Site' });
});

test('rejouer le même createDetail ne recrée pas le document et ne réincrémente pas articleCount', async () => {
  const { adapter, calls, documents } = await loadOfflineAdapter();
  documents.set('pages/page2/items/item-firestore', { articleCount: 4 });
  const action = createDetailAction();

  const firstResult = await adapter.processAction(action);
  const secondResult = await adapter.processAction(action);

  assert.equal(firstResult.ok, true);
  assert.deepEqual({ ...secondResult }, {
    ok: true, actionId: 'action-detail', firestoreId: 'detail_local_xxx',
  });
  assert.equal(calls.transactions, 2);
  assert.equal(calls.updates.length, 1);
  assert.equal(documents.get('pages/page2/items/item-firestore').articleCount, 6);
  assert.equal([...documents.keys()].filter((key) => key.startsWith('pages/page3/items/')).length, 1);
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

test('une coupure après la transaction retrouve la marque et évite un double incrément', async () => {
  let loseResponse = true;
  const { adapter: offlineAdapter, calls, documents } = await loadOfflineAdapter({
    afterTransaction: async () => {
      if (loseResponse) {
        loseResponse = false;
        throw new Error('Réponse Firestore perdue');
      }
    },
  });
  documents.set('pages/page2/items/item-firestore', { articleCount: 4 });
  let mappingAttempts = 0;
  const materialAdapter = await loadMaterialAdapter({
    processAction: offlineAdapter.processAction,
    getFirestoreId: async (id) => id,
    saveMapping: async () => {
      mappingAttempts += 1;
    },
  });
  const action = {
    id: 'action-detail', type: 'createDetail', localId: 'detail_local_xxx',
    articleCountDelta: 2,
    payload: { siteId: 'site-firestore', itemId: 'item-firestore', name: 'Article' },
  };

  const firstResult = await materialAdapter.syncAction(action);
  const secondResult = await materialAdapter.syncAction(action);

  assert.equal(firstResult.ok, false);
  assert.equal(secondResult.ok, true);
  assert.equal(calls.transactions, 2);
  assert.equal(calls.markerReads, 2);
  assert.equal(calls.updates.length, 1);
  assert.equal(documents.get('pages/page2/items/item-firestore').articleCount, 6);
  assert.equal(documents.has('offlineCreateDetailOperations/createDetail:detail_local_xxx'), true);
  assert.equal(mappingAttempts, 1);
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

test('modifie un détail avec son identifiant Firestore résolu', async () => {
  let processedAction;
  const adapter = await loadMaterialAdapter({
    processAction: async (action) => {
      processedAction = action;
      return { ok: true };
    },
    getFirestoreId: async (id) => id === 'detail_local_1' ? 'firestore-detail' : null,
    saveMapping: async () => {},
  });

  const result = await adapter.syncAction({
    id: 'action-update',
    type: 'updateDetail',
    localId: 'detail_local_1',
    payload: { detailId: 'detail_local_1', name: 'Article modifié' },
  });

  assert.deepEqual({ ...result }, {
    ok: true, localId: 'detail_local_1', firestoreId: 'firestore-detail',
  });
  assert.deepEqual({ ...processedAction, payload: { ...processedAction.payload } }, {
    id: 'action-update',
    action: 'update',
    collection: 'page3',
    documentId: 'firestore-detail',
    payload: { name: 'Article modifié' },
  });
});

test('supprime un détail avec son identifiant Firestore résolu', async () => {
  let processedAction;
  const adapter = await loadMaterialAdapter({
    processAction: async (action) => {
      processedAction = action;
      return { ok: true };
    },
    getFirestoreId: async (id) => id === 'detail_local_1' ? 'firestore-detail' : null,
    saveMapping: async () => {},
  });

  const result = await adapter.syncAction({
    id: 'action-delete', type: 'deleteDetail', localId: 'detail_local_1',
  });

  assert.deepEqual({ ...result }, {
    ok: true, localId: 'detail_local_1', firestoreId: 'firestore-detail',
  });
  assert.deepEqual({ ...processedAction }, {
    id: 'action-delete',
    action: 'delete',
    collection: 'page3',
    documentId: 'firestore-detail',
  });
});
