import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
const page2 = await readFile(new URL('../page2.html', import.meta.url), 'utf8');
const page3 = await readFile(new URL('../page3.html', import.meta.url), 'utf8');

test('le sélecteur OUT accepte uniquement les images prévues et démarre masqué', () => {
  assert.match(page2, /id="outImagePicker"[^>]*hidden/);
  assert.match(page2, /accept="image\/jpeg,image\/png,image\/webp,/);
  assert.match(app, /OUT_IMAGE_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(app, /OUT_IMAGE_TYPES = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
});

test('les actions image refont une lecture serveur du rôle ADMIN', () => {
  assert.match(app, /async function verifyCurrentUserIsOutImageAdmin/);
  assert.match(app, /getDocFromServer\(doc\(firebaseDb, 'users', user\.uid\)\)/);
  assert.match(app, /selectedOutImageFile && \(!permissions\.isOutImageAdmin \|\| !\(await verifyCurrentUserIsOutImageAdmin\(\)\)\)/);
  assert.match(app, /!permissions\?\.isOutImageAdmin \|\| !\(await verifyCurrentUserIsOutImageAdmin\(\)\)/);
});

test('les métadonnées image sont écrites sur le document OUT', () => {
  for (const field of ['imageUrl', 'imagePublicId', 'imageCreatedBy', 'imageCreatedAt']) {
    assert.match(storage, new RegExp(`itemPayload\\.${field}`));
  }
  assert.match(app, /uploadPurchaseImageToCloudinary\(selectedOutImageFile, `OUT-\$\{value\}`\)/);
});

test('page 3 réserve affichage et suppression à un ADMIN vérifié', () => {
  assert.match(page3, /id="outDetailImageSection"[^>]*hidden/);
  assert.match(page3, /id="outDetailImageDeleteButton"/);
  assert.match(app, /isVerifiedOutImageAdmin && Boolean\(imageUrl\)/);
  assert.match(app, /f_auto,q_auto,w_1600,c_limit/);
  assert.match(app, /imageUrl: null,[\s\S]*imagePublicId: null,[\s\S]*imageCreatedBy: null,[\s\S]*imageCreatedAt: null/);
});
