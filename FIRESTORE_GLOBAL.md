# Documentation globale Firestore

## Portée de l'analyse

Ce document décrit uniquement les accès Firestore observés dans le repository. Aucun comportement applicatif n'est déduit hors du code présent. Les pages HTML chargent principalement `js/storage.js`, `js/app.js`, `js/firebase-core.js` et parfois des modules spécialisés (`js/maintenance-banner.js`, `js/materiels.js`, scripts inline dans `users.html`).

## 1. Architecture Firestore

### Initialisation Firebase / Firestore

- Firebase est initialisé dans `js/firebase-core.js`.
- Le fichier importe `initializeApp`, `getApp`, `getApps`, `getAnalytics`, `getAuth` et `getFirestore` depuis le CDN Firebase `10.12.5`.
- La configuration est déclarée dans la constante `FIREBASE_CONFIG` avec le projet `base-737bf`.
- L'application est initialisée par `getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG)`.
- Les instances exportées sont :
  - `firebaseApp` ;
  - `firebaseAuth` ;
  - `firebaseDb` ;
  - `firebaseAnalyticsPromise`.

### Services / helpers Firestore

#### `js/storage.js`

`js/storage.js` est le service principal de persistance. Il importe les méthodes Firestore suivantes :

- `addDoc`
- `collection`
- `deleteDoc`
- `deleteField`
- `doc`
- `getDoc`
- `getDocs`
- `onSnapshot`
- `orderBy`
- `query`
- `serverTimestamp`
- `setDoc`
- `Timestamp`
- `updateDoc`

Il expose ensuite `window.StorageService`, utilisé par `js/app.js` et les pages qui chargent `js/storage.js`.

Le service maintient un état mémoire global :

| Variable | Rôle |
|---|---|
| `state.db` | Instance Firestore (`firebaseDb`). |
| `state.userId` | UID Firebase Auth courant. |
| `state.authUser` | Informations minimales de l'utilisateur authentifié. |
| `state.sites` | Données `pages/page1/items`. |
| `state.itemsBySite` | Données `pages/page2/items`, regroupées par `siteId`. |
| `state.detailsByItem` | Données `pages/page3/items`, regroupées par clé `${siteId}:${itemId}`. |
| `state.listeners` | Listeners locaux JavaScript, non Firestore, alimentés par l'état mémoire. |

#### `js/app.js`

`js/app.js` consomme `window.StorageService` et importe aussi directement Firestore pour certains flux achats matériels :

- `addDoc`, `collection`, `deleteDoc`, `doc`, `getDoc`, `getDocs`, `orderBy`, `query`, `serverTimestamp`, `updateDoc`.

#### `js/maintenance-banner.js`

Ce module gère les modales globales de maintenance et de messages administrateur. Il importe :

- `arrayUnion`, `collection`, `doc`, `limit`, `onSnapshot`, `orderBy`, `query`, `setDoc`.

#### `js/materiels.js`

Ce module gère la page de demande de matériels. Il importe :

- `addDoc`, `collection`, `getDocs`, `serverTimestamp`.

#### Script inline de `users.html`

La page utilisateurs contient aussi un script module inline qui importe :

- `addDoc`, `collection`, `onSnapshot`, `doc`, `setDoc`, `serverTimestamp`.

### Construction des références Firestore

Dans `js/storage.js`, les helpers principaux sont :

| Helper | Référence construite |
|---|---|
| `usersCollection()` | `collection(state.db, 'users')` |
| `userDocRef(userId = state.userId)` | `doc(state.db, 'users', userId)` |
| `maintenanceDocRef()` | `doc(state.db, 'appSettings', 'maintenance')` |
| `trashSettingsDocRef()` | `doc(state.db, 'appSettings', 'trash')` |
| `trashCollection()` | `collection(state.db, 'trash')` |
| `makePageItemsCollection(pageName)` | `collection(state.db, 'pages', pageName, 'items')` |
| `outDeletionLimitDocRef(userId, dateKey)` | `doc(state.db, 'users', userId, 'outDeletionLimits', dateKey)` |
| `historyCollection()` | `collection(state.db, 'historiques')` |

Dans les autres fichiers :

| Fichier | Référence |
|---|---|
| `js/app.js` | `collection(firebaseDb, 'sites', siteId, 'achatsMateriels')`, `doc(firebaseDb, 'sites', siteId, 'achatsMateriels', purchaseId)` |
| `js/maintenance-banner.js` | `doc(firebaseDb, 'appSettings', 'maintenance')`, `query(collection(firebaseDb, 'adminMessages'), orderBy('createdAt', 'desc'), limit(RECENT_USER_MESSAGES_LIMIT))`, `doc(firebaseDb, 'users', user.uid)` |
| `js/materiels.js` | `collection(firebaseDb, 'materialRequests')`, `collection(firebaseDb, 'pages', 'page3', 'items')` |
| `users.html` | `collection(firebaseDb, 'users')`, `collection(firebaseDb, 'pages', 'page2', 'items')`, `collection(firebaseDb, 'adminMessages')`, `doc(firebaseDb, 'users', userId)` |

## 2. Récupération des données

### `getDoc()`

| Fichier | Fonction / page | Document lu | Transformation / utilisation |
|---|---|---|---|
| `js/storage.js` | `ensureCurrentUser()` | `users/{state.userId}` | Si absent, crée le profil ; si présent, normalise email, username, rôle, maintenance, avatar, dates. Utilisé par l'initialisation/profil utilisateur. |
| `js/storage.js` | `getCurrentUserProfile()` | `users/{state.userId}` | Retourne un profil normalisé ou appelle `ensureCurrentUser()` si le document n'existe pas. |
| `js/storage.js` | `deleteUser()` | `users/{targetId}` | Lit le document avant suppression pour éventuellement l'ajouter à `trash`. |
| `js/storage.js` | `hasReachedOutDeletionLimit()` | `users/{userId}/outDeletionLimits/{dateKey}` | Lit `count` et compare à la limite par défaut `2`. |
| `js/storage.js` | `recordOutDeletionLimitUsage()` | `users/{userId}/outDeletionLimits/{dateKey}` | Lit `count`, puis écrit `count + 1`. |
| `js/storage.js` | `isTrashEnabled()` | `appSettings/trash` | Lit `enabled` pour décider si les suppressions doivent être archivées. |
| `js/storage.js` | `restoreTrashEntry()` | `trash/{entryId}` | Lit l'entrée à restaurer, puis restaure selon `type`. |
| `js/app.js` | `initPurchaseDetailPage()` | `sites/{siteId}/achatsMateriels/{purchaseId}` | Transforme en `{ id, ...data }`, affiche le détail achat ou redirige si absent. |

### `getDocs()`

| Fichier | Fonction / page | Collection / requête | Transformation / utilisation |
|---|---|---|---|
| `js/storage.js` | `isUsernameDuplicate()` | `users` | Parcourt tous les utilisateurs, compare les usernames normalisés. |
| `js/storage.js` | `listUsers()` | `users` | Mappe les documents en profils normalisés affichés dans utilisateurs/historiques. |
| `js/storage.js` | `cleanupInactiveUsers()` | `users` | Supprime les utilisateurs inactifs hors admin/utilisateur courant. |
| `js/storage.js` | `listOutCreationPoints()` | `pages/page2/items` | Réduit les OUT par `createdBy` ou `ownerId`. |
| `js/storage.js` | `readPageItems(pageName)` | `pages/{pageName}/items` | Retourne `{ id, ...data }`. Appelé pour page1, page2, page3 par `loadRemoteSnapshot()`. |
| `js/storage.js` | `loadRemoteSnapshot()` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | Charge les trois collections en parallèle, puis `applySnapshot()` les classe dans l'état global. |
| `js/storage.js` | `purgeExpiredTrashEntries()` | `trash` | Liste les entrées et supprime celles expirées selon `expiresAtIso`. |
| `js/storage.js` | `pruneHistoryEntries()` | `query(historiques, orderBy('createdAt', 'desc'))` | Garde les 100 plus récents et supprime le reste. |
| `js/storage.js` | `listHistoriques()` | `query(historiques, orderBy('createdAt', 'desc'))` | Mappe les entrées via `normalizeHistoryDocument()`. |
| `js/app.js` | `loadPurchasesForCurrentSite()` dans page 2 | `query(sites/{siteId}/achatsMateriels, orderBy('createdAt', 'desc'))` | Mappe en `{ id, ...data }`, stocke dans `currentPurchases`, puis `renderPurchases()`. |
| `js/materiels.js` | `loadAllMaterials()` | `pages/page3/items` | Normalise les lignes, déduplique par `code`, trie par `designation`, stocke dans `allMaterials` et affiche la liste filtrable. |

### `onSnapshot()`

Voir aussi la section dédiée. Synthèse des lectures temps réel :

| Fichier | Fonction / page | Cible surveillée | Transformation / utilisation |
|---|---|---|---|
| `js/storage.js` | `subscribeOutCreationPoints()` | `pages/page2/items` | Réduit en points par utilisateur, affiché dans la page utilisateurs. |
| `js/storage.js` | `subscribeCurrentUserProfile()` | `users/{state.userId}` | Normalise profil utilisateur et met à jour l'interface abonnée. |
| `js/storage.js` | `subscribeUsers()` | `users` | Mappe les utilisateurs normalisés. |
| `js/storage.js` | `subscribeMaintenanceState()` | `appSettings/maintenance` | Convertit en `{ enabled }`. |
| `js/storage.js` | `subscribeTrashSettings()` | `appSettings/trash` | Retourne `{ enabled }`. |
| `js/storage.js` | `subscribeTrashEntries()` | `query(trash, orderBy('deletedAtIso', 'desc'))` | Mappe les entrées `trash` en `{ id, ...data }`. |
| `js/storage.js` | `subscribeHistoriques()` | `query(historiques, orderBy('createdAt', 'desc'))` | Mappe via `normalizeHistoryDocument()`. |
| `js/maintenance-banner.js` | `initGlobalMaintenanceModal()` | `appSettings/maintenance` | Met à jour `maintenanceEnabled` et rend la modale. |
| `js/maintenance-banner.js` | `initGlobalMaintenanceModal()` | `query(adminMessages, orderBy('createdAt', 'desc'), limit(RECENT_USER_MESSAGES_LIMIT))` | Sélectionne un message utilisateur en attente. |
| `js/maintenance-banner.js` | `subscribeToCurrentUserRole()` | `users/{user.uid}` | Met à jour rôle/profil courant pour maintenance et messages. |
| `users.html` | Script inline utilisateurs | `users` | Mappe documents bruts, applique `syncDefaults()`, rend la liste et les destinataires. |
| `users.html` | Script inline utilisateurs | `pages/page2/items` | Calcule les points par créateur d'OUT. |

### `query()`, `orderBy()`, `limit()`, `where()`

- `query()` est observé avec `orderBy()` dans les flux `historiques`, `trash`, `adminMessages` et `achatsMateriels`.
- `limit()` est observé dans `js/maintenance-banner.js` pour limiter les messages administrateur récents.
- `where()` n'est pas utilisé dans le code analysé.

| Fichier | Requête | Filtres / tris |
|---|---|---|
| `js/storage.js` | `query(historyCollection(), orderBy('createdAt', 'desc'))` | Tri décroissant par `createdAt`. |
| `js/storage.js` | `query(trashCollection(), orderBy('deletedAtIso', 'desc'))` | Tri décroissant par `deletedAtIso`. |
| `js/app.js` | `query(collection(firebaseDb, 'sites', siteId, 'achatsMateriels'), orderBy('createdAt', 'desc'))` | Tri décroissant par `createdAt`. |
| `js/maintenance-banner.js` | `query(collection(firebaseDb, 'adminMessages'), orderBy('createdAt', 'desc'), limit(RECENT_USER_MESSAGES_LIMIT))` | Tri décroissant par `createdAt`, limite récente. |

### Autres méthodes Firestore utilisées

Même si ce document cible la lecture, les écritures conditionnent l'origine des données lues :

| Méthode | Usages observés |
|---|---|
| `addDoc()` | Création de sites (`pages/page1/items`), OUT (`pages/page2/items`), détails/articles (`pages/page3/items`), historiques (`historiques`), corbeille (`trash`), achats matériels, demandes matériels (`materialRequests`), messages admin (`adminMessages`). |
| `setDoc()` | Création/mise à jour profils utilisateurs, maintenance, corbeille, verrous site, compteurs suppression OUT, acquittements messages. |
| `updateDoc()` | Mise à jour détails/articles page 3 et achats matériels. |
| `deleteDoc()` | Suppression sites, OUT, détails, utilisateurs, achats matériels, entrées corbeille, historiques excédentaires. |
| `deleteField()` | Suppression logique de champs (`status`, `approved`, `pending`, verrouillage, inactivité). |
| `serverTimestamp()` | Horodatage utilisateurs, historiques, réglages, messages, demandes. |
| `Timestamp.fromDate()` | Stockage de `lastNameChange`. |
| `arrayUnion()` | Ajout d'un message lu dans `users/{uid}.readMessages`. |

## 3. Listeners temps réel `onSnapshot()`

### Listeners Firestore directs

| Fichier | Listener | Cleanup observé | Observation |
|---|---|---|---|
| `js/storage.js` | Les fonctions `subscribe*` retournent l'unsubscribe Firestore ou `() => {}`. | Oui, retourné à l'appelant. | Le nettoyage dépend du code appelant. |
| `js/maintenance-banner.js` | `unsubscribeMaintenance`, `unsubscribeUserMessages`, `unsubscribeAuth`. | Oui sur `window.beforeunload`; `unsubscribeUserProfile` est nettoyé par `clearUserProfileSubscription()`. | Les listeners globaux vivent pendant la page. |
| `users.html` | Deux `onSnapshot()` inline sur `users` et `pages/page2/items`. | Aucun unsubscribe stocké observé. | Les listeners durent jusqu'au déchargement de la page ; pas de cleanup explicite. |
| `js/app.js` via `StorageService.subscribeSites/Items/Details/...` | Listeners locaux en mémoire, pas Firestore direct. | Les fonctions retournent un unsubscribe local, mais les appels de pages ne le stockent pas dans les extraits observés. | Comme `StorageService` n'ouvre pas de listener Firestore pour page1/page2/page3, le risque est surtout accumulation de callbacks locaux si une init est rappelée plusieurs fois dans la même page. |

### Données déclenchant les mises à jour

- Modification de `users` : met à jour listes utilisateurs, rôles, profils, destinataires de messages.
- Modification de `pages/page2/items` : met à jour les points de création OUT par utilisateur.
- Modification de `appSettings/maintenance` : affiche/masque l'état maintenance.
- Modification de `adminMessages` : réévalue le message utilisateur à afficher.
- Modification de `trash` : met à jour la corbeille.
- Modification de `historiques` : met à jour la page historique.

### Point important sur `pages/page1/items`, `pages/page2/items`, `pages/page3/items`

Le chargement global des pages 1, 2 et 3 dans `js/storage.js` est fait par `getDocs()` dans `loadRemoteSnapshot()`. Les abonnements `subscribeSites()`, `subscribeItems()`, `subscribeDetails()` et variantes sont des listeners JavaScript internes sur `state`, pas des `onSnapshot()` Firestore. Ils réagissent aux changements locaux appliqués par les fonctions du service (`createSite`, `createItem`, `createDetail`, etc.) et aux données chargées initialement, mais ne surveillent pas directement Firestore en temps réel pour ces trois collections.

## 4. Cartographie des pages

| Page | Fichier source | Données Firestore utilisées | Collections/documents | Lecture | Rôle dans la page |
|---|---|---|---|---|---|
| Accueil / page sites | `index.html` + `js/app.js` + `js/storage.js` | Sites et compteurs OUT. | `pages/page1/items`, `pages/page2/items`, indirectement `pages/page3/items`. | Chargement initial `getDocs()` via `StorageService.init()`, puis abonnements locaux `subscribeSites()` / `subscribeItemCounts()`. | Affiche les sites, compte les OUT par site, gère inactivité. |
| Page 2 / détail site | `page2.html` + `js/app.js` + `js/storage.js` | Site courant, OUT du site, compteurs/désignations/lignes article, achats matériels. | `pages/page1/items`, `pages/page2/items`, `pages/page3/items`, `sites/{siteId}/achatsMateriels`. | `getDocs()` global via storage ; abonnements locaux ; `getDocs(query(...orderBy))` pour achats. | Liste les OUT, filtre/classe, affiche achats matériels. |
| Page 3 / détail OUT | `page3.html` + `js/app.js` + `js/storage.js` | Site, OUT, détails/articles de l'OUT. | `pages/page1/items`, `pages/page2/items`, `pages/page3/items`. | `getDocs()` global via storage ; abonnements locaux `subscribeSites()`, `subscribeItems()`, `subscribeDetails()`. | Affiche et édite les lignes articles d'un OUT. |
| Utilisateurs | `users.html`, `js/app.js`, `js/storage.js` | Utilisateurs, points OUT, messages admin. | `users`, `pages/page2/items`, `adminMessages`. | `getDocs()` initial via `StorageService.listUsers/listOutCreationPoints`, `onSnapshot()` via storage ou inline selon flux. | Liste utilisateurs, rôles, points, destinataires messages. |
| Historiques | `historiques.html` + `js/app.js` + `js/storage.js` | Historique et utilisateurs. | `historiques`, `users`. | `getDocs(query(orderBy))`, puis `onSnapshot(query(orderBy))` pour historiques ; `getDocs(users)`. | Affiche les actions historisées avec infos utilisateur. |
| Paramètres | `parametres.html` + `js/app.js` + `js/storage.js` | Profil utilisateur, maintenance, corbeille selon fonctions appelées. | `users/{uid}`, `appSettings/maintenance`, `appSettings/trash`. | `getDoc()` et `onSnapshot()` via StorageService. | Profil, rôle, maintenance/corbeille. |
| Corbeille | `corbeille.html` + `js/app.js` + `js/storage.js` | Réglage corbeille, entrées supprimées. | `appSettings/trash`, `trash`. | `getDoc()`, `onSnapshot(doc)`, `onSnapshot(query(orderBy))`. | Affiche/restaure/purge les éléments supprimés. |
| Demande matériels | `materiels.html` + `js/materiels.js` | Catalogue déduit des articles page 3, demandes matériels. | `pages/page3/items`, `materialRequests`. | `getDocs(collection(page3))` pour lire ; `addDoc()` pour demandes. | Recherche matériaux par code/désignation et envoie un panier. |
| Détail achat matériel | `purchase-detail.html` + `js/app.js` | Achat matériel d'un site. | `sites/{siteId}/achatsMateriels/{purchaseId}`. | `getDoc()`. | Affiche un achat matériel précis. |
| Bannière maintenance/messages | Pages chargeant `js/maintenance-banner.js` | Maintenance, messages admin, profil courant. | `appSettings/maintenance`, `adminMessages`, `users/{uid}`. | `onSnapshot()`. | Bloque/affiche modale maintenance, affiche messages utilisateur. |

## 5. Page 3

### Données récupérées

La page 3 correspond au détail d'un OUT. Elle utilise :

- le site courant depuis `pages/page1/items` ;
- l'OUT courant depuis `pages/page2/items` ;
- les articles/détails depuis `pages/page3/items`.

### Origine et chargement

Le chargement distant initial est global, pas limité au seul site ou au seul OUT :

```text
StorageService.init()
  -> loadRemoteSnapshot()
    -> readPageItems('page1') -> getDocs(pages/page1/items)
    -> readPageItems('page2') -> getDocs(pages/page2/items)
    -> readPageItems('page3') -> getDocs(pages/page3/items)
  -> applySnapshot()
```

`applySnapshot()` classe ensuite :

- `page1` dans `state.sites` ;
- `page2` dans `state.itemsBySite`, regroupé par `siteId` ;
- `page3` dans `state.detailsByItem`, regroupé par clé `${siteId}:${itemId}`.

### Récupération des OUT / articles

Dans `initItemDetailPage()` de `js/app.js` :

- `StorageService.subscribeSites()` cherche le site par `siteId` dans l'état local.
- `StorageService.subscribeItems(siteId)` cherche l'OUT courant par `itemId` dans les OUT du site.
- `StorageService.subscribeDetails(siteId, itemId)` récupère les détails depuis `state.detailsByItem.get(`${siteId}:${itemId}`)`.

Il n'y a pas de `query(where('siteId', ...), where('itemId', ...))` Firestore observée pour la page 3. La limitation au couple `siteId` / `itemId` est faite en mémoire après un chargement global de `pages/page3/items`.

### Filtrage / classification

- Les détails page 3 sont classés en mémoire par clé `${siteId}:${itemId}`.
- `sortState()` trie les détails par `Number(detail.champ) - Number(b.champ)`.
- Les statuts sont normalisés par des fonctions comme `sanitizeDetailStatut()` et, côté affichage, `js/app.js` importe `computeEcart`, `isDetailCompleted`, `normalizeQuantity`, `quantitiesAreEqual` depuis `js/detail-status.js`.
- La page conserve les détails affichés dans la variable locale `currentDetails`, puis appelle `renderTable()`.

### Affichage

Flux page 3 principal :

```text
Firestore
  ↓
pages/page1/items + pages/page2/items + pages/page3/items
  ↓
getDocs() dans StorageService.loadRemoteSnapshot()
  ↓
applySnapshot() : state.sites, state.itemsBySite, state.detailsByItem
  ↓
subscribeSites() / subscribeItems() / subscribeDetails()
  ↓
currentSite / currentItem / currentDetails dans js/app.js
  ↓
renderTitle(), renderStoreLabel(), renderTable()
```

### Portée de la récupération

La récupération initiale est globale pour les trois collections `pages/page1/items`, `pages/page2/items` et `pages/page3/items`. La page 3 n'effectue pas une lecture Firestore limitée directement à `siteId` ou `itemId` pour les articles ; elle filtre en mémoire via `state.detailsByItem`.

## 6. Flux des données principaux

### Sites / OUT / articles globaux

```text
Firestore
  ↓
pages/page1/items, pages/page2/items, pages/page3/items
  ↓
getDocs() via readPageItems() / loadRemoteSnapshot()
  ↓
normalizeDocData() puis applySnapshot()
  ↓
state.sites, state.itemsBySite, state.detailsByItem
  ↓
subscribeSites(), subscribeItems(), subscribeDetails(), subscribeDetailCounts(), subscribeDetailRows()
  ↓
variables locales de page dans js/app.js
  ↓
rendu DOM
```

### Utilisateurs

```text
Firestore
  ↓
users ou users/{uid}
  ↓
getDocs(), getDoc() ou onSnapshot()
  ↓
normalisation username/email/rôle/avatar/maintenance
  ↓
currentUsers ou profil courant
  ↓
rendu utilisateurs, permissions, maintenance, historiques
```

### Historiques

```text
Firestore
  ↓
historiques
  ↓
query(orderBy('createdAt', 'desc')) + getDocs()/onSnapshot()
  ↓
normalizeHistoryDocument()
  ↓
renderHistoriques()
  ↓
liste d'historique
```

### Achats matériels

```text
Firestore
  ↓
sites/{siteId}/achatsMateriels
  ↓
query(orderBy('createdAt', 'desc')) + getDocs()
  ↓
{ id, ...data }
  ↓
currentPurchases
  ↓
renderPurchases()
```

### Messages administrateur / maintenance

```text
Firestore
  ↓
appSettings/maintenance, adminMessages, users/{uid}
  ↓
onSnapshot() + query(orderBy, limit) pour adminMessages
  ↓
maintenanceEnabled, receivedUserMessages, currentUserProfile
  ↓
renderMaintenanceModal(), renderUserMessageModal()
```

## 7. Cache / variables / états

### Cache Firestore local applicatif

`js/storage.js` persiste un cache dans `localStorage` :

- clé : `suiviMateriel.offlineCache.v1` ;
- TTL : `180 * 1000` ms ;
- contenu : `{ savedAt, pages: { page1, page2, page3 } }`.

Au démarrage :

1. `parseOfflineState()` lit ce cache.
2. Si un snapshot existe, `applySnapshot()` hydrate l'état mémoire immédiatement.
3. Si le cache n'est pas frais, `loadRemoteSnapshot()` recharge Firestore.
4. Après chargement distant, `persistOfflineState()` met à jour le cache.

### États mémoire Firestore

| État | Source Firestore | Portée |
|---|---|---|
| `state.sites` | `pages/page1/items` | Globale dans `StorageService`. |
| `state.itemsBySite` | `pages/page2/items` | Globale dans `StorageService`, regroupée par site. |
| `state.detailsByItem` | `pages/page3/items` | Globale dans `StorageService`, regroupée par site + OUT. |
| `currentSites`, `currentSite`, `currentItems`, `currentDetails` | États issus de `StorageService` | Locaux à `js/app.js` selon page. |
| `currentUsers`, `currentPointsByUser` | `users`, `pages/page2/items` | Pages utilisateurs. |
| `currentPurchases` | `sites/{siteId}/achatsMateriels` | Page 2, onglet achats. |
| `allMaterials` | `pages/page3/items` | Page `materiels.html`. |

### Autres `localStorage` / `sessionStorage` observés

Ces données ne sont pas Firestore, mais influencent l'interface ou les formulaires :

- `suiviMateriel.authUser.v1` dans `js/login.js`.
- Mémo email/mot de passe dans `js/login.js`.
- `sessionStorage` pour l'accueil Google (`GOOGLE_WELCOME_KEY`).
- Filtres, recherche, scroll, onglets et historiques de nom d'export dans `js/app.js`.
- Brouillons de message admin dans `users.html`.
- Panier, aide et dernier titre dans `js/materiels.js`.

## 8. Synchronisation

### Chargement une seule fois

- `pages/page1/items`, `pages/page2/items`, `pages/page3/items` sont chargés par `getDocs()` lors de `StorageService.init()`, sauf cache frais.
- `sites/{siteId}/achatsMateriels` est chargé par `getDocs()` quand `loadPurchasesForCurrentSite()` est appelé.
- `pages/page3/items` est chargé par `getDocs()` dans `js/materiels.js` au chargement de la page matériels.
- `sites/{siteId}/achatsMateriels/{purchaseId}` est chargé par `getDoc()` dans la page détail achat.

### Temps réel

Sont réellement temps réel via `onSnapshot()` :

- `users` ;
- `users/{uid}` ;
- `pages/page2/items` pour les points utilisateurs ;
- `appSettings/maintenance` ;
- `appSettings/trash` ;
- `trash` ;
- `historiques` ;
- `adminMessages`.

### Nouveaux fetchs / mises à jour automatiques

- Un cache offline absent ou expiré provoque un nouveau `getDocs()` global dans `StorageService.init()`.
- Les fonctions de création/mise à jour/suppression de `StorageService` écrivent dans Firestore, modifient l'état mémoire, persistent le cache, puis appellent `emitAll()` pour rafraîchir l'interface locale.
- Les listeners `onSnapshot()` déclenchent automatiquement leurs callbacks quand Firestore envoie un snapshot.
- Les achats matériels sont rechargés explicitement après certaines actions via `loadPurchasesForCurrentSite()`.

## 9. Sécurité et règles

Règles Firestore non trouvées dans le repository analysé.

Aucun fichier `firestore.rules`, `firebase.json` ou fichier de règles équivalent n'a été trouvé lors de l'analyse du repository.

## 10. Problèmes / points d'attention observés

- **Récupération globale des pages 1/2/3** : `StorageService.init()` charge intégralement `pages/page1/items`, `pages/page2/items` et `pages/page3/items`, puis filtre en mémoire. La page 3 récupère donc globalement tous les articles avant de sélectionner ceux du couple `siteId:itemId`.
- **Pas de temps réel Firestore direct pour page1/page2/page3 dans `StorageService`** : les méthodes `subscribeSites()`, `subscribeItems()` et `subscribeDetails()` sont des abonnements locaux sur `state`, pas des `onSnapshot()` Firestore. Les changements faits par un autre client ne sont pas reçus automatiquement par ces flux, sauf rechargement ou autre mécanisme non observé.
- **Listeners inline sans cleanup explicite dans `users.html`** : deux `onSnapshot()` sont créés sur `users` et `pages/page2/items` sans variable d'unsubscribe observée.
- **Abonnements locaux non stockés dans plusieurs initialisations de page** : plusieurs appels `StorageService.subscribe...` dans `js/app.js` ne stockent pas l'unsubscribe retourné. Si une fonction d'initialisation était réexécutée sans recharger la page, des callbacks locaux pourraient s'accumuler.
- **Lecture complète de `users` pour vérifier un doublon de username** : `isUsernameDuplicate()` fait `getDocs(usersCollection())` et compare côté client.
- **Lecture complète de `pages/page3/items` dans `materiels.html`** : `loadAllMaterials()` lit tous les articles pour construire un catalogue unique par code.
- **Logique utilisateurs dupliquée** : les flux utilisateurs existent à la fois dans `StorageService` / `js/app.js` et dans le script inline de `users.html`, avec des listeners directs similaires sur `users` et `pages/page2/items`.
- **Historique trié sans limite côté lecture principale** : `listHistoriques()` et `subscribeHistoriques()` lisent la requête triée complète ; seule la fonction `pruneHistoryEntries()` supprime au-delà de 100 après certaines écritures d'historique.

## 11. Résumé global

L'application centralise la majorité des accès Firestore dans `js/storage.js`. Ce service initialise son propre état avec `firebaseDb`, charge les collections fonctionnelles `pages/page1/items`, `pages/page2/items` et `pages/page3/items`, puis expose des méthodes de lecture locales et d'abonnement local via `window.StorageService`.

La stratégie principale pour les sites, OUT et articles est un chargement global par `getDocs()` suivi d'une classification en mémoire. Les pages affichent ensuite des sous-ensembles via `siteId` et `itemId`. Cette stratégie est particulièrement visible sur la page 3 : les articles viennent de `pages/page3/items`, mais la requête Firestore n'est pas limitée à l'OUT courant ; la limitation est faite après chargement dans `state.detailsByItem`.

Les flux réellement temps réel concernent surtout les utilisateurs, les réglages globaux, la maintenance, les messages administrateur, la corbeille et les historiques. Les abonnements de `StorageService` pour sites/OUT/articles ne sont pas des listeners Firestore ; ils émettent les données déjà présentes en mémoire et les mises à jour provoquées localement par les fonctions du service.

Certaines pages utilisent Firestore directement hors `StorageService` : `js/app.js` pour les achats matériels, `js/materiels.js` pour le catalogue de matériels déduit de la page 3, `js/maintenance-banner.js` pour les modales globales, et `users.html` pour des listeners utilisateurs inline. Les règles Firestore ne sont pas présentes dans le repository analysé.
