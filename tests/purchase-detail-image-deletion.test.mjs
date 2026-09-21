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
  assert.match(page, /id="purchaseDetailImageDeleteButton"[^>]*hidden/);
  assert.match(page, /Icon\/Corbeille\.png/);
  assert.ok(page.indexOf('purchaseDetailImageDeleteButton') < page.indexOf('purchaseDetailImageEditButton'));
});

test('la suppression demande confirmation et exige un identifiant Cloudinary', () => {
  assert.match(deletion, /window\.confirm\('Voulez-vous supprimer cette image \?'\)/);
  assert.match(deletion, /const imagePublicId = String\(currentPurchase\.imagePublicId \|\| ''\)\.trim\(\)/);
  assert.match(deletion, /if \(!imagePublicId\)/);
});

test('Cloudinary est supprimé via Render avant de nettoyer Firestore', () => {
  const backendCall = deletion.indexOf('fetch(CLOUDINARY_DELETE_ENDPOINT');
  const firestoreUpdate = deletion.indexOf("updateDoc(doc(firebaseDb, 'sites', siteId, 'achatsMateriels', firestorePurchaseId), updates)");

  assert.ok(backendCall >= 0);
  assert.ok(firestoreUpdate > backendCall);
  assert.match(app, /const CLOUDINARY_DELETE_ENDPOINT = 'https:\/\/back-end-serveur-1\.onrender\.com\/api\/cloudinary\/delete'/);
  assert.match(deletion, /method: 'POST'/);
  assert.match(deletion, /'Content-Type': 'application\/json'/);
  assert.match(deletion, /JSON\.stringify\(\{ publicId: imagePublicId \}\)/);
  assert.match(deletion, /!response\.ok \|\| result\?\.success !== true/);
  assert.match(deletion, /imageUrl: null,[\s\S]*imagePublicId: null/);
});

test('le bouton disparaît avec l’image après le nouveau rendu', () => {
  assert.match(app, /imageDeleteButton\.hidden = !canEditPurchase \|\| !imageUrl/);
  assert.match(deletion, /currentPurchase = \{ \.\.\.currentPurchase, \.\.\.updates \};[\s\S]*renderPurchaseDetail\(currentPurchase\)/);
});

test('un échec Cloudinary conserve les références Firestore et affiche une erreur', () => {
  const successGuard = deletion.indexOf("if (!response.ok || result?.success !== true)");
  const firestoreUpdate = deletion.indexOf("updateDoc(doc(firebaseDb, 'sites', siteId, 'achatsMateriels', firestorePurchaseId), updates)");

  assert.ok(successGuard >= 0);
  assert.ok(firestoreUpdate > successGuard);
  assert.match(deletion, /currentPurchase = previousPurchase;[\s\S]*renderPurchaseDetail\(previousPurchase\)/);
  assert.match(deletion, /Impossible de supprimer l’image\. Veuillez réessayer\./);
});
