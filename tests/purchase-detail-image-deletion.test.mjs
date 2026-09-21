import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../purchase-detail.html', import.meta.url), 'utf8');

const deletion = app.slice(
  app.indexOf('async function deletePurchaseImage()'),
  app.indexOf('async function saveInlinePurchaseField'),
);

test('la page détail propose une action de suppression près de l’édition', () => {
  assert.match(page, /purchaseDetailImageDeleteButton/);
  assert.match(page, /Icon\/Corbeille\.png/);
  assert.ok(page.indexOf('purchaseDetailImageDeleteButton') < page.indexOf('purchaseDetailImageEditButton'));
});

test('la suppression demande confirmation puis efface uniquement les références Firestore', () => {
  assert.match(deletion, /window\.confirm\('Voulez-vous supprimer cette image \?'\)/);
  assert.match(deletion, /imageUrl: null/);
  assert.match(deletion, /imageUpdates\.imagePublicId = null/);
  assert.match(deletion, /updateDoc\(doc\(firebaseDb, 'sites', siteId, 'achatsMateriels', firestorePurchaseId\), updates\)/);
  assert.doesNotMatch(deletion, /cloudinary\.com|fetch\s*\(/i);
});

test('le bouton disparaît avec l’image après le nouveau rendu', () => {
  assert.match(app, /imageDeleteButton\.hidden = !canEditPurchase \|\| !imageUrl/);
  assert.match(deletion, /currentPurchase = \{ \.\.\.currentPurchase, \.\.\.updates \};[\s\S]*renderPurchaseDetail\(currentPurchase\)/);
});
