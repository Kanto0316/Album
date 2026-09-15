# Diagnostic du flux Firebase Auth Android

## Objectif

La page `login.html` affiche maintenant, juste avant le bouton Google, une carte de diagnostic Material consacrée au flux Google Sign-In de la WebView. La carte indique le statut courant, le dernier événement et la dernière erreur sans afficher de token, de credential, de mot de passe ou d'adresse e-mail.

## Fichiers modifiés

- `login.html` contient la carte et charge son script uniquement sur la page de connexion.
- `css/login.css` fournit la présentation compacte de la carte.
- `js/auth-debug.js` expose la fonction globale `window.updateAuthDebug(status, message)`, traduit les statuts techniques en libellés français et met à jour les trois champs avec `textContent`.
- `tests/auth-debug.test.mjs` contrôle la présence, l'emplacement, les statuts et l'absence de données sensibles dans le diagnostic.

Les fichiers `js/login.js`, `js/app.js`, la configuration Firebase et les règles Firestore ne sont pas modifiés.

## Contrat du pont Android

Le code source Android (`MainActivity.kt`) n'est pas présent dans ce dépôt Web et ne peut donc pas être modifié ici. L'activité native doit appeler, via `WebView.evaluateJavascript`, la fonction suivante sans interpoler de donnée sensible :

```text
window.updateAuthDebug(<status JSON>, <message JSON>)
```

Les valeurs de statut prises en charge sont :

| Étape native | Statut |
| --- | --- |
| Avant `AndroidAuth.startGoogleSignIn()` | `START_GOOGLE_SIGNIN` |
| En attente de la sélection | `GOOGLE_ACCOUNT_PENDING` |
| Compte Google récupéré | `GOOGLE_ACCOUNT_RECEIVED` |
| `account.idToken != null` | `ID_TOKEN_RECEIVED` |
| Auth Firebase Android réussie | `FIREBASE_ANDROID_SUCCESS` |
| Auth Firebase Android en erreur | `FIREBASE_ANDROID_ERROR` |
| Avant `firebaseLoginWithToken(idToken)` | `WEBVIEW_TOKEN_SEND` |
| Réponse JavaScript `success=true` | `FIREBASE_WEB_SUCCESS` |
| Réponse JavaScript en erreur | `FIREBASE_WEB_ERROR` |

Les logs natifs correspondants doivent utiliser exclusivement le format `[AUTH_DEBUG] <STATUS>`. Le token, le credential, l'e-mail complet et le mot de passe ne doivent jamais faire partie du message ou du log.
