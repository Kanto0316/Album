import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('la création publique ne propose pas les utilisateurs autorisés', async () => {
  const html = await readSource('../index.html');
  const accessPosition = html.indexOf('id="siteSecuritySelect"');
  const privacyPosition = html.indexOf('id="sitePrivacySelect"');
  const privacySelect = html.slice(privacyPosition, html.indexOf('</select>', privacyPosition));

  assert.ok(privacyPosition > accessPosition);
  assert.match(privacySelect, /<option value="public" selected>Tout le monde<\/option>[\s\S]*?<option value="private">Moi uniquement<\/option>/);
  assert.doesNotMatch(privacySelect, /value="authorized"/);
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

test('la création journalise le site et la confidentialité avec les libellés affichés', async () => {
  const storage = await readSource('../js/storage.js');
  const createSite = storage.slice(storage.indexOf('async function createSite('), storage.indexOf('async function updateSiteName('));

  assert.match(createSite, /a créé le site « \$\{site\.nom\} » avec confidentialité « \$\{getSitePrivacyLabel\(privacy, allowedUsers\)\} »\./);
  assert.match(createSite, /appendHistoryEntry\([^]*?\{ siteId: site\.id, siteName: site\.nom \}/);
});

test('les sites privés sont visibles par le créateur, les administrateurs et les utilisateurs autorisés', async () => {
  const storage = await readSource('../js/storage.js');
  const visibility = storage.slice(storage.indexOf('function isSiteVisibleToCurrentUser('), storage.indexOf('function filterSitesVisibleToCurrentUser('));

  assert.match(visibility, /site\?\.privacy === 'private' \? 'private' : 'public'/);
  assert.match(visibility, /privacy === 'public'[\s\S]*?state\.canViewAllSites[\s\S]*?isCurrentUserSiteCreator\(site\)[\s\S]*?allowedUsers\.includes/);
  assert.match(visibility, /state\.canViewAllSites \|\| canViewForInactivity/);
});

test('seules les cartes des sites privés affichent le badge « Privé »', async () => {
  const app = await readSource('../js/app.js');
  const renderSites = app.slice(app.indexOf('function renderSites()'), app.indexOf("siteList.querySelectorAll('[data-site-creator]')"));
  const styles = await readSource('../css/style.css');

  assert.match(renderSites, /site\?\.privacy === 'private'/);
  assert.match(renderSites, /<div class="site-header">[\s\S]*?<h3 class="list-card__title">/);
  assert.match(renderSites, /class="list-card__privacy-badge" data-private-site=/);
  assert.match(renderSites, /<img src="Icon\/Privé\.png" alt="" aria-hidden="true" class="list-card__privacy-icon" \/> Privé/);
  assert.match(renderSites, /: `<h3 class="list-card__title">\$\{escapeHtml\(site\.nom\)\}<\/h3>`/);
  assert.match(styles, /body\[data-page="home"\] \.list-card__privacy-badge \{/);
  assert.match(styles, /body\[data-page="home"\] \.list-card__privacy-icon \{[\s\S]*?width: 0\.6rem;[\s\S]*?height: 0\.6rem;/);
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

test('les utilisateurs autorisés ne sont proposés que pour un site déjà privé', async () => {
  const app = await readSource('../js/app.js');
  const editPrivacy = app.slice(
    app.indexOf('async function editSitePrivacy('),
    app.indexOf('function openSiteActionSheet('),
  );

  assert.match(editPrivacy, /data-authorized-option[^>]*>[\s\S]*?value="authorized"[\s\S]*?Utilisateurs autorisés/);
  assert.match(editPrivacy, /authorizedOption\.hidden = site\.privacy !== 'private'/);
});

test('la modification de confidentialité est réservée au créateur et aux administrateurs', async () => {
  const app = await readSource('../js/app.js');
  const permissionCheck = app.slice(
    app.indexOf('function canCurrentUserManageOwnedSite('),
    app.indexOf('function ensureSharedSiteActionSheet('),
  );
  const sharedMenuHandler = app.slice(
    app.indexOf('privacy.onclick = () =>'),
    app.indexOf('remove.onclick =', app.indexOf('privacy.onclick = () =>')),
  );
  const homeMenuHandler = app.slice(
    app.indexOf('privacyButton.onclick = async () =>'),
    app.indexOf('deleteButton.onclick =', app.indexOf('privacyButton.onclick = async () =>')),
  );

  assert.match(permissionCheck, /permissions\?\.isAdmin/);
  assert.match(permissionCheck, /site\?\.createdBy \|\| site\?\.ownerId/);
  assert.match(permissionCheck, /currentUserId === creatorId/);
  assert.match(sharedMenuHandler, /canCurrentUserManageOwnedSite\(latestSite, permissions\)/);
  assert.match(sharedMenuHandler, /UiService\.showToast\('Réservé au créateur du site'\);[\s\S]*?return;[\s\S]*?onPrivacy\?\.\(siteId\)/);
  assert.match(homeMenuHandler, /canCurrentUserManageOwnedSite\(latestSiteState, currentPermissions\)/);
  assert.match(homeMenuHandler, /UiService\.showToast\('Réservé au créateur du site'\);[\s\S]*?return;[\s\S]*?editSitePrivacy\(siteId\)/);
});

test('la modification écrit privacy et allowedUsers sans toucher au contenu du site', async () => {
  const storage = await readSource('../js/storage.js');
  const updatePrivacy = storage.slice(storage.indexOf('async function updateSitePrivacy('), storage.indexOf('async function updateSiteCreator('));

  assert.match(updatePrivacy, /privacy !== 'public' && privacy !== 'private'/);
  assert.match(updatePrivacy, /setDoc\([^]*?\{ privacy, allowedUsers: nextAllowedUsers \}, \{ merge: true \}\)/);
  assert.doesNotMatch(updatePrivacy, /dateModification|passwordHash|isLocked|articles/);
});

test('la modification de confidentialité journalise les anciennes et nouvelles valeurs', async () => {
  const storage = await readSource('../js/storage.js');
  const updatePrivacy = storage.slice(storage.indexOf('async function updateSitePrivacy('), storage.indexOf('async function updateSiteCreator('));

  assert.match(updatePrivacy, /const previousPrivacy = site\?\.privacy === 'private' \? 'private' : 'public'/);
  assert.match(updatePrivacy, /privacy === previousPrivacy[\s\S]*?return \{ ok: true \}/);
  assert.match(updatePrivacy, /a modifié la confidentialité du site « \$\{site\.nom\} » de « \$\{previousLabel\} » à « \$\{nextLabel\} »\./);
  assert.match(updatePrivacy, /a modifié les utilisateurs autorisés du site/);
});

test('le partage privé gère une liste d’utilisateurs et conserve le badge Privé', async () => {
  const app = await readSource('../js/app.js');
  const storage = await readSource('../js/storage.js');

  assert.match(app, /<h3>Utilisateurs autorisés<\/h3>/);
  assert.match(app, /\+ Ajouter un utilisateur/);
  assert.match(app, /value="authorized"[\s\S]*?Utilisateurs autorisés/);
  assert.doesNotMatch(app, />Partagé</);
  assert.match(storage, /const allowedUsers = Array\.isArray\(site\?\.allowedUsers\)/);
  assert.match(storage, /allowedUsers: nextAllowedUsers/);
});

test("les logs d'historique ignorent les administrateurs et utilisent l'horodatage serveur", async () => {
  const storage = await readSource('../js/storage.js');
  const appendHistory = storage.slice(storage.indexOf('async function appendHistoryEntry('), storage.indexOf('async function pruneHistoryEntries('));

  assert.match(appendHistory, /normalizeRole\(profile\?\.role\) === 'admin'[\s\S]*?return/);
  assert.match(appendHistory, /userName: username/);
  assert.match(appendHistory, /createdAt: serverTimestamp\(\)/);
});
