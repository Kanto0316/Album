# Audit du signal de disponibilité Firestore (Web)

## Périmètre analysé

- `index.html` charge `js/app.js` comme module à la fin du `<body>`. Au moment où le contrôle de disponibilité s'exécute, la structure de l'écran d'accueil est donc déjà présente dans le DOM.
- `js/firebase-core.js` initialise l'application Firebase et exporte l'instance `firebaseDb` utilisée par les lectures Firestore.
- `js/storage.js` initialise les données de l'application avec `loadRemoteSnapshot()`. Sa première lecture distante utile est la collection `pages/page1/items`, qui alimente la liste des sites de l'accueil.
- `js/app.js` attend normalement l'état Firebase Auth avant `StorageService.init()` et le rendu de la page. Le signal de splash ne doit pas dépendre de cette attente Auth.

## Point de disponibilité retenu

La collection Firestore `pages/page1/items` est le premier chargement important : elle fournit les sites affichés sur l'écran initial. Le contrôle du splash lance une lecture serveur explicite de cette collection avec `getDocsFromServer`.

La disponibilité est validée uniquement lorsque :

1. la lecture a réussi auprès du serveur Firestore ;
2. la promesse de récupération est terminée ;
3. une frame de rendu a été laissée au navigateur, alors que le DOM de l'accueil est déjà chargé.

La lecture est lancée indépendamment du bootstrap applicatif afin de ne pas attendre Firebase Auth. Une erreur Firestore est journalisée et **aucun** signal de succès n'est alors envoyé.

## Comportement par environnement

### APK Android

Lorsque le bridge expose `window.AndroidApp.readyFirestore`, `js/app.js` appelle cette méthode une seule fois après la disponibilité décrite ci-dessus.

### Navigateur Chrome

En l'absence de `window.AndroidApp`, aucun appel n'est effectué et aucune erreur n'est générée.

## Journaux ajoutés

- `[SPLASH_WEB] attente Firestore` au démarrage de la lecture initiale ;
- `[SPLASH_WEB] Firestore prêt` après la réussite de la lecture et lorsque l'interface peut être affichée ;
- `[SPLASH_WEB] signal Android envoyé` après l'appel effectif du bridge Android.

En cas d'échec, `[SPLASH_WEB] Firestore indisponible` est émis avec l'erreur, sans masquer prématurément le splash Android.

## Éléments non modifiés

Le changement ne modifie ni l'authentification, ni les mécanismes de stockage et de synchronisation, ni les règles métier, ni les exports Excel ou `.su`.
