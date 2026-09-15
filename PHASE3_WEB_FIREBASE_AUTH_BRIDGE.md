# Phase 3 — Pont Firebase Auth Web pour APK native

## Périmètre

Cette phase adapte exclusivement le code Web. Aucun fichier Android n'a été modifié.

## Pont Android → Firebase Web

La page de connexion expose `window.firebaseLoginWithToken(idToken)`. Le pont :

1. refuse une valeur de token absente ;
2. crée un `GoogleAuthProvider.credential(idToken)` uniquement en mémoire ;
3. appelle `signInWithCredential(firebaseAuth, credential)` ;
4. valide la présence de `UserCredential.user` ;
5. renvoie seulement `success`, `uid`, `email` et `displayName` en cas de succès, ou `success`, `code` et `message` en cas d'échec.

Ni le token ni le credential ne sont stockés, journalisés ou renvoyés.

## Sélection du flux Google

Le bouton Google journalise `login_start`. Si `window.AndroidAuth` est disponible, il délègue l'authentification à `AndroidAuth.startGoogleSignIn()`. Dans un navigateur ordinaire, le flux existant `signInWithPopup()` reste utilisé et journalise `popup_success` après succès.

Une fois le module Firebase chargé et le pont installé, `window.firebaseBridgeReady` passe à `true`, puis `AndroidAuth.firebaseReady()` est appelé si cette méthode existe.

## Diagnostic

`app.js` est la source de vérité du diagnostic. Son observateur Firebase transmet à `window.updateFirebaseDiagnostic` :

- `AUTH_STATE_CHANGED`, avec l'UID, l'email et le nom d'affichage quand un utilisateur existe ;
- `SIGNED_OUT` quand Firebase ne fournit aucun utilisateur.

`auth-debug.js` ne crée plus de second observateur Firebase et ne conserve plus un état concurrent en `sessionStorage`. Son objet historique `AuthDebug` est seulement un adaptateur vers le diagnostic central, pour préserver une éventuelle compatibilité.

## Journaux non sensibles

Tous les événements du pont utilisent le préfixe `[WEB_AUTH]` : `login_start`, `popup_success`, `native_token_received`, `credential_created`, `firebase_signin_success` et `firebase_signin_error`. Aucun secret OAuth, token ou credential n'est inclus dans les journaux.
