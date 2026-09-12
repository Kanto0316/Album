import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextLineNumber } from '../js/next-line-number.js';

test('displays line 12 when the table contains 11 articles', () => {
  assert.equal(getNextLineNumber(Array.from({ length: 11 })), 12);
});

test('displays line 1 when the table is empty', () => {
  assert.equal(getNextLineNumber([]), 1);
});

test('increments the next line after an article is added', () => {
  const articles = Array.from({ length: 11 });
  articles.push({ id: 'new-article' });

  assert.equal(getNextLineNumber(articles), 13);
});

test('recomputes the next line whenever the modal is reopened', () => {
  const articles = Array.from({ length: 4 });
  const numberOnFirstOpen = getNextLineNumber(articles);
  articles.push({ id: 'fifth-article' });
  const numberOnReopen = getNextLineNumber(articles);

  assert.equal(numberOnFirstOpen, 5);
  assert.equal(numberOnReopen, 6);
});
