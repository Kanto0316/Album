import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getCatalogueNotification,
  mergeMaterialCatalogs,
  normalizeCatalogMaterial,
  normalizeMaterialCode,
} from '../js/material-catalog.js';

test('normalise les espaces et la casse du code matériel', () => {
  assert.equal(normalizeMaterialCode(' abc 123 '), 'ABC123');
  assert.deepEqual(normalizeCatalogMaterial({ code: ' new001 ', designation: ' Nouvelle pompe ' }), {
    code: 'NEW001',
    designation: 'Nouvelle pompe',
  });
});

test('fusionne les catalogues par code avec priorité au JSON statique', () => {
  const merged = mergeMaterialCatalogs(
    [{ code: ' abc123 ', designation: 'Version officielle' }],
    [
      { code: 'ABC123', designation: 'Version manuelle' },
      { code: 'new001', designation: 'Nouvelle pompe' },
    ],
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.find(({ code }) => code === 'ABC123'), {
    code: 'ABC123',
    designation: 'Version officielle',
  });
  assert.equal(merged.some(({ code }) => code === 'NEW001'), true);
});

test('accepte un catalogue statique absent', () => {
  assert.deepEqual(mergeMaterialCatalogs([], [{ code: 'FS001', designation: 'Firestore' }]), [
    { code: 'FS001', designation: 'Firestore' },
  ]);
});

test('réserve les détails de catalogue au rôle admin', () => {
  assert.equal(getCatalogueNotification('limite', 'Matériel ajouté.', 'Détail technique'), 'Matériel ajouté.');
  assert.equal(getCatalogueNotification('standard', 'Demande enregistrée.', 'Doublon ABC'), 'Demande enregistrée.');
  assert.equal(getCatalogueNotification('admin', 'Demande enregistrée.', 'Doublon ABC'), 'Doublon ABC');
});

test('la page utilise le catalogue dédié et une lecture ciblée pour les ajouts', async () => {
  const source = await readFile(new URL('../js/materiels.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'pages',\s*'page3',\s*'items'/);
  assert.match(source, /collection\(firebaseDb, 'catalogueMateriels'\)/);
  assert.match(source, /getDoc\(catalogueRef\)/);
  assert.match(source, /setDoc\(catalogueRef/);
});

test('le catalogue JSON officiel est valide et tous ses codes sont normalisables', async () => {
  const payload = JSON.parse(await readFile(new URL('../data/materiel/materiels.json', import.meta.url), 'utf8'));
  const codes = payload.map(({ code }) => normalizeMaterialCode(code));
  assert.equal(codes.every(Boolean), true);
  assert.equal(mergeMaterialCatalogs(payload, []).length, new Set(codes).size);
});
