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
