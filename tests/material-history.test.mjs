import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMaterialHistoryAction } from '../js/material-history.js';

const material = {
  designation: 'Câble U1000', materialCode: 'CAB-42', outNumber: 'OUT-12345',
  siteName: 'Lyon', unit: 'm',
};

test('formats a material addition with its identifying and quantity data', () => {
  assert.equal(formatMaterialHistoryAction({ ...material, actionType: 'material_add', quantity: 12 }),
    'a ajouté Câble U1000 (code matériel : CAB-42) dans OUT-12345 du site « Lyon » (Quantité : 12 m).');
});

test('formats output and return quantity changes with both values', () => {
  assert.equal(formatMaterialHistoryAction({ ...material, actionType: 'material_quantity_update', previousValue: 10, newValue: 8 }),
    'a modifié la quantité de Câble U1000 (code matériel : CAB-42) dans OUT-12345 du site « Lyon » : 10 m → 8 m.');
  assert.equal(formatMaterialHistoryAction({ ...material, actionType: 'material_return_update', previousValue: 1, newValue: 3 }),
    'a modifié le champ Qté retour de Câble U1000 (code matériel : CAB-42) dans OUT-12345 du site « Lyon » : 1 m → 3 m.');
});

test('formats deletion and other field changes without a generic article label', () => {
  assert.equal(formatMaterialHistoryAction({ ...material, actionType: 'material_delete' }),
    'a supprimé Câble U1000 (code matériel : CAB-42) de OUT-12345 du site « Lyon ».');
  assert.match(formatMaterialHistoryAction({ ...material, actionType: 'material_field_update', field: 'statut', previousValue: 'OK', newValue: 'K.O' }), /Statut.+OK → K\.O/);
});
