import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('le formulaire propose la visibilité « Tout le monde » par défaut après l’accès', async () => {
  const html = await readSource('../index.html');
  const accessPosition = html.indexOf('id="siteSecuritySelect"');
  const privacyPosition = html.indexOf('id="sitePrivacySelect"');

  assert.ok(privacyPosition > accessPosition);
  assert.match(html, /<span>Qui peut voir le site \?<\/span>[\s\S]*?id="sitePrivacySelect"[\s\S]*?<option value="public" selected>Tout le monde<\/option>[\s\S]*?<option value="private">Moi uniquement<\/option>/);
});

test('la création valide et transmet la confidentialité sélectionnée', async () => {
  const app = await readSource('../js/app.js');
  const submit = app.slice(app.indexOf("siteForm.addEventListener('submit'"), app.indexOf("siteEditNameForm?.addEventListener('submit'"));

  assert.match(submit, /privacy !== 'public' && privacy !== 'private'/);
  assert.match(submit, /StorageService\.createSite\(name, \{[\s\S]*?privacy,/);
});

test('Firestore enregistre public ou private et refuse toute autre valeur', async () => {
  const storage = await readSource('../js/storage.js');
  const createSite = storage.slice(storage.indexOf('async function createSite('), storage.indexOf('async function updateSiteName('));

  assert.match(createSite, /const privacy = security\?\.privacy \|\| 'public'/);
  assert.match(createSite, /privacy !== 'public' && privacy !== 'private'/);
  assert.match(createSite, /createdBy: state\.userId,[\s\S]*?privacy,/);
});

test('les sites privés sont réservés au créateur et aux administrateurs', async () => {
  const storage = await readSource('../js/storage.js');
  const visibility = storage.slice(storage.indexOf('function isSiteVisibleToCurrentUser('), storage.indexOf('function filterSitesVisibleToCurrentUser('));

  assert.match(visibility, /site\?\.privacy === 'private' \? 'private' : 'public'/);
  assert.match(visibility, /privacy === 'public' \|\| state\.canViewAllSites \|\| isCurrentUserSiteCreator\(site\)/);
  assert.match(visibility, /state\.canViewAllSites \|\| canViewForInactivity/);
});

test('seules les cartes des sites privés affichent le badge « Privé »', async () => {
  const app = await readSource('../js/app.js');
  const renderSites = app.slice(app.indexOf('function renderSites()'), app.indexOf("siteList.querySelectorAll('[data-site-creator]')"));
  const styles = await readSource('../css/style.css');

  assert.match(renderSites, /site\?\.privacy === 'private'/);
  assert.match(renderSites, /<div class="site-header">[\s\S]*?<h3 class="list-card__title">/);
  assert.match(renderSites, /class="list-card__privacy-badge" aria-label="Site privé"/);
  assert.match(renderSites, /<span aria-hidden="true">🔒<\/span> Privé/);
  assert.match(renderSites, /: `<h3 class="list-card__title">\$\{escapeHtml\(site\.nom\)\}<\/h3>`/);
  assert.match(styles, /body\[data-page="home"\] \.list-card__privacy-badge \{/);
  assert.match(styles, /body\[data-page="home"\] \.site-header \{[\s\S]*?width: 100%;[\s\S]*?display: flex;[\s\S]*?justify-content: space-between;[\s\S]*?align-items: center;/);
});

test('le menu réutilise l’icône de confidentialité et ouvre le dialogue de modification', async () => {
  const app = await readSource('../js/app.js');

  assert.match(app, /src="Icon\/Confidentialité\.png"[^>]*>[\s\S]*?Modifier la confidentialité/);
  assert.match(app, /<h2>Confidentialité du site<\/h2>/);
  assert.match(app, /<legend>Qui peut voir ce site \?<\/legend>/);
  assert.match(app, /value="public"[^>]*>[\s\S]*?Tout le monde/);
  assert.match(app, /value="private"[^>]*>[\s\S]*?Moi uniquement/);
  assert.match(app, />Annuler<\/button>[\s\S]*?>Enregistrer<\/button>/);
});

test('la modification écrit uniquement le champ privacy existant', async () => {
  const storage = await readSource('../js/storage.js');
  const updatePrivacy = storage.slice(storage.indexOf('async function updateSitePrivacy('), storage.indexOf('async function updateSiteCreator('));

  assert.match(updatePrivacy, /privacy !== 'public' && privacy !== 'private'/);
  assert.match(updatePrivacy, /setDoc\([^]*?\{ privacy \}, \{ merge: true \}\)/);
  assert.doesNotMatch(updatePrivacy, /dateModification|passwordHash|isLocked|articles/);
});
