import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('le formulaire propose la confidentialité publique par défaut après l’accès', async () => {
  const html = await readSource('../index.html');
  const accessPosition = html.indexOf('id="siteSecuritySelect"');
  const privacyPosition = html.indexOf('id="sitePrivacySelect"');

  assert.ok(privacyPosition > accessPosition);
  assert.match(html, /<span>Confidentialité<\/span>[\s\S]*?id="sitePrivacySelect"[\s\S]*?<option value="public" selected>Public<\/option>[\s\S]*?<option value="private">Moi uniquement<\/option>/);
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
