import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReturnQuantity,
  isReturnQuantityWithinAvailable,
  parseReturnQuantity,
  sumReturnQuantities,
} from '../js/return-quantity.js';

test('parses positive decimal quantities entered with a comma or a point', () => {
  assert.equal(parseReturnQuantity('0,5'), 0.5);
  assert.equal(parseReturnQuantity('0.5'), 0.5);
  assert.equal(parseReturnQuantity('1'), 1);
  assert.equal(parseReturnQuantity('1,5'), 1.5);
  assert.equal(parseReturnQuantity('3.25'), 3.25);
});

test('rejects empty, non-numeric and negative quantity syntax', () => {
  assert.equal(parseReturnQuantity(''), null);
  assert.equal(parseReturnQuantity('texte'), null);
  assert.equal(parseReturnQuantity('0'), 0);
  assert.equal(parseReturnQuantity('-1'), null);
  assert.equal(parseReturnQuantity('-0,5'), null);
});

test('preserves the numeric quantity-out limit for decimal returns', () => {
  assert.equal(isReturnQuantityWithinAvailable(10, 10), true);
  assert.equal(isReturnQuantityWithinAvailable(0.5, 10), true);
  assert.equal(isReturnQuantityWithinAvailable(10.5, 10), false);
});

test('keeps decimal totals numerically accurate and formats them cleanly', () => {
  assert.equal(sumReturnQuantities([0.5, 2.5, 1]), 4);
  assert.equal(sumReturnQuantities(['0,5', '2,25']), 2.75);
  assert.equal(sumReturnQuantities([0.1, 0.2]), 0.3);
  assert.equal(formatReturnQuantity(2.7500000000000004), '2,75');
  assert.equal(formatReturnQuantity(2.5000000001), '2,5');
});
