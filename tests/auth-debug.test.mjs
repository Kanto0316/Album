import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../login.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../js/auth-debug.js', import.meta.url), 'utf8');

test('la carte de diagnostic est propre à login.html et précède le bouton Google', () => {
  assert.match(html, /Diagnostic Auth Android/);
  assert.ok(html.indexOf('id="authDebugCard"') < html.indexOf('id="googleLoginButton"'));
  assert.match(html, /<script src="js\/auth-debug\.js"><\/script>/);
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
