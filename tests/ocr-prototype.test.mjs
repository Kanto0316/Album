import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareImage, selectImage, validateImageFile } from '../js/image-import.service.js';
import { ARTICLE_EXTRACTION_FIELDS, extractArticles, recognizeImage } from '../js/ocr.service.js';

test('validateImageFile accepte une image valide', () => {
  const file = { name: 'liste.png', type: 'image/png', size: 1024 };
  assert.equal(validateImageFile(file), file);
});

test('validateImageFile refuse un format invalide avec un message clair', () => {
  assert.throws(
    () => validateImageFile({ name: 'liste.pdf', type: 'application/pdf', size: 1024 }),
    /Format non pris en charge.*JPG, JPEG, PNG ou WEBP/,
  );
});

test('validateImageFile refuse une extension incompatible même avec un type image', () => {
  assert.throws(
    () => validateImageFile({ name: 'liste.gif', type: 'image/png', size: 1024 }),
    /Format non pris en charge/,
  );
});

test('validateImageFile signale une image absente ou trop volumineuse', () => {
  assert.throws(() => validateImageFile(), /Aucune image sélectionnée/);
  assert.throws(
    () => validateImageFile({ name: 'liste.webp', type: 'image/webp', size: (10 * 1024 * 1024) + 1 }),
    /taille maximale autorisée de 10 Mo/,
  );
});

test('prepareImage prépare une URL de prévisualisation', () => {
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:test-preview' };
  try {
    const prepared = prepareImage({ name: 'liste.jpg', type: 'image/jpeg', size: 2048 });
    assert.equal(prepared.previewUrl, 'blob:test-preview');
    assert.equal(prepared.name, 'liste.jpg');
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('selectImage ouvre la galerie avec uniquement les extensions acceptées', async () => {
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:gallery-preview' };
  const attributes = new Map();
  const input = {
    files: [{ name: 'inventaire.jpeg', type: 'image/jpeg', size: 2048 }],
    hidden: false,
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    setAttribute(name, value) { attributes.set(name, value); },
    remove() {},
    click() { this.onchange(); },
  };
  const documentRef = {
    createElement: () => input,
    body: { append() {} },
  };

  try {
    const selected = await selectImage({ documentRef });
    assert.equal(input.type, 'file');
    assert.equal(input.accept, '.jpg,.jpeg,.png,.webp');
    assert.equal(attributes.has('capture'), false);
    assert.equal(selected.previewUrl, 'blob:gallery-preview');
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('recognizeImage renvoie texte, confiance et durée sans stockage', async () => {
  const engine = {
    recognize: async () => ({ data: { text: 'BOULON A2 M12X35\n', confidence: 92.4 } }),
  };
  const result = await recognizeImage({ type: 'image/png' }, { engine });
  assert.equal(result.text, 'BOULON A2 M12X35');
  assert.equal(result.confidence, 92.4);
  assert.ok(result.durationMs >= 0);
});

test('recognizeImage transforme une erreur moteur en erreur OCR claire', async () => {
  const engine = { recognize: async () => { throw new Error('worker indisponible'); } };
  await assert.rejects(() => recognizeImage({}, { engine }), /Analyse OCR impossible : worker indisponible/);
});

test('extractArticles associe les références à leurs désignations et ignore les entêtes', () => {
  const text = `SOCIÉTÉ EXEMPLE\nChauffeur Jean Dupont\nCode article Désignation\n200LDV102350STD LEVIER DE VANNE STANDARD\nABC-45678\nJoint haute température\nPage 1`;
  assert.deepEqual(extractArticles(text), [
    { code: '200LDV102350STD', designation: 'LEVIER DE VANNE STANDARD' },
    { code: 'ABC-45678', designation: 'Joint haute température' },
  ]);
});

test('extractArticles ne retourne pas de ligne incomplète et réserve les champs futurs', () => {
  assert.deepEqual(extractArticles('INVENTAIRE\n200LDV102350STD\nDate 01/01/2026'), []);
  assert.deepEqual(ARTICLE_EXTRACTION_FIELDS.active, ['code', 'designation']);
  assert.deepEqual(ARTICLE_EXTRACTION_FIELDS.planned, ['quantity', 'unit', 'status']);
});

test('le prototype OCR est présent uniquement sur la page 3 détail OUT', async () => {
  const [homePage, itemDetailPage] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../page3.html', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(homePage, /id="openOcrTest"|id="ocrTestDialog"|tesseract\.min\.js/);
  assert.match(itemDetailPage, /data-page="item-detail"/);
  assert.match(itemDetailPage, /data-fab-row="create"[\s\S]*id="openOcrTest"[\s\S]*id="openDetailFormButton"/);
  assert.match(itemDetailPage, /id="openOcrTest"[^>]*hidden/);
  assert.match(itemDetailPage, /tesseract\.min\.js/);
  assert.match(itemDetailPage, /id="ocrTestRows"/);
  assert.match(itemDetailPage, /id="ocrTestAdd"[^>]*>Ajouter les articles/);
  assert.doesNotMatch(itemDetailPage, /Texte brut détecté/);
});
