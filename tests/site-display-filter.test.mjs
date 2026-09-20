import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('la page des sites propose les filtres Tous, Mes sites, Ouvert et Verrouillé sous le compteur', async () => {
  const html = await readSource('../index.html');
  const counterPosition = html.indexOf('id="siteCount"');
  const filtersPosition = html.indexOf('class="filter-chip-group filter-chips-container site-filter-chips"');
  const listPosition = html.indexOf('id="siteList"');

  assert.ok(counterPosition < filtersPosition && filtersPosition < listPosition);
  assert.match(html, /data-site-filter="all"[^>]*aria-pressed="true">Tous<\/button>/);
  assert.match(html, /data-site-filter="mine"[^>]*aria-pressed="false">Mes sites<\/button>/);
  assert.match(html, /data-site-filter="open"[^>]*aria-pressed="false">Ouvert<\/button>/);
  assert.match(html, /data-site-filter="locked"[^>]*aria-pressed="false">Verrouillé<\/button>/);
});

test('Mes sites filtre la source déjà visible uniquement selon le créateur connecté', async () => {
  const app = await readSource('../js/app.js');
  const renderSites = app.slice(app.indexOf('function renderSites()'), app.indexOf("siteList.querySelectorAll('[data-site-creator]')"));
  const creatorFilter = renderSites.slice(renderSites.indexOf('const currentUserId'), renderSites.indexOf('.sort(compareSitesByName)'));

  assert.match(creatorFilter, /currentPermissions\?\.userId \|\| firebaseAuth\.currentUser\?\.uid/);
  assert.match(creatorFilter, /site\?\.createdBy \|\| site\?\.ownerId/);
  assert.match(creatorFilter, /activeSiteFilter === 'mine'/);
  assert.match(creatorFilter, /creatorId === currentUserId/);
  assert.doesNotMatch(creatorFilter, /privacy|isAdmin|canViewAllSites/);
});

test('Ouvert et Verrouillé filtrent la source déjà visible selon le statut d’accès', async () => {
  const app = await readSource('../js/app.js');
  const renderSites = app.slice(app.indexOf('function renderSites()'), app.indexOf("siteList.querySelectorAll('[data-site-creator]')"));
  const accessFilter = renderSites.slice(renderSites.indexOf('const sites = currentSites'), renderSites.indexOf('.sort(compareSitesByName)'));

  assert.match(accessFilter, /activeSiteFilter === 'open'[\s\S]*?return !isSiteLocked\(site\)/);
  assert.match(accessFilter, /activeSiteFilter === 'locked'[\s\S]*?return isSiteLocked\(site\)/);
  assert.doesNotMatch(accessFilter, /privacy|isAdmin|canViewAllSites/);
});

test('les chips de la page 1 reprennent les états visuels des chips de la page 2', async () => {
  const styles = await readSource('../css/style.css');
  const homeChipContainer = styles.slice(
    styles.indexOf('body[data-page="home"] .site-filter-chips {'),
    styles.indexOf('body[data-page="home"] .site-filter-chips::-webkit-scrollbar'),
  );

  assert.match(styles, /body\[data-page="home"\] \.site-filter-chips \.filter-chip \{[^]*?border-radius: 999px;/);
  assert.match(styles, /body\[data-page="home"\] \.site-filter-chips \.filter-chip\.is-active \{[^]*?background: var\(--chip-active-blue\);/);
  assert.match(homeChipContainer, /display: flex;/);
  assert.match(homeChipContainer, /visibility: visible;/);
  assert.match(homeChipContainer, /opacity: 1;/);
  assert.match(homeChipContainer, /min-height: 2\.15rem;/);
});
