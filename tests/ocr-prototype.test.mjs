import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareImage, validateImageFile } from '../js/image-import.service.js';
import { recognizeImage } from '../js/ocr.service.js';

test('validateImageFile accepte une image valide', () => {
  const file = { name: 'liste.png', type: 'image/png', size: 1024 };
  assert.equal(validateImageFile(file), file);
});

test('validateImageFile refuse un format invalide avec un message clair', () => {
  assert.throws(
    () => validateImageFile({ name: 'liste.pdf', type: 'application/pdf', size: 1024 }),
    /Format non pris en charge.*JPG, PNG ou WebP/,
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
});
