import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('le formulaire propose la visibilité « Tout le monde » par défaut après l’accès', async () => {
  const html = await readSource('../index.html');
  const accessPosition = html.indexOf('id="siteSecuritySelect"');
  const privacyPosition = html.indexOf('id="sitePrivacySelect"');

  assert.ok(privacyPosition > accessPosition);
  assert.match(html, /id="sitePrivacySelect"[\s\S]*?<option value="public" selected>Tout le monde<\/option>/);
  assert.match(html, /<option value="private">Moi uniquement<\/option>/);
  assert.match(html, /<option value="restricted">Utilisateurs autorisés<\/option>/);
});

test('la création valide et transmet la confidentialité sélectionnée', async () => {
  const app = await readSource('../js/app.js');
  const submit = app.slice(app.indexOf("siteForm.addEventListener('submit'"), app.indexOf("siteEditNameForm?.addEventListener('submit'"));

  assert.match(submit, /\['public', 'private', 'restricted'\]\.includes\(privacy\)/);
  assert.match(submit, /StorageService\.createSite\(name, \{[\s\S]*?privacy,/);
});

test('Firestore enregistre les trois niveaux et refuse toute autre valeur', async () => {
  const storage = await readSource('../js/storage.js');
  const createSite = storage.slice(storage.indexOf('async function createSite('), storage.indexOf('async function updateSiteName('));

  assert.match(createSite, /const privacy = security\?\.privacy \|\| 'public'/);
  assert.match(createSite, /\['public', 'private', 'restricted'\]\.includes\(privacy\)/);
  assert.match(createSite, /createdBy: state\.userId,[\s\S]*?privacy,/);
});

test('la création journalise le site et la confidentialité avec les libellés affichés', async () => {
  const storage = await readSource('../js/storage.js');
  const createSite = storage.slice(storage.indexOf('async function createSite('), storage.indexOf('async function updateSiteName('));

  assert.match(createSite, /a créé le site « \$\{site\.nom\} » avec confidentialité « \$\{getSitePrivacyLabel\(privacy\)\} »\./);
  assert.match(createSite, /appendHistoryEntry\([^]*?\{ siteId: site\.id, siteName: site\.nom \}/);
});

test('les sites privés et restreints appliquent leurs règles d’accès', async () => {
  const storage = await readSource('../js/storage.js');
  const visibility = storage.slice(storage.indexOf('function isSiteVisibleToCurrentUser('), storage.indexOf('function filterSitesVisibleToCurrentUser('));

  assert.match(visibility, /\['private', 'restricted'\]\.includes\(site\?\.privacy\)/);
  assert.match(visibility, /privacy === 'restricted' && allowedUsers\.includes/);
  assert.match(visibility, /state\.canViewAllSites \|\| canViewForInactivity/);
});

test('les cartes affichent les badges Public, Privé et Partagé', async () => {
  const app = await readSource('../js/app.js');
  const renderSites = app.slice(app.indexOf('function renderSites()'), app.indexOf("siteList.querySelectorAll('[data-site-creator]')"));
  const styles = await readSource('../css/style.css');

  assert.match(renderSites, /privacyLabel = privacy === 'private' \? 'Privé' : privacy === 'restricted' \? 'Partagé' : 'Public'/);
  assert.match(renderSites, /data-site-access/);
  assert.match(styles, /body\[data-page="home"\] \.list-card__privacy-badge \{/);
  assert.match(styles, /\.list-card__privacy-badge--restricted/);
});

test('le menu réutilise l’icône de confidentialité et ouvre le dialogue de modification', async () => {
  const app = await readSource('../js/app.js');

  assert.match(app, /src="Icon\/Confidentialité\.png"[^>]*>[\s\S]*?Modifier la confidentialité/);
  assert.match(app, /<h2>Confidentialité du site<\/h2>/);
  assert.match(app, /<legend>Qui peut voir ce site \?<\/legend>/);
  assert.match(app, /value="public"[^>]*>[\s\S]*?Tout le monde/);
  assert.match(app, /value="private"[^>]*>[\s\S]*?Moi uniquement/);
  assert.match(app, /value="restricted"[^>]*>[\s\S]*?Utilisateurs autorisés/);
  assert.match(app, />Annuler<\/button>[\s\S]*?>Enregistrer<\/button>/);
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

test('la modification écrit privacy et allowedUsers sans affecter le verrouillage', async () => {
  const storage = await readSource('../js/storage.js');
  const updatePrivacy = storage.slice(storage.indexOf('async function updateSitePrivacy('), storage.indexOf('async function updateSiteCreator('));

  assert.match(updatePrivacy, /\['public', 'private', 'restricted'\]\.includes\(privacy\)/);
  assert.match(updatePrivacy, /setDoc\([^]*?\{ privacy, allowedUsers: normalizedAllowedUsers \}, \{ merge: true \}\)/);
  assert.doesNotMatch(updatePrivacy, /dateModification|passwordHash|isLocked|articles/);
});

test('la modification de confidentialité journalise les anciennes et nouvelles valeurs', async () => {
  const storage = await readSource('../js/storage.js');
  const updatePrivacy = storage.slice(storage.indexOf('async function updateSitePrivacy('), storage.indexOf('async function updateSiteCreator('));

  assert.match(updatePrivacy, /const previousPrivacy = \['private', 'restricted'\]\.includes\(site\?\.privacy\)/);
  assert.match(updatePrivacy, /privacy === previousPrivacy[\s\S]*?return \{ ok: true \}/);
  assert.match(updatePrivacy, /a modifié la confidentialité du site « \$\{site\.nom\} » de « \$\{getSitePrivacyLabel\(previousPrivacy\)\} » à « \$\{getSitePrivacyLabel\(privacy\)\} »\./);
});

test("les logs d'historique ignorent les administrateurs et utilisent l'horodatage serveur", async () => {
  const storage = await readSource('../js/storage.js');
  const appendHistory = storage.slice(storage.indexOf('async function appendHistoryEntry('), storage.indexOf('async function pruneHistoryEntries('));

  assert.match(appendHistory, /normalizeRole\(profile\?\.role\) === 'admin'[\s\S]*?return/);
  assert.match(appendHistory, /userName: username/);
  assert.match(appendHistory, /createdAt: serverTimestamp\(\)/);
});
