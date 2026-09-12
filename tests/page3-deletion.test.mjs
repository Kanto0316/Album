import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');

test('la confirmation de suppression remet toujours le bouton dans son état normal', () => {
  const handler = app.slice(
    app.indexOf('confirmButton.onclick = async () => {', app.indexOf('function askDetailDeleteConfirmation')),
    app.indexOf('overlay.onclick = (event) => {', app.indexOf('function askDetailDeleteConfirmation')),
  );

  assert.match(handler, /try \{/);
  assert.match(handler, /catch \(error\) \{/);
  assert.match(handler, /finally \{[\s\S]*isDeleting = false;[\s\S]*setLoadingState\(false\);/);
  assert.match(handler, /if \(!removed\)[\s\S]*Suppression impossible/);
  assert.match(handler, /Article supprimé\.[\s\S]*close\(\)/);
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
