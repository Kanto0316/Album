import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loginSource = await readFile(new URL('../js/login.js', import.meta.url), 'utf8');

test('le retour Android échange le idToken Google contre une session Firebase', () => {
  const callbackStart = loginSource.indexOf('window.onAndroidGoogleAccountResult');
  const callbackEnd = loginSource.indexOf('\nfunction mapGoogleAuthError', callbackStart);
  const callbackSource = loginSource.slice(callbackStart, callbackEnd);

  const tokenRead = callbackSource.indexOf('const idToken =');
  const credentialCreation = callbackSource.indexOf('GoogleAuthProvider.credential(idToken)');
  const firebaseSignIn = callbackSource.indexOf('await signInWithCredential(auth, credential)');
  const currentUserCheck = callbackSource.indexOf('if (!auth.currentUser)');
  const redirect = callbackSource.indexOf('redirectToHome()');

  assert.ok(tokenRead >= 0, 'le callback doit récupérer le idToken Google');
  assert.ok(credentialCreation > tokenRead, 'le credential doit être créé après la lecture du token');
  assert.ok(firebaseSignIn > credentialCreation, 'Firebase doit recevoir le credential Google');
  assert.ok(currentUserCheck > firebaseSignIn, 'currentUser doit être vérifié après la confirmation Firebase');
  assert.ok(redirect > currentUserCheck, "l'interface ne doit changer qu'après validation de currentUser");
});

test('le flux Android conserve les journaux de diagnostic Firebase demandés', () => {
  for (const message of [
    'Google result reçu',
    'credential créé',
    'signInWithCredential réussi',
    'signInWithCredential erreur Firebase',
  ]) {
    assert.match(loginSource, new RegExp(message), `journal manquant : ${message}`);
  }
  assert.match(loginSource, /idToken.*'présent'.*'absent'/, 'le journal doit distinguer un idToken présent ou absent');
});
