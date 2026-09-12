import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const catalogue = await readFile(new URL('../js/materiels.js', import.meta.url), 'utf8');

test('les lectures principales imposent Firestore serveur', () => {
  assert.match(storage, /getDocsFromServer\(pageRef\)/);
  assert.match(storage, /getDocsFromServer\(materialCodesCollection\(\)\)/);
  assert.match(storage, /getDocsFromServer\(usersCollection\(\)\)/);
  assert.match(storage, /getDocsFromServer\(query\(historyCollection\(\)/);
  assert.match(app, /getDocsFromServer\(purchasesQuery\)/);
  assert.match(app, /getDocFromServer\(doc\(firebaseDb, 'sites', siteId, 'achatsMateriels'/);
  assert.match(catalogue, /getDocsFromServer\(collection\(firebaseDb, 'pages', 'page3', 'items'\)\)/);
});

test('le cache reste un secours et le retour réseau relance les lectures', () => {
  assert.match(storage, /catch \(_error\) \{\s*applySnapshot\(offlineState\?\.snapshot/);
  assert.match(storage, /window\.addEventListener\('online', refreshSubscribedReadsFromServer\)/);
  assert.match(app, /window\.addEventListener\('online', loadPurchasesForCurrentSite\)/);
  assert.match(app, /window\.addEventListener\('online', loadPurchaseDetailFromServer\)/);
});
