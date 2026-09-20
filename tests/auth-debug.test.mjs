import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../Html/login.html', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../Html/index.html', import.meta.url), 'utf8');
const loginCss = await readFile(new URL('../css/login.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../js/auth-debug.js', import.meta.url), 'utf8');

test('les cartes de diagnostic et leurs styles ne sont pas exposés dans l’interface', () => {
  assert.doesNotMatch(html, /Diagnostic Auth Android|id="authDebugCard"|class="auth-debug-card/);
  assert.doesNotMatch(indexHtml, /Diagnostic Firebase Auth|class="firebase-diagnostic-card/);
  assert.doesNotMatch(loginCss, /\.auth-debug-card|#authDebugStatus/);
  assert.match(html, /<script src="\.\.\/js\/auth-debug\.js"><\/script>/);
});

test('le diagnostic expose tous les statuts du pont natif', () => {
  assert.match(script, /window\.updateAuthDebug = function updateAuthDebug\(status, message\)/);
  for (const status of [
    'START_GOOGLE_SIGNIN',
    'GOOGLE_ACCOUNT_PENDING',
    'GOOGLE_ACCOUNT_RECEIVED',
    'ID_TOKEN_RECEIVED',
    'FIREBASE_ANDROID_SUCCESS',
    'FIREBASE_ANDROID_ERROR',
    'WEBVIEW_TOKEN_SEND',
    'FIREBASE_WEB_SUCCESS',
    'FIREBASE_WEB_ERROR',
  ]) assert.match(script, new RegExp(status));
});

test('le script de diagnostic ne journalise aucune donnée sensible', () => {
  assert.doesNotMatch(script, /console\./);
  assert.doesNotMatch(script, /idToken|credential|password|email/i);
});
