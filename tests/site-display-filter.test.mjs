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
  assert.match(html, /data-site-filter="all"[^>]*aria-pressed="true"><span>Tous<\/span>/);
  assert.match(html, /data-site-filter="mine"[^>]*aria-pressed="false"><span>Mes sites<\/span>/);
  assert.match(html, /data-site-filter="open"[^>]*aria-pressed="false"><span>Ouvert<\/span>/);
  assert.match(html, /data-site-filter="locked"[^>]*aria-pressed="false"><span>Verrouillé<\/span>/);
  assert.equal((html.match(/data-site-filter-count hidden/g) || []).length, 4);
});

test('les compteurs des chips reflètent les sites visibles et masquent seulement les valeurs nulles', async () => {
  const app = await readSource('../js/app.js');
  const homePage = app.slice(app.indexOf('function initHomePage('), app.indexOf('function initSiteDetailPage('));
  const updateCounts = homePage.slice(homePage.indexOf('function updateSiteFilterCounts('), homePage.indexOf('updateSiteFilterChips();'));

  assert.match(updateCounts, /totals\.all \+= 1/);
  assert.match(updateCounts, /creatorId === currentUserId/);
  assert.match(updateCounts, /isSiteLocked\(site\) \? 'locked' : 'open'/);
  assert.match(updateCounts, /countElement\.textContent = count > 0 \? String\(count\) : ''/);
  assert.match(updateCounts, /countElement\.hidden = count === 0/);
  assert.match(homePage, /function renderSites\(\)[\s\S]*?updateSiteFilterCounts\(currentUserId\)[\s\S]*?const sites = currentSites/);
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

test('le filtre actif est restauré depuis localStorage et sauvegardé à chaque clic', async () => {
  const app = await readSource('../js/app.js');
  const homePage = app.slice(app.indexOf('function initHomePage('), app.indexOf('function initSiteDetailPage('));

  assert.match(homePage, /const siteFilterStorageKey = 'siteFilter'/);
  assert.match(homePage, /tous: 'all'/);
  assert.match(homePage, /'mes-sites': 'mine'/);
  assert.match(homePage, /ouvert: 'open'/);
  assert.match(homePage, /verrouille: 'locked'/);
  assert.match(homePage, /localStorage\.getItem\(siteFilterStorageKey\) \|\| 'tous'/);
  assert.match(homePage, /let activeSiteFilter = siteFilterByStoredValue\[savedFilter\] \|\| 'all'/);
  assert.match(homePage, /localStorage\.setItem\(siteFilterStorageKey, storedValueBySiteFilter\[activeSiteFilter\]\)/);
  assert.match(homePage, /updateSiteFilterChips\(\);[\s\S]*?renderSites\(\);/);
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
