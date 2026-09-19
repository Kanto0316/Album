import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('le formulaire propose Ouvert à tous par défaut et réutilise les champs de verrouillage', async () => {
  const html = await readSource('../index.html');
  assert.match(html, /id="siteSecuritySelect"[\s\S]*?<option value="open" selected>Ouvert à tous<\/option>[\s\S]*?<option value="locked">Verrouillé<\/option>/);
  assert.equal((html.match(/id="siteLockPasswordInput"/g) || []).length, 1);
  assert.equal((html.match(/id="siteLockConfirmPasswordInput"/g) || []).length, 1);
  assert.match(html, /id="siteCreateSecurityFields"[^>]*hidden/);
  assert.match(html, /id="siteLockPasswordInput" type="password"[^>]*minlength="6"[^>]*maxlength="128"/);
});

test('le changement de sécurité masque, vide et rend facultatifs les mots de passe', async () => {
  const app = await readSource('../js/app.js');
  const mode = app.slice(app.indexOf('function clearSiteLockCreationFields'), app.indexOf('async function loadUserNames'));
  assert.match(mode, /siteLockPasswordInput\.value = ''/);
  assert.match(mode, /siteLockConfirmPasswordInput\.value = ''/);
  assert.match(mode, /siteLockPasswordInput\.required = false/);
  assert.match(mode, /siteCreateSecurityFields\.hidden = !isLocked/);
  assert.match(mode, /clearSiteLockFieldErrorState\(siteLockPasswordInput/);
  assert.match(app, /siteDialog\.addEventListener\('close',[\s\S]*?resetSiteCreateForm\(\);/);
});

test('la création verrouillée valide les champs et ne transmet que le hachage', async () => {
  const app = await readSource('../js/app.js');
  const submit = app.slice(app.indexOf("siteForm.addEventListener('submit'"), app.indexOf("siteEditNameForm?.addEventListener('submit'"));
  assert.match(submit, /passwordValue\.length < 6 \|\| passwordValue\.length > 128/);
  assert.match(submit, /passwordValue !== confirmValue/);
  assert.match(submit, /passwordHash = await hashPassword\(passwordValue\)/);
  assert.match(submit, /StorageService\.createSite\(name, \{[\s\S]*?isLocked: shouldLockSite,[\s\S]*?passwordHash/);
  assert.doesNotMatch(submit, /StorageService\.createSite\([^]*?password:\s*passwordValue/);
});

test('Firestore reçoit directement le bon état de sécurité dans une seule création', async () => {
  const storage = await readSource('../js/storage.js');
  const createSite = storage.slice(storage.indexOf('async function createSite('), storage.indexOf('async function updateSiteName('));
  assert.match(createSite, /isLocked: shouldLockSite/);
  assert.match(createSite, /passwordHash,/);
  assert.match(createSite, /lockedAt: timestamp/);
  assert.match(createSite, /unlockAttemptsRemaining: 3/);
  assert.equal((createSite.match(/addDoc\(/g) || []).length, 1);
  assert.doesNotMatch(createSite, /setSiteLock|setDoc\(/);
  assert.doesNotMatch(createSite, /password:\s/);
});

test('la carte annonce immédiatement Ouvert ou Verrouillé', async () => {
  const app = await readSource('../js/app.js');
  assert.match(app, /const lockLabel = siteIsLocked \? 'Verrouillé' : 'Ouvert'/);
});

test('le dialogue de création conserve le centrage natif utilisé par les autres formulaires', async () => {
  const css = await readSource('../css/style.css');
  const mobileRules = css.slice(css.indexOf('/* Le formulaire de création reste utilisable au-dessus du clavier mobile. */'));

  assert.match(mobileRules, /\.site-create-security-fields\s*\{[^}]*margin-top:\s*1rem/);
  assert.doesNotMatch(mobileRules, /#siteDialog\s*\{[^}]*margin(?:-block)?\s*:/);
  assert.match(mobileRules, /#siteDialog \.modal-content--site-create\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(mobileRules, /#siteDialog \.modal-actions--site-create\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/);
});
