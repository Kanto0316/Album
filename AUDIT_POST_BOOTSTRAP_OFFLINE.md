# Audit post-bootstrap du système offline

**Date de l'audit :** 2 septembre 2026  
**Nature :** audit statique du code, sans modification fonctionnelle et sans intégration de `createDetail()`.

## Périmètre et méthode

L'audit couvre `index.html`, toutes les pages HTML qui chargent `js/app.js`, ainsi que :

- `js/app.js` ;
- `js/sync-manager.js` ;
- `js/offline-sync.js` ;
- `js/offline-adapter.js` ;
- `js/offline-id-mapper.js` ;
- `js/material-offline-adapter.js` ;
- `js/offline-action-builder.js`.

`js/firebase-core.js` a également été consulté pour établir précisément l'origine de `firebaseDb`. `js/storage.js` a été uniquement lu afin de vérifier son chargement et ses interactions avec la file offline ; il n'a pas été modifié.

Cet audit est statique : il vérifie les déclarations, appels, dépendances et chemins d'exécution visibles dans le dépôt. Il ne remplace pas un test dans un navigateur avec IndexedDB et Firebase réellement disponibles.

---

# 1. Chargement des scripts

Les pages qui chargent effectivement l'application sont celles qui incluent `js/app.js`. `login.html` n'en fait pas partie : cette page charge uniquement `maintenance-banner.js` et `login.js` et n'instancie donc pas le bootstrap applicatif audité.

Ordre attendu :

1. `offline-sync.js`
2. `offline-id-mapper.js`
3. `offline-adapter.js`
4. `material-offline-adapter.js`
5. `offline-action-builder.js`
6. `sync-manager.js`
7. `storage.js`
8. `app.js`

| Fichier HTML | Scripts présents | Ordre correct | Problème |
|---|---|---:|---|
| `index.html` | Les 8 scripts attendus | Oui | Aucun |
| `page2.html` | Les 8 scripts attendus | Oui | Aucun |
| `page3.html` | Les 8 scripts attendus | Oui | Aucun |
| `materiels.html` | Les 8 scripts attendus | Oui | Aucun ; `html2canvas` et `materiels.js` sont chargés ensuite |
| `purchase-detail.html` | Les 8 scripts attendus | Oui | Aucun sur la séquence ; `firebase-core.js` est en plus déclaré avant elle, mais le cache des modules ES évite une seconde évaluation lors de son import par `storage.js`/`app.js` |
| `users.html` | Les 8 scripts attendus | Oui | Aucun ; un module inline propre à la page est chargé après `app.js` |
| `parametres.html` | Les 8 scripts attendus | Oui | Aucun |
| `corbeille.html` | Les 8 scripts attendus | Oui | Aucun |
| `historiques.html` | Les 8 scripts attendus | Oui | Aucun |

### Verdict

La séquence demandée est présente, complète et correctement ordonnée sur **9 pages sur 9** chargeant l'application. Les scripts sont déclarés comme modules ES ; leur exécution différée respecte ici la séquence des balises, tandis que les imports partagés comme `firebase-core.js` ne sont évalués qu'une fois par document.

---

# 2. Initialisation Firebase + Offline

## Firebase

- Firebase est initialisé dans `js/firebase-core.js`.
- Le code utilise `getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG)`, ce qui protège aussi contre la création d'une seconde application Firebase dans le même document.
- `firebaseDb` est construit par `getFirestore(firebaseApp)` puis exporté par `firebase-core.js`.
- `js/app.js` importe directement `firebaseDb` depuis `./firebase-core.js`. L'évaluation du graphe de modules garantit donc que cette référence existe avant l'exécution du corps de `app.js`.
- `js/storage.js` importe la même référence. Sur `purchase-detail.html`, la balise explicite chargeant `firebase-core.js` ne réinitialise pas Firebase : un module ES déjà évalué est réutilisé.

## Bootstrap offline

Le seul appel trouvé à :

```js
SyncManager.init({
  firebaseDb
})
```

se trouve dans `initOfflineBootstrap()` dans `js/app.js`. `bootstrap()` appelle `initOfflineBootstrap()` une seule fois, puis le fichier appelle `bootstrap()` une seule fois.

À l'intérieur de `SyncManager.init()` :

1. les dépendances globales sont contrôlées ;
2. `await OfflineSync.init()` ouvre la file IndexedDB ;
3. `OfflineAdapter.init(firebaseDb)` injecte la référence Firestore ;
4. `await MaterialOfflineAdapter.init()` initialise l'adaptateur métier et attend `OfflineIdMapper.init()` ;
5. le statut initial est publié ;
6. l'écoute des changements réseau démarre.

### Verdict

**Confirmé statiquement : `SyncManager.init({ firebaseDb })` est appelé une seule fois par exécution de `app.js`.** Il n'existe pas de second appel dans le dépôt. Les méthodes `OfflineSync.init()` et `OfflineIdMapper.init()` restent par ailleurs idempotentes grâce à la mémorisation de leur promesse d'ouverture.

Nuance : `SyncManager.init()` lui-même n'a pas de garde empêchant un consommateur futur de le rappeler. Ce n'est pas un défaut observable aujourd'hui, puisque l'unique appel est dans `app.js` et `start()` empêche au moins de dupliquer l'écouteur réseau.

---

# 3. Vérification de SyncManager

## Chemin de synchronisation observé

Pour le traitement de la file :

```text
SyncManager.runSynchronization()
  -> OfflineSync.getPendingActions()
  -> MaterialOfflineAdapter.syncActions(actions)
  -> MaterialOfflineAdapter.syncAction(action)
```

Pour `updateDetail`, `deleteDetail` et `addReturn`, la suite est conforme :

```text
MaterialOfflineAdapter
  -> OfflineAdapter.processAction(...)
  -> SDK Firestore (updateDoc/deleteDoc)
```

Il n'existe plus d'appel de synchronisation direct du type :

```text
SyncManager -> OfflineAdapter.processAction/syncActions
```

`SyncManager` appelle exclusivement `MaterialOfflineAdapter.syncActions()` pour traiter les actions. Son appel direct à `OfflineAdapter.init(firebaseDb)` relève de l'injection de dépendance au démarrage, pas du traitement direct d'une action.

## Écart architectural important

Le flux demandé n'est toutefois **pas intégralement respecté** pour les créations `createSite`, `createItem` et `createDetail` : `MaterialOfflineAdapter.createEntity()` appelle directement `addDoc()` du SDK Firestore. Il utilise `OfflineAdapter.getCollectionReference()`, mais l'écriture elle-même suit ce chemin :

```text
SyncManager
  -> MaterialOfflineAdapter
  -> addDoc Firestore directement
```

Le commentaire du code explique ce contournement : `OfflineAdapter.processAction()` ne renvoie pas actuellement l'identifiant du document créé, alors que le mapper en a besoin. Tant que ce contrat n'est pas enrichi, le diagramme strict `MaterialOfflineAdapter -> OfflineAdapter -> Firestore` n'est pas garanti pour les créations.

### Verdict

- **Validé :** aucun traitement direct `SyncManager -> OfflineAdapter`.
- **Non validé au sens strict :** les créations métier contournent la méthode de traitement de `OfflineAdapter` et écrivent directement dans Firestore.

---

# 4. Vérification des événements

## `offlineStatusChanged`

**Émetteur :** `OfflineSync.dispatchConnectionStatus()` émet l'événement avec :

```js
detail: { online: OfflineSync.isOnline() }
```

Cette émission se produit en réponse aux événements natifs `window.online` et `window.offline`.

**Écouteurs :**

- `SyncManager` l'écoute après `start()` : passage à `offline` si la connexion tombe, ou déclenchement de `sync()` au retour en ligne ;
- `app.js` l'écoute pour mettre à jour `window.AppOfflineStatus.status`.

Il n'y a pas d'émission initiale de `offlineStatusChanged` au chargement. Ce n'est pas bloquant pour le statut initial, car `SyncManager.init()` consulte directement `OfflineSync.isOnline()` puis émet `syncStatusChanged`.

## `syncStatusChanged`

**Émetteur :** uniquement `SyncManager.setStatus()`, avec `detail: { status }`.

**Écouteur trouvé :** `app.js`, qui reporte la valeur dans `window.AppOfflineStatus.status`.

Les statuts possibles visibles dans le flux sont `idle`, `offline`, `syncing`, `completed` et `error`.

## État global

`window.AppOfflineStatus` est créé au début de `app.js` avec :

```js
{
  status: 'idle',
  initialized: false
}
```

Après la réussite du bootstrap offline, `initialized` passe à `true` et `status` reçoit `SyncManager.getStatus()`. En cas d'échec, l'état devient `{ initialized: false, status: 'error' }`.

### Risque de cohérence d'état

Lors d'un événement `offlineStatusChanged` avec `online: true`, l'écouteur de `app.js` force immédiatement le statut global à `idle`, pendant que `SyncManager` déclenche une synchronisation asynchrone. Les événements suivants le corrigent normalement vers `syncing` puis `completed`/`error`, mais une brève transition `idle` existe. Un modèle séparant `online` et `syncStatus` serait plus robuste qu'un champ `status` partagé.

---

# 5. Vérification IndexedDB

## Base de la file offline

- **Nom :** `suiviMaterielOffline`
- **Version :** `1`
- **Store `pendingActions` :** clé `id`, auto-incrémentée ; index non uniques `status` et `createdAt`
- **Store `metadata` :** clé `key`

`OfflineSync.init()` est explicitement attendu par `SyncManager.init()`. Le bootstrap n'avance donc pas vers l'état initialisé tant que l'ouverture de cette base n'a pas réussi.

## Base du mapper d'identifiants

- **Nom :** `suiviMaterielOfflineIdMapper`
- **Version :** `1`
- **Store `idMappings` :** clé `id`
- **Index :** `localId` unique, `firestoreId` unique, `entityType` non unique

`OfflineIdMapper.init()` est attendu par `MaterialOfflineAdapter.init()`, lui-même attendu par `SyncManager.init()`. Le mapper est donc prêt avant que le bootstrap offline soit déclaré réussi.

## Verdict

Les deux initialisations IndexedDB sont bien **attendues au démarrage**. Deux bases séparées sont volontairement créées, avec trois stores au total. En l'absence d'IndexedDB ou en cas d'ouverture bloquée, l'exception remonte jusqu'à `initOfflineBootstrap()`, qui expose correctement l'état `error` sans empêcher le reste du bootstrap applicatif de tenter de continuer.

---

# 6. Erreurs console possibles

| Risque | Niveau | Analyse |
|---|---:|---|
| Module chargé trop tard | Faible | Les 9 pages applicatives respectent toutes l'ordre requis. Les contrôles de dépendances produiraient une erreur explicite si une page future oubliait un module. |
| Échec de téléchargement du SDK Firebase CDN | Important | Plusieurs modules importent `gstatic.com`. Sans accès réseau et sans mise en cache préalable, le graphe ES peut ne pas s'évaluer du tout ; le bootstrap JS ne peut alors pas fournir son mode offline. |
| `window.SyncManager` absent | Faible aujourd'hui | Contrôle explicite dans `app.js`; conduirait à `[OfflineBootstrap] Échec...` et à `AppOfflineStatus.status = 'error'`. |
| IndexedDB indisponible/bloquée | Moyen | `OfflineSync.init()` ou `OfflineIdMapper.init()` rejette avec une erreur explicite. L'application continue ensuite son bootstrap, mais la capacité offline reste non initialisée. |
| Double initialisation | Faible aujourd'hui | Un seul appel à `SyncManager.init()` a été trouvé. `SyncManager.init()` ne possède néanmoins pas de promesse/garde d'initialisation propre pour un futur second appel. |
| File en attente non vidée au démarrage si le navigateur est déjà en ligne | Important | `SyncManager.init()` démarre l'écoute réseau, mais n'appelle pas `sync()`. Une file existante n'est traitée qu'au prochain événement `online` ou via un appel explicite à `SyncManager.sync()`, absent de `app.js`. |
| Dépendance au mapper pour des parents déjà distants | Important avant `createDetail()` | `createItem()` et `createDetail()` appellent systématiquement `resolveFirestoreId()` sur les identifiants parents. Un `siteId`/`itemId` déjà Firestore mais absent du store `idMappings` est rejeté au lieu d'être accepté comme identifiant distant. |
| Accès Firestore direct depuis l'adaptateur métier | Important pour l'architecture | Les créations utilisent directement `addDoc()`. Cela rompt le flux strict imposé et duplique la responsabilité d'accès Firestore. |
| Statut global momentanément ambigu au retour réseau | Faible | `app.js` force `idle` sur `online` avant que les événements de synchronisation ne publient l'état réel. |
| Application marquée prête malgré un échec du bootstrap principal | Moyen | `bootstrap().finally(() => UiService.markAppReady())` marque l'interface prête même si une erreur non absorbée survient plus tard dans le bootstrap. Pour l'offline seul, l'erreur est absorbée volontairement afin de permettre un mode dégradé. |
| `OfflineActionBuilder` absent | Faible aujourd'hui | Il n'est pas requis par `SyncManager`, car il construit les futures actions côté écriture. Son absence deviendra bloquante au moment d'intégrer `createDetail()` offline. |

### Autres observations

- `OfflineSync.syncPendingActions()` émet encore `offlineSyncRequested`, mais aucun écouteur n'a été trouvé et `SyncManager` n'utilise pas cette méthode. Il s'agit d'un ancien hook parallèle, actuellement inactif.
- `OfflineAdapter.syncActions()` existe encore, mais n'est plus appelé par `SyncManager`. Il ne constitue donc pas un chemin actif de synchronisation.
- Les actions réussies ne sont retirées de la file qu'après le rapport de l'adaptateur métier, ce qui est conforme au principe de confirmation avant suppression.

---

# 7. Test théorique de démarrage

## Scénario nominal

```text
Ouverture de l'application
  -> résolution et évaluation des modules ES
  -> firebase-core initialise/récupère l'application Firebase
  -> firebaseDb devient disponible à app.js
  -> app.js crée window.AppOfflineStatus et ses écouteurs
  -> bootstrap() appelle initOfflineBootstrap()
  -> SyncManager.init({ firebaseDb })
  -> OfflineSync.init() ouvre suiviMaterielOffline
  -> OfflineAdapter.init(firebaseDb)
  -> MaterialOfflineAdapter.init()
  -> OfflineIdMapper.init() ouvre suiviMaterielOfflineIdMapper
  -> SyncManager publie idle ou offline et écoute le réseau
  -> StorageService.init(), authentification et initialisation de la page
  -> UiService.markAppReady()
```

## Validité

Le scénario est **valide pour l'initialisation nominale** : Firebase est disponible avant l'injection, les deux bases IndexedDB sont attendues, `SyncManager` devient actif avant l'initialisation fonctionnelle de la page, et l'application n'est marquée prête qu'à la fin du `bootstrap()`.

Deux réserves empêchent de qualifier le démarrage de synchronisation comme totalement complet :

1. si une file existe déjà et que le navigateur démarre en ligne, aucune synchronisation immédiate n'est lancée ;
2. le mode offline dépend encore du chargement initial des modules Firebase distants. Un véritable démarrage à froid sans réseau nécessite que ces ressources soient déjà disponibles via le cache/service worker.

En cas d'échec IndexedDB, le bootstrap offline passe à `error`, puis le bootstrap général continue. C'est cohérent avec une stratégie de dégradation, mais « application prête » ne signifie alors pas « système offline prêt » ; il faut consulter `window.AppOfflineStatus.initialized`.

---

# 8. Conclusion

## Points validés ✅

- Les 9 pages qui chargent l'application contiennent les 8 scripts offline/app attendus, dans le bon ordre.
- Firebase est centralisé dans `firebase-core.js` et protégé contre une seconde initialisation de l'application Firebase.
- `firebaseDb` est importé et disponible avant l'appel au bootstrap offline.
- `SyncManager.init({ firebaseDb })` n'est appelé qu'une seule fois dans le code actuel.
- `OfflineSync.init()` et `OfflineIdMapper.init()` sont tous deux attendus avant la réussite du bootstrap offline.
- Les bases et stores IndexedDB nécessaires sont déclarés.
- `SyncManager` délègue le traitement de la file à `MaterialOfflineAdapter`, sans appel direct à `OfflineAdapter.processAction()` ou `OfflineAdapter.syncActions()`.
- Les événements réseau et de synchronisation ont des émetteurs et écouteurs identifiables.
- `window.AppOfflineStatus` expose l'état minimal du bootstrap offline.
- Une action n'est supprimée de la file qu'après un résultat de synchronisation réussi.

## Points à corriger ⚠️

1. **Faire passer les créations par `OfflineAdapter`.** Étendre le résultat de `OfflineAdapter.processAction('add')` afin qu'il renvoie le nouvel identifiant Firestore, puis supprimer l'appel direct à `addDoc()` dans `MaterialOfflineAdapter`.
2. **Déclencher une synchronisation initiale lorsque l'application démarre déjà en ligne**, après l'initialisation complète des adaptateurs, afin de ne pas laisser dormir une file provenant d'une session précédente.
3. **Définir une stratégie pour les identifiants parents déjà Firestore.** `resolveFirestoreId()` devrait distinguer un identifiant local nécessitant un mapping d'un identifiant distant déjà valide, ou les entités distantes devraient être pré-enregistrées dans le mapper.
4. **Rendre `SyncManager.init()` explicitement idempotent** avec une promesse d'initialisation, même si le code actuel ne l'appelle qu'une fois.
5. **Séparer l'état réseau de l'état de synchronisation** dans `window.AppOfflineStatus` pour éviter la transition trompeuse vers `idle` au retour en ligne.
6. **Prévoir le démarrage réellement hors ligne des imports Firebase** dans la stratégie du service worker/cache, puis le vérifier dans un navigateur après un premier chargement connecté.
7. **Clarifier ou retirer le hook inactif `offlineSyncRequested`** afin qu'il ne suggère pas un second pipeline de synchronisation.

## Prêt ou non pour intégrer `createDetail()` offline

**Verdict : pas encore prêt pour l'intégration de `createDetail()` offline.**

Le bootstrap, l'ordre des scripts, la file IndexedDB, le mapper et la délégation principale de `SyncManager` sont correctement en place. Cependant, deux blocages fonctionnels/architecturaux doivent être résolus avant de brancher `createDetail()` :

- la création contourne encore `OfflineAdapter` pour appeler directement Firestore ;
- la résolution systématique de `siteId` et `itemId` via le mapper échouera pour des parents existants dont les identifiants Firestore ne disposent pas d'un mapping local.

Le déclenchement de la synchronisation au démarrage doit également être ajouté ou explicitement assumé avant de considérer le cycle offline complet. `createDetail()` et `storage.js` restent volontairement inchangés dans le cadre de cet audit.
