import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteOutCascade,
  deleteReferencesInControlledBatches,
  deleteSiteCascade,
} from '../js/cascade-deletion.js';

test('un OUT supprime ses deux détails avant la transaction compteur/OUT', async () => {
  const events = [];
  await deleteOutCascade({
    detailRefs: ['detail-1', 'detail-2'],
    deleteDetails: async (refs) => events.push(`details:${refs.join(',')}`),
    deleteOutAndCounter: async () => events.push('out+counter'),
  });
  assert.deepEqual(events, ['details:detail-1,detail-2', 'out+counter']);
});

test('un site supprime achats, détails, OUT puis parent, strictement dans cet ordre', async () => {
  const events = [];
  await deleteSiteCascade({
    purchaseRefs: ['purchase-1', 'purchase-2'],
    detailRefs: ['detail-1', 'detail-2'],
    outRefs: ['out-1', 'out-2'],
    deleteReferences: async (refs) => events.push(refs[0]?.split('-')[0] || 'empty'),
    deleteSite: async () => events.push('site'),
  });
  assert.deepEqual(events, ['purchase', 'detail', 'out', 'site']);
});

test('une erreur détail conserve l’OUT et rend l’échec visible', async () => {
  let outDeleted = false;
  await assert.rejects(deleteOutCascade({
    detailRefs: ['detail-1'],
    deleteDetails: async () => { throw new Error('échec volontaire'); },
    deleteOutAndCounter: async () => { outDeleted = true; },
  }), /échec volontaire/);
  assert.equal(outDeleted, false);
});

test('les suppressions volumineuses sont confirmées lot par lot', async () => {
  const commits = [];
  const writeBatch = () => {
    const refs = [];
    return { delete: (ref) => refs.push(ref), commit: async () => commits.push([...refs]) };
  };
  await deleteReferencesInControlledBatches(['a', 'b', 'c', 'd', 'e'], { db: {}, writeBatch, batchSize: 2 });
  assert.deepEqual(commits, [['a', 'b'], ['c', 'd'], ['e']]);
});

test('un rechargement serveur ne retrouve aucun identifiant supprimé', async () => {
  const firestore = new Set(['site', 'out', 'detail', 'purchase']);
  await deleteSiteCascade({
    purchaseRefs: ['purchase'], detailRefs: ['detail'], outRefs: ['out'],
    deleteReferences: async (refs) => refs.forEach((ref) => firestore.delete(ref)),
    deleteSite: async () => firestore.delete('site'),
  });
  const fullServerReload = () => [...firestore];
  assert.deepEqual(fullServerReload(), []);
});
