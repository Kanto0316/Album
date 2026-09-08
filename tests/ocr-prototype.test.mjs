import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareImage, selectImage, validateImageFile } from '../js/image-import.service.js';
import {
  ARTICLE_EXTRACTION_FIELDS,
  recognizeArticles,
  recognizeArticlesWithAuth,
} from '../js/ocr.service.js';
import { OCR_API_URL } from '../js/config.js';

test('la configuration de production cible le backend OCR Render', () => {
  assert.equal(OCR_API_URL, 'https://back-end-serveur-1.onrender.com');
});

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
    assert.equal(input.accept, 'image/jpeg,image/png,image/webp');
    assert.equal(attributes.has('capture'), false);
    assert.equal(selected.previewUrl, 'blob:gallery-preview');
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('recognizeArticles appelle Render avec le token et le multipart attendus', async () => {
  const appended = [];
  let request;
  class FormDataStub { append(...args) { appended.push(args); } }
  const image = { name: 'articles.png' };
  const result = await recognizeArticles(image, {
    apiUrl: 'https://ocr.example.test/',
    token: 'firebase-token',
    FormDataImpl: FormDataStub,
    fetchImpl: async (...args) => {
      request = args;
      return { ok: true, json: async () => ({ articles: [{ code: ' A12 ', designation: ' Boulon ' }] }) };
    },
  });
  assert.equal(request[0], 'https://ocr.example.test/v1/ocr/articles');
  assert.equal(request[1].method, 'POST');
  assert.equal(request[1].headers.Authorization, 'Bearer firebase-token');
  assert.equal(request[1].body instanceof FormDataStub, true);
  assert.deepEqual(appended, [['image', image]]);
  assert.deepEqual(result.articles, [{ code: 'A12', designation: 'Boulon' }]);
});

test('recognizeArticles accepte les enveloppes backend et ignore les lignes incomplètes', async () => {
  const result = await recognizeArticles({}, {
    apiUrl: 'https://ocr.example.test', token: 'token', FormDataImpl: class { append() {} },
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { articles: [
      { code: 'ABC123', description: 'Article valide' }, { code: '', designation: 'Incomplet' },
    ] } }) }),
  });
  assert.deepEqual(result.articles, [{ code: 'ABC123', designation: 'Article valide' }]);
  assert.deepEqual(ARTICLE_EXTRACTION_FIELDS.active, ['code', 'designation']);
  assert.deepEqual(ARTICLE_EXTRACTION_FIELDS.planned, ['quantity', 'unit', 'status']);
});

test('recognizeArticles fournit des erreurs explicites', async () => {
  const options = { apiUrl: 'https://ocr.test', token: 'token', FormDataImpl: class { append() {} } };
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => { throw new Error('offline'); } }), /Serveur OCR inaccessible.*CORS/);
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ code: 'TOKEN_INVALID' }) }) }), /Votre session n’est plus valide/);
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ code: 'OCR_FORBIDDEN' }) }) }), /Vous n’êtes pas autorisé/);
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => ({ ok: false, status: 413, json: async () => ({}) }) }), /trop volumineuse/);
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => ({ ok: false, status: 415, json: async () => ({}) }) }), /non supporté/);
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({}) }) }), /inexploitable/);
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }), /Trop de requêtes/);
  await assert.rejects(() => recognizeArticles({}, { ...options, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }), /service OCR est temporairement indisponible/);
  await assert.rejects(() => recognizeArticles({}, { ...options, apiUrl: '' }), /OCR_API_URL/);
});

test('recognizeArticlesWithAuth récupère le token courant et envoie la requête admin', async () => {
  const tokenCalls = [];
  let authorization;
  const user = { uid: 'admin-1', async getIdToken(forceRefresh) { tokenCalls.push(forceRefresh); return 'current-token'; } };
  await recognizeArticlesWithAuth({}, {
    user,
    apiUrl: 'https://ocr.test',
    FormDataImpl: class { append() {} },
    fetchImpl: async (_url, request) => {
      authorization = request.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ articles: [] }) };
    },
  });
  assert.deepEqual(tokenCalls, [undefined]);
  assert.equal(authorization, 'Bearer current-token');
});

test('recognizeArticlesWithAuth ne fait aucune requête sans utilisateur connecté', async () => {
  let requestCount = 0;
  await assert.rejects(() => recognizeArticlesWithAuth({}, {
    user: null,
    apiUrl: 'https://ocr.test',
    fetchImpl: async () => { requestCount += 1; },
  }), /Votre session n’est plus valide/);
  assert.equal(requestCount, 0);
});

test('recognizeArticlesWithAuth renouvelle un TOKEN_EXPIRED et rejoue une seule fois', async () => {
  const tokenCalls = [];
  const authorizations = [];
  const user = {
    uid: 'admin-1',
    async getIdToken(forceRefresh) {
      tokenCalls.push(forceRefresh);
      return forceRefresh ? 'fresh-token' : 'expired-token';
    },
  };
  let requestCount = 0;
  const result = await recognizeArticlesWithAuth({}, {
    user,
    apiUrl: 'https://ocr.test',
    FormDataImpl: class { append() {} },
    fetchImpl: async (_url, request) => {
      requestCount += 1;
      authorizations.push(request.headers.Authorization);
      if (requestCount === 1) {
        return { ok: false, status: 401, json: async () => ({ code: 'TOKEN_EXPIRED' }) };
      }
      return { ok: true, status: 200, json: async () => ({ articles: [] }) };
    },
  });
  assert.deepEqual(result.articles, []);
  assert.deepEqual(tokenCalls, [undefined, true]);
  assert.deepEqual(authorizations, ['Bearer expired-token', 'Bearer fresh-token']);
  assert.equal(requestCount, 2);
});

test('recognizeArticlesWithAuth ne boucle pas si le token renouvelé est refusé', async () => {
  let tokenCalls = 0;
  let requestCount = 0;
  await assert.rejects(() => recognizeArticlesWithAuth({}, {
    user: { uid: 'admin-1', async getIdToken() { tokenCalls += 1; return `token-${tokenCalls}`; } },
    apiUrl: 'https://ocr.test',
    FormDataImpl: class { append() {} },
    fetchImpl: async () => {
      requestCount += 1;
      return { ok: false, status: 401, json: async () => ({ code: 'TOKEN_EXPIRED' }) };
    },
  }), /jeton Firebase a expiré/);
  assert.equal(tokenCalls, 2);
  assert.equal(requestCount, 2);
});

test('le prototype OCR est présent uniquement sur la page 3 détail OUT', async () => {
  const [homePage, itemDetailPage, appSource] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../page3.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(homePage, /id="openOcrTest"|id="ocrTestDialog"|tesseract\.min\.js/);
  assert.match(itemDetailPage, /data-page="item-detail"/);
  assert.match(itemDetailPage, /data-fab-row="create"[\s\S]*id="openOcrTest"[\s\S]*id="openDetailFormButton"/);
  assert.match(itemDetailPage, /id="openOcrTest"[^>]*hidden/);
  assert.doesNotMatch(itemDetailPage, /tesseract\.min\.js/);
  assert.match(itemDetailPage, /id="ocrTestRows"/);
  assert.match(itemDetailPage, /id="ocrTestAdd"[^>]*>Ajouter les articles/);
  assert.match(itemDetailPage, /📷 Importer depuis image/);
  assert.match(itemDetailPage, /<th scope="col">Action<\/th>/);
  assert.doesNotMatch(itemDetailPage, /Texte brut détecté/);
  assert.match(appSource, /const user = firebaseAuth\.currentUser;[\s\S]*if \(!user\?\.uid\)/);
  assert.match(appSource, /OcrService\.recognizeArticlesWithAuth\(image\.file, \{[\s\S]*apiUrl: OCR_API_URL,[\s\S]*user/);
  assert.match(appSource, /initOcrPrototype\(permissions, async \(articles\)[\s\S]*StorageService\.createDetail\(siteId, itemId/);
  assert.match(appSource, /initOcrPrototype\(permissions, async \(articles\)[\s\S]*unite: getAutomaticUnit\(article\.designation\)/);
});
