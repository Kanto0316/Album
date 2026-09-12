import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
const materialsSource = await readFile(new URL('../js/materiels.js', import.meta.url), 'utf8');

test('markAppReady attend la validation et le rendu du DOM', () => {
  const markAppReady = uiSource.slice(
    uiSource.indexOf('function markAppReady()'),
    uiSource.indexOf('function formatDate('),
  );

  assert.doesNotMatch(markAppReady, /stopContentLoadingState\(\)/);
  assert.match(markAppReady, /MutationObserver\(maybeHideGlobalLoader\)/);
  assert.match(uiSource, /await waitForDomPaint\(\)/);
  assert.match(uiSource, /if \(!isPageDomReady\(\)\)/);
});

test('la fin du shimmer contrôle contenu principal, compteurs et composants', () => {
  assert.match(uiSource, /PRIMARY_CONTENT_BY_PAGE/);
  assert.match(uiSource, /COUNTER_BY_PAGE/);
  assert.match(uiSource, /primaryContent\.children\.length/);
  assert.match(uiSource, /button, input, select, textarea/);
  assert.match(uiSource, /detail-skeleton-row/);
});

test('seul UiService supprime les variantes du skeleton global', () => {
  assert.match(uiSource, /\.global-skeleton, \.skeleton-container, #skeleton/);
  assert.doesNotMatch(materialsSource, /querySelector\(['"]\.global-skeleton/);
  assert.doesNotMatch(materialsSource, /classList\.remove\(['"]loading/);
});
