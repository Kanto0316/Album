import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const loginSource = await readFile(new URL('../js/login.js', import.meta.url), 'utf8');

test('le login Google utilise uniquement le flux de redirection Firebase', () => {
  assert.doesNotMatch(loginSource, /signInWithPopup/, 'aucun flux popup ne doit subsister');
  assert.match(loginSource, /await signInWithRedirect\(auth, provider\)/);
  assert.match(loginSource, /await getRedirectResult\(auth, provider\)/);
});

test('le résultat de redirection enregistre le profil avant de revenir à l’accueil', () => {
  const handlerStart = loginSource.indexOf('async function handleGoogleRedirectResult');
  const handlerEnd = loginSource.indexOf('\nconst authReadyPromise', handlerStart);
  const handlerSource = loginSource.slice(handlerStart, handlerEnd);

  const resultCheck = handlerSource.indexOf('if (!result?.user)');
  const saveUser = handlerSource.indexOf('saveAuthenticatedUser(result.user)');
  const diagnostic = handlerSource.indexOf("recordAuthDebugEvent('Redirect Google terminé')");
  const redirect = handlerSource.indexOf('redirectToHome()');

  assert.ok(resultCheck >= 0, 'le résultat doit contenir un utilisateur Firebase');
  assert.ok(saveUser > resultCheck, 'le profil doit être enregistré après validation du résultat');
  assert.ok(diagnostic > saveUser, 'le diagnostic doit confirmer la fin de la redirection');
  assert.ok(redirect > diagnostic, "la navigation doit suivre l'enregistrement et le diagnostic");
});

test('le flux conserve la surveillance Auth et les journaux demandés', () => {
  assert.match(loginSource, /onAuthStateChanged\(auth,/);
  for (const message of [
    'Début redirect Google',
    'Retour redirect Google',
    'User Firebase reçu',
    'Erreur Firebase éventuelle',
  ]) {
    assert.match(loginSource, new RegExp(message), `journal manquant : ${message}`);
  }
});
