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
  ]) {
    assert.match(loginSource, new RegExp(`logWebAuth\\('${event}'\\)`));
  }
  assert.doesNotMatch(loginSource, /console\.(?:log|info|warn|error)\([^\n]*(?:idToken|credential)/);
});

test('app.js est la source unique du diagnostic Auth', () => {
  assert.match(appSource, /window\.updateFirebaseDiagnostic\(\{/);
  assert.match(appSource, /event: 'AUTH_STATE_CHANGED'/);
  assert.match(appSource, /event: 'SIGNED_OUT'/);
  assert.doesNotMatch(debugSource, /onAuthStateChanged|sessionStorage/);
});
