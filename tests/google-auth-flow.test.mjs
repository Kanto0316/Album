import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loginSource = await readFile(new URL('../js/login.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const debugSource = await readFile(new URL('../js/auth-debug.js', import.meta.url), 'utf8');

test('le pont natif échange le Google ID Token contre une session Firebase', () => {
  assert.match(loginSource, /window\.firebaseLoginWithToken = async function \(idToken\)/);
  assert.match(loginSource, /GoogleAuthProvider\.credential\(idToken\)/);
  assert.match(loginSource, /await signInWithCredential\(firebaseAuth, credential\)/);
  assert.match(loginSource, /if \(!result\?\.user\)/);
});

test('le résultat du pont est structuré et ne renvoie jamais le token', () => {
  const bridge = loginSource.slice(
    loginSource.indexOf('window.firebaseLoginWithToken'),
    loginSource.indexOf('window.firebaseBridgeReady'),
  );
  assert.match(bridge, /success: true/);
  assert.match(bridge, /uid: result\.user\.uid/);
  assert.match(bridge, /success: false/);
  assert.doesNotMatch(bridge, /(?:return|console\.[a-z]+)\s*\([^)]*idToken/);
});

test('Android est notifié et le navigateur conserve le popup', () => {
  assert.match(loginSource, /window\.firebaseBridgeReady = true/);
  assert.match(loginSource, /window\.AndroidAuth\?\.firebaseReady\?\.\(\)/);
  assert.match(loginSource, /if \(window\.AndroidAuth\)/);
  assert.match(loginSource, /window\.AndroidAuth\.startGoogleSignIn\(\)/);
  assert.match(loginSource, /await signInWithPopup\(auth, provider\)/);
  assert.match(loginSource, /provider\.setCustomParameters\(\{ prompt: 'select_account' \}\)/);
});

test('un jeton Android exige une nouvelle tentative interactive et est consommé une seule fois', () => {
  const bridge = loginSource.slice(
    loginSource.indexOf('window.firebaseLoginWithToken'),
    loginSource.indexOf('function isInAppBrowser'),
  );
  assert.match(bridge, /if \(!attempt \|\| sessionStorage\.getItem\(AUTH_LOGOUT_IN_PROGRESS_KEY\)\)/);
  assert.match(bridge, /code: 'auth\/no-interactive-attempt'/);
  assert.match(bridge, /nativeGoogleAttempt = null/);
  assert.match(loginSource, /NATIVE_LOGIN_TIMEOUT_MS/);
});

test('la WebView ne lance que le sélecteur natif au clic Google', () => {
  const nativeBranch = loginSource.slice(
    loginSource.indexOf('if (window.AndroidAuth)'),
    loginSource.indexOf('// signInWithRedirect'),
  );
  assert.match(nativeBranch, /window\.AndroidAuth\.startGoogleSignIn\(\)/);
  assert.doesNotMatch(nativeBranch, /signInWithPopup/);
});

test('la déconnexion Android attend le bon événement avant Firebase et la redirection', () => {
  const nativeHelper = appSource.slice(
    appSource.indexOf('function waitForNativeSignOut'),
    appSource.indexOf('function clearObsoleteAuthIdentity'),
  );
  assert.match(nativeHelper, /addEventListener\('android-auth-signout-result'/);
  assert.match(nativeHelper, /event\?\.detail\?\.requestId !== requestId/);
  assert.match(nativeHelper, /window\.AndroidAuth\.signOut\(requestId\)/);
  assert.match(nativeHelper, /NATIVE_SIGN_OUT_TIMEOUT_MS/);

  const logoutFlow = appSource.slice(
    appSource.indexOf('logoutButton.onclick = async'),
    appSource.indexOf('overlay.onclick =', appSource.indexOf('logoutButton.onclick = async')),
  );
  assert.ok(logoutFlow.indexOf('await waitForNativeSignOut(requestId)') < logoutFlow.indexOf('await signOut(firebaseAuth)'));
  assert.ok(logoutFlow.indexOf('await signOut(firebaseAuth)') < logoutFlow.indexOf("window.location.replace('login.html')"));
  assert.match(logoutFlow, /typeof window\.AndroidAuth\.signOut !== 'function'/);
  assert.match(logoutFlow, /logoutInProgress = false/);
});

test('la déconnexion ne supprime que les mémoires Auth applicatives', () => {
  const cleanup = appSource.slice(
    appSource.indexOf('function clearObsoleteAuthIdentity'),
    appSource.indexOf('function installOfflineFabProtection'),
  );
  assert.match(cleanup, /removeItem\(AUTH_USER_STORAGE_KEY\)/);
  assert.match(cleanup, /removeItem\(LOGIN_MEMO_STORAGE_KEY\)/);
  assert.match(cleanup, /removeItem\(GOOGLE_WELCOME_KEY\)/);
  assert.doesNotMatch(cleanup, /\.clear\(|indexedDB/);
});

test('les journaux Web Auth demandés sont présents sans donnée sensible', () => {
  for (const event of [
    'login_start',
    'popup_success',
    'native_token_received',
    'credential_created',
    'firebase_signin_success',
    'firebase_signin_error',
    'redirect_to_index',
  ]) {
    assert.match(loginSource, new RegExp(`logWebAuth\\('${event}'\\)`));
  }
  assert.doesNotMatch(loginSource, /console\.(?:log|info|warn|error)\([^\n]*(?:idToken|credential)/);
});

test('la redirection Auth est unique et couvre le retour Android', () => {
  const redirectHelper = loginSource.slice(
    loginSource.indexOf('function redirectToHome()'),
    loginSource.indexOf('window.firebaseLoginWithToken'),
  );
  const nativeBridge = loginSource.slice(
    loginSource.indexOf('window.firebaseLoginWithToken'),
    loginSource.indexOf('function isInAppBrowser'),
  );

  assert.match(loginSource, /let redirectDone = false/);
  assert.match(redirectHelper, /if \(redirectDone\)/);
  assert.match(redirectHelper, /redirectDone = true/);
  assert.match(redirectHelper, /window\.location\.replace\('index\.html'\)/);
  assert.match(nativeBridge, /logWebAuth\('firebase_signin_success'\);\s+googleSignInPending = false;\s+redirectToHome\(\)/);
  assert.equal(loginSource.match(/window\.location\.replace\('index\.html'\)/g)?.length, 1);
});

test('app.js est la source unique du diagnostic Auth', () => {
  assert.match(appSource, /window\.updateFirebaseDiagnostic\(\{/);
  assert.match(appSource, /event: 'AUTH_STATE_CHANGED'/);
  assert.match(appSource, /event: 'SIGNED_OUT'/);
  assert.doesNotMatch(debugSource, /onAuthStateChanged|sessionStorage/);
});
