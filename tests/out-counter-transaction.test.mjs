import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOutAndIncrementCounter,
  deleteOutAndDecrementCounter,
} from '../js/out-counter-transaction.js';

function firestore(initialDocuments, { failCommit = false } = {}) {
  const documents = new Map(Object.entries(initialDocuments).map(([key, value]) => [key, structuredClone(value)]));
  let queue = Promise.resolve();
  const ref = (path) => ({ path });
  const runTransaction = (_db, callback) => {
    const operation = queue.then(async () => {
      const writes = [];
      const transaction = {
        async get(documentRef) {
          const value = documents.get(documentRef.path);
          return { exists: () => value !== undefined, data: () => structuredClone(value) };
        },
        set(documentRef, value, options) {
          writes.push(() => documents.set(documentRef.path, options?.merge
            ? { ...documents.get(documentRef.path), ...structuredClone(value) }
            : structuredClone(value)));
        },
        delete(documentRef) {
          writes.push(() => documents.delete(documentRef.path));
        },
      };
      const result = await callback(transaction);
      if (failCommit) throw new Error('commit_failed');
      writes.forEach((write) => write());
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  };
  return { documents, ref, runTransaction };
}

const create = (store, itemId) => createOutAndIncrementCounter({
  runTransaction: store.runTransaction,
  db: {},
  itemRef: store.ref(`items/${itemId}`),
  siteRef: store.ref('sites/site-1'),
  itemPayload: { siteId: 'site-1', numero: `OUT-${itemId}` },
});

test('création OUT : crée le document et passe outCount de 10 à 11', async () => {
  const store = firestore({ 'sites/site-1': { outCount: 10 } });
  assert.equal(await create(store, '1'), 11);
  assert.equal(store.documents.get('sites/site-1').outCount, 11);
  assert.equal(store.documents.get('items/1').siteId, 'site-1');
});

test('suppression OUT : supprime le document et passe outCount de 11 à 10', async () => {
  const store = firestore({ 'sites/site-1': { outCount: 11 }, 'items/1': { siteId: 'site-1' } });
  const count = await deleteOutAndDecrementCounter({
    runTransaction: store.runTransaction, db: {}, itemRef: store.ref('items/1'),
    siteRef: store.ref('sites/site-1'), siteId: 'site-1',
  });
  assert.equal(count, 10);
  assert.equal(store.documents.get('sites/site-1').outCount, 10);
  assert.equal(store.documents.has('items/1'), false);
});

test('erreur de création : aucun OUT créé et compteur inchangé', async () => {
  const store = firestore({ 'sites/site-1': { outCount: 10 } }, { failCommit: true });
  await assert.rejects(create(store, '1'), /commit_failed/);
  assert.equal(store.documents.has('items/1'), false);
  assert.equal(store.documents.get('sites/site-1').outCount, 10);
});

test('erreur de suppression : OUT conservé et compteur inchangé', async () => {
  const store = firestore({ 'sites/site-1': { outCount: 11 }, 'items/1': { siteId: 'site-1' } }, { failCommit: true });
  await assert.rejects(deleteOutAndDecrementCounter({
    runTransaction: store.runTransaction, db: {}, itemRef: store.ref('items/1'),
    siteRef: store.ref('sites/site-1'), siteId: 'site-1',
  }), /commit_failed/);
  assert.equal(store.documents.has('items/1'), true);
  assert.equal(store.documents.get('sites/site-1').outCount, 11);
});

test('deux créations simultanées sur le même site conservent un compteur exact', async () => {
  const store = firestore({ 'sites/site-1': { outCount: 10 } });
  await Promise.all([create(store, '1'), create(store, '2')]);
  assert.equal(store.documents.get('sites/site-1').outCount, 12);
  assert.equal(store.documents.has('items/1'), true);
  assert.equal(store.documents.has('items/2'), true);
});

test('compteur absent ou nul : part de zéro et ne devient jamais négatif', async () => {
  const store = firestore({ 'sites/site-1': {}, 'items/1': { siteId: 'site-1' } });
  await deleteOutAndDecrementCounter({
    runTransaction: store.runTransaction, db: {}, itemRef: store.ref('items/1'),
    siteRef: store.ref('sites/site-1'), siteId: 'site-1',
  });
  assert.equal(store.documents.get('sites/site-1').outCount, 0);
});
