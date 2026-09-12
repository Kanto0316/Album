import test from 'node:test';
import assert from 'node:assert/strict';

import { formatStructuredHistoryAction } from '../js/history-message.js';

const material = {
  outNumber: 'OUT-26072039',
  site: 'CT MOTORS SHOWROOM',
  materialDesignation: 'Câble cuivre 16mm²',
  unit: 'm',
};

test('création OUT : précise le numéro et le site', () => {
  assert.equal(formatStructuredHistoryAction({
    action: 'create_out', outNumber: material.outNumber, site: material.site,
  }), 'a créé OUT-26072039 du site « CT MOTORS SHOWROOM ».');
});

test('ajout : précise la désignation et la quantité', () => {
  assert.equal(formatStructuredHistoryAction({
    ...material, action: 'add_material', newQuantity: 50,
  }), 'a ajouté Câble cuivre 16mm² dans OUT-26072039 du site « CT MOTORS SHOWROOM » (Quantité : 50 m).');
});

test('modification : précise les anciennes et nouvelles quantités', () => {
  assert.equal(formatStructuredHistoryAction({
    ...material, action: 'update_material', oldQuantity: 30, newQuantity: 50,
  }), 'a modifié Câble cuivre 16mm² dans OUT-26072039 : 30 m → 50 m.');
});

test('retour : précise la quantité retournée', () => {
  assert.equal(formatStructuredHistoryAction({
    ...material, action: 'add_return', quantity: 10,
  }), 'a ajouté un retour de Câble cuivre 16mm² dans OUT-26072039 (Quantité retournée : 10 m).');
});

test('suppression : précise la désignation et la quantité supprimée', () => {
  assert.equal(formatStructuredHistoryAction({
    ...material, action: 'delete_material', quantity: 20,
  }), 'a supprimé Câble cuivre 16mm² de OUT-26072039 (Quantité supprimée : 20 m).');
});

test('ancien historique : conserve son message et accepte createdAt sans timestamp', () => {
  assert.equal(formatStructuredHistoryAction({
    action: 'a ajouté des articles dans OUT-1234', createdAt: '2026-01-01',
  }), 'a ajouté des articles dans OUT-1234');
});
