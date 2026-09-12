import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');

test('la confirmation Page 3 disparaît avant Firestore et réactive toujours la ligne', () => {
  const handler = app.slice(
    app.indexOf('confirmButton.onclick = async () => {', app.indexOf('function askDetailDeleteConfirmation')),
    app.indexOf('overlay.onclick = (event) => {', app.indexOf('function askDetailDeleteConfirmation')),
  );

  assert.match(handler, /try \{/);
  assert.match(handler, /catch \(error\) \{/);
  assert.match(handler, /finally \{[\s\S]*isDeleting = false;[\s\S]*setLoadingState\(false\);/);
  assert.match(handler, /overlay\.hidden = true;[\s\S]*deletingDetailIds\.add\(detailId\);[\s\S]*await StorageService\.removeDetail/);
  assert.match(handler, /if \(!removed\)[\s\S]*L’article a été conservé/);
  assert.match(handler, /finally \{[\s\S]*deletingDetailIds\.delete\(detailId\);[\s\S]*renderTable\(\)/);
});

test('la suppression publie la nouvelle liste avant les traitements secondaires', () => {
  const removeDetail = storage.slice(
    storage.indexOf('async function removeDetail(siteId, itemId, detailId)'),
    storage.indexOf('function resolveSiteNameForHistory'),
  );

  const deletion = removeDetail.indexOf("await deleteDoc(doc(state.db, 'pages', 'page3', 'items', detailId))");
  const splice = removeDetail.indexOf('details.splice(detailIndex, 1)');
  const emit = removeDetail.indexOf('emitAll()');
  const secondaryWork = removeDetail.indexOf('await Promise.allSettled');

  assert.ok(deletion >= 0 && deletion < splice);
  assert.ok(splice < emit && emit < secondaryWork);
  assert.match(removeDetail, /incrementItemArticleCount\(siteId, itemId, -1\)/);
  assert.match(removeDetail, /appendMaterialHistoryEntry\('material_delete'/);
  assert.match(removeDetail, /return true;/);
});
