import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');

const removeItem = storage.slice(
  storage.indexOf('async function removeItem(siteId, itemId)'),
  storage.indexOf('async function restoreSite'),
);

test('retire et publie l’OUT local dès que Firestore confirme la suppression', () => {
  const deletion = removeItem.indexOf("await deleteDoc(doc(state.db, 'pages', 'page2', 'items', itemId))");
  const splice = removeItem.indexOf('items.splice(itemIndex, 1)');
  const count = removeItem.indexOf('applySiteOutCount(siteId, getActualOutCountForSite(siteId))');
  const emit = removeItem.indexOf('emitAll()');
  const secondaryWork = removeItem.indexOf('await Promise.allSettled(secondaryOperations)');

  assert.ok(deletion >= 0 && deletion < splice);
  assert.ok(splice < count && count < emit && emit < secondaryWork);
  assert.match(removeItem, /persistOfflineState\(\);[\s\S]*emitAll\(\);/);
});

test('une erreur de compteur ou historique reste secondaire après la suppression', () => {
  assert.match(removeItem, /Promise\.allSettled\(secondaryOperations\)/);
  assert.match(removeItem, /OUT supprimé, mais compteur non synchronisé/);
  assert.match(removeItem, /OUT supprimé, mais historique non synchronisé/);
  assert.match(removeItem, /return \{ item: clone\(item\), details \};/);
});

test('un échec Firestore précède toute mutation locale', () => {
  const deletion = removeItem.indexOf("await deleteDoc(doc(state.db, 'pages', 'page2', 'items', itemId))");
  const splice = removeItem.indexOf('items.splice(itemIndex, 1)');
  assert.ok(deletion >= 0 && deletion < splice);
});

test('la confirmation Page 2 conserve son chargement et gère toujours les erreurs', () => {
  const confirmation = app.slice(
    app.indexOf('function askItemDeleteConfirmation'),
    app.indexOf('function ensureOutDeleteLimitDialog'),
  );
  assert.match(confirmation, /setLoadingState\(true\);[\s\S]*await onConfirm\(\)/);
  assert.match(confirmation, /catch \(error\)[\s\S]*Suppression impossible\. Veuillez réessayer\./);
  assert.match(confirmation, /finally \{[\s\S]*isDeleting = false;[\s\S]*setLoadingState\(false\);/);
  assert.match(confirmation, /if \(confirmed !== false\) \{[\s\S]*close\(true\)/);
});
