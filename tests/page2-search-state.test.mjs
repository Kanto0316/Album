import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

test('la page 2 mémorise et restaure le déploiement et le texte de recherche', () => {
  assert.match(appSource, /const page2SearchOpenStorageKey = 'page2SearchOpen'/);
  assert.match(appSource, /localStorage\.setItem\(page2SearchOpenStorageKey, String\(isSearchOpen\)\)/);
  assert.match(appSource, /setSearchOpen\(window\.localStorage\.getItem\(page2SearchOpenStorageKey\) === 'true', false\)/);
  assert.match(appSource, /itemSearchInput\.value = window\.localStorage\.getItem\(page2SearchTextStorageKey\) \|\| ''/);
  assert.match(appSource, /localStorage\.setItem\(page2SearchTextStorageKey, searchValue\)/);
});

test('la page 2 mémorise les quatre chips avec les valeurs attendues', () => {
  assert.match(appSource, /all: 'tous'/);
  assert.match(appSource, /today: "aujourd'hui"/);
  assert.match(appSource, /yesterday: 'hier'/);
  assert.match(appSource, /lastMonth: 'plus-ancien'/);
  assert.match(appSource, /localStorage\.setItem\(page2DateFilterStorageKey, dateFilterStorageValueByKey\[selectedDateFilter\]\)/);
});
