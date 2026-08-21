# Analyse du StorageService — avant optimisation Page 1 / Page 2

## Périmètre et méthode

Cette analyse est volontairement documentaire. Aucun code existant, aucune donnée Firestore, aucune règle, aucun index et aucune interface n'ont été modifiés.

Fichiers examinés :

- `js/storage.js` : définition de `StorageService`, état mémoire, cache, lectures/écritures Firestore, abonnements locaux et quelques listeners Firestore.
- `js/app.js` : orchestration de démarrage et usages Page 1 / Page 2 / Page 3.
- `index.html`, `page2.html`, `page3.html` : pages associées à Page 1, Page 2 et Page 3.
- `FIRESTORE_GLOBAL.md` et `FIRESTORE_AUDIT.md` : audits existants disponibles dans le projet.

---

## 1. StorageService trouvé

### Fichier principal

Le service est défini dans :

- `js/storage.js`

La définition publique est l'objet global :

```js
window.StorageService = { ... }
```

Il est consommé par `js/app.js` via :

```js
const { StorageService, UiService } = window;
```

### Imports Firestore dans `js/storage.js`

`js/storage.js` importe les méthodes Firestore suivantes :

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
- `where`
- `serverTimestamp`
- `setDoc`
- `Timestamp`
- `updateDoc`

### État interne principal

L'état interne contient notamment :

| Élément | Rôle |
|---|---|
| `state.sites` | Sites issus de `pages/page1/items`. |
| `state.itemsBySite` | OUT issus de `pages/page2/items`, regroupés par `siteId`. |
| `state.detailsByItem` | Articles/détails issus de `pages/page3/items`, regroupés par clé `${siteId}:${itemId}`. |
| `state.materialCodes` | Catalogue de codes matériels issu de `materialCodes`, ou bootstrap depuis `pages/page3/items` si vide. |
| `state.loadedDetailSites` | Sites dont les détails Page 3 ont déjà été chargés par requête ciblée. |
| `state.loadedDetailPairs` | Couples `siteId:itemId` déjà chargés par requête ciblée. |
| `state.listeners.*` | Abonnements locaux JavaScript, pas des listeners Firestore pour Page 1 / Page 2 / Page 3. |

### Fonctions d'initialisation et snapshot

| Fonction | Fichier | Rôle |
|---|---|---|
| `init()` | `js/storage.js` | Initialise `state`, lit le cache local, puis appelle `loadRemoteSnapshot()` si le cache est absent/expiré. |
| `loadRemoteSnapshot()` | `js/storage.js` | Lit globalement `page1`, `page2` et `materialCodes` en parallèle. Peut déclencher un bootstrap depuis `page3`. |
| `readPageItems(pageName)` | `js/storage.js` | Fait `getDocs(collection(state.db, 'pages', pageName, 'items'))`. |
| `applySnapshot(snapshot)` | `js/storage.js` | Classe `page1` dans `state.sites`, `page2` dans `state.itemsBySite`, `page3` dans `state.detailsByItem`, et `materialCodes` dans `state.materialCodes`. |
| `persistOfflineState()` | `js/storage.js` | Écrit le cache `suiviMateriel.offlineCache.v1`. |
| `parseOfflineState()` | `js/storage.js` | Lit et valide le cache local. |

### Fonctions de lecture Firestore dans `StorageService`

Lectures directes ou indirectes observées dans `js/storage.js` :

- `isUsernameDuplicate()` → `getDocs(usersCollection())`
- `ensureCurrentUser()` → `getDoc(userDocRef())`
- `getCurrentUserProfile()` → `getDoc(userDocRef())`
- `listUsers()` → `getDocs(usersCollection())`
- `cleanupInactiveUsers()` → `getDocs(usersCollection())`
- `listOutCreationPoints()` → `getDocs(pages/page2/items)`
- `deleteUser()` → `getDoc(users/{userId})`
- `hasReachedOutDeletionLimit()` → `getDoc(users/{userId}/outDeletionLimits/{date})`
- `recordOutDeletionLimitUsage()` → `getDoc(users/{userId}/outDeletionLimits/{date})`
- `readPageItems(pageName)` → `getDocs(pages/{pageName}/items)`
- `readMaterialCodes()` → `getDocs(materialCodes)`
- `bootstrapMaterialCodesFromDetails()` → `readPageItems('page3')`
- `loadRemoteSnapshot()` → `readPageItems('page1')`, `readPageItems('page2')`, `readMaterialCodes()`
- `getMaterialCodes()` → `readMaterialCodes()`, puis éventuellement `bootstrapMaterialCodesFromDetails()`
- `readDetailsByQuery(...constraints)` → `getDocs(query(pages/page3/items, ...constraints))`
- `ensureSiteDetailsLoaded(siteId)` → `where('siteId', '==', siteId)` sur `pages/page3/items`
- `ensurePairDetailsLoaded(siteId, itemId)` → `where('siteId', '==', siteId)` + `where('itemId', '==', itemId)` sur `pages/page3/items`
- `isTrashEnabled()` → `getDoc(appSettings/trash)`
- `purgeExpiredTrashEntries()` → `getDocs(trash)`
- `restoreTrashEntry(entryId)` → `getDoc(trash/{entryId})`
- `pruneHistoryEntries()` → `getDocs(query(historiques, orderBy('createdAt', 'desc')))`
- `listHistoriques()` → `getDocs(query(historiques, orderBy('createdAt', 'desc')))`

### Fonctions d'écriture Firestore dans `StorageService`

Écritures directes ou indirectes observées dans `js/storage.js` :

- Utilisateurs : `recordCurrentUserActivity()`, `ensureCurrentUser()`, `saveUsername()`, `changeUsername()`, `updateAvatarUrl()`, `updateUserRole()`, `updateUserMaintenanceAccess()`, `deleteUser()`, `cleanupInactiveUsers()`.
- Maintenance : `setMaintenanceState()`.
- Corbeille : `setTrashEnabled()`, `addTrashEntry()`, `purgeExpiredTrashEntries()`, `restoreTrashEntry()`.
- Sites Page 1 : `createSite()`, `updateSiteName()`, `updateSiteCreator()`, `setSiteLock()`, `clearSiteLock()`, `refreshSiteInactivityStates()`, `restoreInactiveSite()`, `removeSite()`, `restoreSite()`, `importData()`.
- OUT Page 2 : `createItem()`, `updateItemName()`, `removeItem()`, `restoreItem()`, `restoreSite()`, `importData()`.
- Détails Page 3 : `createDetail()`, `updateDetail()`, `removeDetail()`, `restoreDetail()`, `restoreItem()`, `restoreSite()`, `importData()`.
- Codes matériels : `ensureMaterialCode()`, `bootstrapMaterialCodesFromDetails()`.
- Historique : `appendHistoryEntry()`, `pruneHistoryEntries()`, `recordSearchHistory()`, `recordFilterHistory()`, `recordMaterialsPageOpenHistory()`, etc.
- Limite de suppression OUT : `recordOutDeletionLimitUsage()`.

### Fonctions `getAll...`

| Fonction | Rôle | Firestore direct ? |
|---|---|---|
| `getAllDetails()` | Retourne tous les détails actuellement en mémoire dans `state.detailsByItem`. | Non, lit l'état local. |
| `getMaterialCodes()` | Retourne `state.materialCodes`; si vide, relit `materialCodes`, puis peut bootstrap depuis `page3`. | Oui si cache mémoire vide. |

### Fonctions `readPageItems...`

| Fonction | Collection | Ciblage |
|---|---|---|
| `readPageItems(pageName)` | `pages/{pageName}/items` | Global pour la page demandée, sans `where`. |
| `readDetailsByQuery(...constraints)` | `pages/page3/items` | Ciblé selon contraintes, par exemple `siteId` ou `siteId + itemId`. |

Il n'existe pas de fonction `readPageItemsBySite()` pour `page2` dans le code actuel.

### Fonctions `subscribe...`

Il faut distinguer deux familles :

1. **Listeners Firestore réels** avec `onSnapshot()` : utilisateurs, maintenance, corbeille, historiques, points OUT utilisateurs.
2. **Abonnements locaux à `state`** : `subscribeSites()`, `subscribeItems()`, `subscribeItemCounts()`, `subscribeDetails()`, `subscribeDetailCounts()`, `subscribeDetailDesignations()`, `subscribeDetailRows()`.

Les abonnements locaux Page 1 / Page 2 / Page 3 ne créent pas de `onSnapshot()` Firestore sur `pages/page1/items`, `pages/page2/items` ou `pages/page3/items`.

### Fonctions utilisées par Page 1

Dans `js/app.js`, Page 1 utilise notamment :

- `StorageService.subscribeSites()` pour recevoir les sites.
- `StorageService.subscribeItemCounts()` pour recevoir les compteurs OUT par site.
- `StorageService.getSite()`, selon les flux de verrouillage/navigation.
- `StorageService.createSite()`.
- `StorageService.updateSiteName()`.
- `StorageService.updateSiteCreator()`.
- `StorageService.setSiteLock()` / `clearSiteLock()`.
- `StorageService.removeSite()` / `restoreSite()`.
- `StorageService.refreshSiteInactivityStates()`.
- `StorageService.listInactiveSitesForCurrentCreator()`.
- fonctions d'historique liées aux verrous.

### Fonctions utilisées par Page 2

Page 2 utilise notamment :

- `StorageService.getSite(siteId)`.
- `StorageService.subscribeSites()`.
- `StorageService.subscribeItems(siteId)`.
- `StorageService.subscribeDetailCounts(siteId)`.
- `StorageService.subscribeDetailDesignations(siteId)`.
- `StorageService.subscribeDetailRows(siteId)`.
- `StorageService.getDetailRowsBySite(siteId)`.
- `StorageService.createItem(siteId, ...)`.
- `StorageService.updateItemName(siteId, itemId, ...)`.
- `StorageService.removeItem(siteId, itemId)`.
- `StorageService.restoreItem(...)`.
- `StorageService.recordSearchHistory()` / `recordFilterHistory()`.
- `StorageService.recordExcelExportHistory()`.

Page 2 utilise aussi Firestore directement dans `js/app.js` pour les achats matériels : `sites/{siteId}/achatsMateriels`, via `query(... orderBy('createdAt', 'desc'))` et `getDocs()`.

### Fonctions utilisées par Page 3

Page 3 utilise notamment :

- `StorageService.getSite(siteId)`.
- `StorageService.getItem(siteId, itemId)`.
- `StorageService.subscribeSites()`.
- `StorageService.subscribeItems(siteId)`.
- `StorageService.subscribeDetails(siteId, itemId)`.
- `StorageService.getMaterialCodes()`.
- `StorageService.createDetail(siteId, itemId, ...)`.
- `StorageService.updateDetail(siteId, itemId, detailId, ...)`.
- `StorageService.removeDetail(siteId, itemId, detailId)`.
- `StorageService.recordSearchHistory()` / `recordFilterHistory()` / `recordExcelExportHistory()`.

---

## 2. Initialisation du site

### Ordre réel au lancement

Ordre observé dans `js/app.js` :

```text
Application / bootstrap()
↓
waitForAuthState()
↓
StorageService.init()
↓
getCurrentUserProfile()
↓
ensureCurrentUser() si utilisateur authentifié
↓
initialisation de la page courante selon document.body.dataset.page
```

Ordre interne de `StorageService.init()` :

```text
StorageService.init()
↓
state.initialized = true
state.authUser = getCurrentAuthUser()
state.userId = auth user uid ou null
state.db = firebaseDb
↓
parseOfflineState()
↓
si cache disponible : applySnapshot(cache)
↓
si cache non frais ou absent : loadRemoteSnapshot()
↓
applySnapshot(remote)
↓
persistOfflineState()
```

### `loadRemoteSnapshot()`

`loadRemoteSnapshot()` exécute en parallèle :

```js
Promise.all([
  readPageItems('page1'),
  readPageItems('page2'),
  readMaterialCodes(),
])
```

Cela implique au lancement sans cache frais :

| Collection | Fonction | Requête | Simultanée ? | Statut |
|---|---|---|---|---|
| `pages/page1/items` | `readPageItems('page1')` | `getDocs(collection(...))` sans filtre | Oui | 🔴 chargée globalement |
| `pages/page2/items` | `readPageItems('page2')` | `getDocs(collection(...))` sans filtre | Oui | 🔴 chargée globalement |
| `materialCodes` | `readMaterialCodes()` | `getDocs(collection(...))` sans filtre | Oui | 🔴 chargée globalement |
| `pages/page3/items` | `bootstrapMaterialCodesFromDetails()` seulement si `materialCodes` est vide | `getDocs(collection(...))` sans filtre | Non, déclenchée après `materialCodes` vide | 🟡 chargée conditionnellement |

### État de `pages/page1/items`, `pages/page2/items`, `pages/page3/items` au démarrage

| Collection | Statut au démarrage | Cause |
|---|---|---|
| `pages/page1/items` | 🔴 chargée globalement | Toujours appelée par `loadRemoteSnapshot()` si le cache est absent/expiré. |
| `pages/page2/items` | 🔴 chargée globalement | Toujours appelée par `loadRemoteSnapshot()` si le cache est absent/expiré. |
| `pages/page3/items` | 🟡 chargée conditionnellement | Non chargée par le snapshot principal actuel, mais chargée globalement si `materialCodes` est vide via `bootstrapMaterialCodesFromDetails()`. Ensuite Page 2/Page 3 peuvent charger Page 3 de façon ciblée par `siteId` ou `siteId + itemId`. |

### Lectures simultanées / séquentielles / indirectes

#### Simultanées

- `readPageItems('page1')`
- `readPageItems('page2')`
- `readMaterialCodes()`

Ces trois lectures partent ensemble dans `Promise.all()`.

#### Séquentielles

- Si `readMaterialCodes()` retourne vide, `bootstrapMaterialCodesFromDetails()` est appelé ensuite.
- `bootstrapMaterialCodesFromDetails()` lit globalement `pages/page3/items`, puis écrit des documents dans `materialCodes`.

#### Indirectes

- `init()` peut lire le cache local avant Firestore.
- Après `StorageService.init()`, `js/app.js` appelle `getCurrentUserProfile()` puis éventuellement `ensureCurrentUser()`, ce qui lit/écrit `users/{uid}`.
- Les initialisations de pages déclenchent ensuite des abonnements locaux ou des lectures spécifiques, selon la page.

---

## 3. Page 1

### Données Firestore dépendantes

| Donnée | Collection | Fonction de récupération | Fonction utilisatrice | Raison |
|---|---|---|---|---|
| Sites | `pages/page1/items` | `loadRemoteSnapshot()` → `readPageItems('page1')` → `applySnapshot()` | `subscribeSites()` puis rendu Page 1 | Afficher la liste des sites. |
| Compteurs OUT par site | `pages/page2/items` | `loadRemoteSnapshot()` → `readPageItems('page2')` → `applySnapshot()` | `subscribeItemCounts()` | Afficher le nombre d'OUT pour chaque site et gérer certaines logiques d'inactivité. |
| Profil utilisateur | `users/{uid}` | `getCurrentUserProfile()` / `ensureCurrentUser()` | permissions globales | Rôles et droits d'affichage/action. |
| Utilisateurs | `users` | `listUsers()` selon flux | attribution créateur / noms utilisateurs | Afficher ou sélectionner certains créateurs. |
| Historique | `historiques` | écrit via `appendHistoryEntry()` | pas nécessaire au rendu principal | Historiser recherche, filtre, export, actions. |

### Affichage des sites

Page 1 reçoit les sites via `StorageService.subscribeSites()`. Cette fonction lit seulement l'état local `state.sites`, pré-rempli par `applySnapshot()`.

### Nombre d'OUT / compteurs

Le compteur Page 1 vient de `StorageService.subscribeItemCounts()`, qui parcourt `state.itemsBySite` et calcule :

```js
counts[siteId] = items.length;
```

Comme `state.itemsBySite` est rempli uniquement parce que `pages/page2/items` a été chargé globalement, Page 1 dépend aujourd'hui de la lecture complète de Page 2 pour connaître les compteurs.

### Recherche, filtres, tri, statut

- Le tri de `state.sites` est fait par `sortState()` avec `dateModification` décroissante.
- Les recherches et filtres visibles côté Page 1 sont principalement appliqués en mémoire dans `js/app.js` sur les sites déjà reçus.
- Les statuts d'inactivité dépendent du nombre d'OUT par site via `getSiteOutCount(siteId)`, donc indirectement de `state.itemsBySite`.

### Historique éventuel

Les actions de recherche/filtre/verrouillage/export appellent les fonctions d'historique. Elles écrivent dans `historiques`, puis `pruneHistoryEntries()` relit `historiques` trié par `createdAt`.

### Pourquoi Page 1 a actuellement besoin de `pages/page2/items`

La dépendance actuelle est :

```text
Page 1
↓
StorageService.subscribeItemCounts()
↓
state.itemsBySite
↓
applySnapshot(page2)
↓
loadRemoteSnapshot()
↓
readPageItems('page2')
↓
pages/page2/items global
```

La raison principale est le calcul des compteurs OUT par site. Il y a aussi la logique d'inactivité qui utilise `getSiteOutCount(siteId)`.

### Page 1 a-t-elle réellement besoin de TOUS les documents `page2/items` ?

**Non, pas pour l'affichage principal.**

Pour afficher Page 1, les informations minimales observées sont :

- la liste des sites (`pages/page1/items`) ;
- pour chaque site visible, un compteur d'OUT ;
- éventuellement une information dérivée indiquant si le site a 0 OUT pour la logique d'inactivité ;
- les champs de site déjà présents : `nom`, dates, créateur/propriétaire, verrouillage, inactivité.

Page 1 n'utilise pas les champs détaillés de tous les OUT pour afficher les cartes de site. Elle a besoin d'un **nombre par site**, pas nécessairement de tous les documents complets `pages/page2/items`.

---

## 4. Page 2

### Données Firestore utilisées

| Donnée | Collection | Fonction | Utilisation |
|---|---|---|---|
| Site courant | `pages/page1/items` | `getSite(siteId)`, `subscribeSites()` | Titre, contexte, navigation, droits/logique. |
| OUT du site | `pages/page2/items` | `subscribeItems(siteId)` après `loadRemoteSnapshot()` global | Liste des OUT du site, recherche, filtre, tri, création/modification/suppression. |
| Détails/articles par OUT du site | `pages/page3/items` | `subscribeDetailCounts(siteId)`, `subscribeDetailDesignations(siteId)`, `subscribeDetailRows(siteId)`, `getDetailRowsBySite(siteId)` | Compteurs, statut, filtres de progression, export, désignations. |
| Achats matériels | `sites/{siteId}/achatsMateriels` | Firestore direct dans `js/app.js` avec `query(... orderBy('createdAt', 'desc'))` | Onglet/section achats matériels Page 2. |
| Utilisateurs | `users` | `listUsers()` | Noms créateurs/acteurs. |
| Historique | `historiques` | écrit par `recordSearchHistory()`, `recordFilterHistory()`, `recordExcelExportHistory()` | Historisation des actions. |

### Chargement des OUT

Le chargement actuel des OUT n'est pas ciblé par `siteId` côté Firestore. Il se passe ainsi :

```text
StorageService.init()
↓
loadRemoteSnapshot()
↓
readPageItems('page2')
↓
getDocs(pages/page2/items) sans filtre
↓
applySnapshot()
↓
state.itemsBySite groupe les OUT par siteId
↓
Page 2 : subscribeItems(siteId)
↓
renvoie state.itemsBySite.get(siteId)
```

### `siteId`

Le champ `siteId` existe bien dans la structure actuelle des OUT :

- `applySnapshot()` regroupe les items Page 2 avec `const siteId = String(item.siteId || '')`.
- `createItem()` écrit `siteId` dans le payload de `pages/page2/items`.
- `restoreSite()` recrée les OUT avec `siteId: nextSite.id`.
- `restoreItem()` exige `item.siteId`.
- `importData()` génère des OUT avec `siteId`.

### Recherche, filtres, tri, compteurs

- Recherche Page 2 : appliquée en mémoire dans `js/app.js` sur `currentItems`, venant de `subscribeItems(siteId)`.
- Filtre date / statut : appliqué en mémoire dans `js/app.js`, avec dépendances sur OUT et données Page 3.
- Tri OUT : `state.itemsBySite` est trié par `dateModification` décroissante dans `sortState()`.
- Compteurs Page 2 : `itemCount` vient de la longueur des OUT du site ; les compteurs de statut/progression dépendent souvent de `detailCountsByItem`, `detailDesignationsByItem` et `detailRowsByItem`.
- Export : peut forcer `StorageService.getDetailRowsBySite(siteId)`, donc charger les détails Page 3 du site si non déjà chargés.

### Création / modification / suppression

| Action | Fonction | Collection | Champs importants |
|---|---|---|---|
| Création OUT | `createItem(siteId, numberValue, options)` | `pages/page2/items` | `siteId`, `numero`, `magasin`, `ownerId`, `createdBy`, `createdByName`, dates. |
| Modification OUT | `updateItemName(siteId, itemId, nextValue)` | `pages/page2/items/{itemId}` | `numero`, `dateModification`. |
| Suppression OUT | `removeItem(siteId, itemId)` | `pages/page2/items/{itemId}` | Supprime le doc OUT ; garde les détails en mémoire/corbeille selon réglage. |
| Restauration OUT | `restoreItem(snapshot)` | `pages/page2/items`, `pages/page3/items` | Recrée l'OUT et ses détails. |

### Historique

Les recherches, filtres, exports et actions écrivent dans `historiques`. Après chaque écriture, `pruneHistoryEntries()` peut relire toute la collection `historiques` triée par `createdAt desc`.

### Peut-on charger uniquement les OUT du site ouvert ?

**Oui, la structure actuelle semble compatible avec une requête ciblée par `siteId`, car le champ est lu et écrit explicitement dans les documents Page 2.**

La requête théorique compatible avec le code serait :

```js
query(makePageItemsCollection('page2'), where('siteId', '==', siteId))
```

Champs nécessaires :

| Champ | Nécessaire pour | Vérification code |
|---|---|---|
| `siteId` | Filtrer les OUT du site | Écrit dans `createItem()` et utilisé par `applySnapshot()`. |
| `dateModification` | Conserver le tri actuel | Utilisé dans `sortState()` pour trier les OUT. |
| `numero` | Affichage/recherche/édition de l'OUT | Utilisé par Page 2 et `updateItemName()`. |
| `magasin` | Badge/filtre/affichage magasin | Écrit par `createItem()`. |
| `createdBy`, `ownerId`, `createdByName` | Permissions, points, historique/affichage utilisateur | Écrits par `createItem()` et utilisés notamment dans les points utilisateurs. |
| `dateCreation` | Affichage/filtre date | Écrit par `createItem()`. |

Attention : si un futur tri Firestore par `dateModification` est ajouté à la requête `where('siteId', '==', siteId)`, un index composite peut être requis selon les règles Firestore et la requête exacte. Aucun index n'est modifié dans cette analyse.

---

## 5. Dépendances Page 1 ↔ Page 2

### Dépendance principale : compteur OUT

```text
Page 1
↓
besoin d'un compteur OUT par site
↓
StorageService.subscribeItemCounts()
↓
state.itemsBySite
↓
chargement global pages/page2/items
```

| Donnée nécessaire | Origine | Fonction | Raison | Possibilité de remplacement |
|---|---|---|---|---|
| Nombre d'OUT par site | `pages/page2/items` | `subscribeItemCounts()` | Afficher les compteurs sur Page 1. | Compteur pré-calculé sur le site, agrégation Firestore, requêtes ciblées par site, ou autre source existante de comptage. |
| Savoir si un site a 0 OUT | `pages/page2/items` | `getSiteOutCount()` | Logique d'inactivité/restauration/suppression. | Champ stocké/compteur dans `pages/page1/items`, agrégation ciblée ou requête de comptage. |
| Mise à jour immédiate après création/suppression OUT | `state.itemsBySite` | `createItem()`, `removeItem()`, `emitAll()` | Rafraîchir Page 1/Page 2 localement. | Mettre à jour un compteur dérivé en même temps que les écritures, ou recharger une agrégation. |

### Dépendances secondaires

| Dépendance | Description | Remplacement possible |
|---|---|---|
| Tri et recherche Page 2 | Page 2 dépend des OUT complets du site. | Lecture ciblée `where('siteId', '==', siteId)`, puis tri/recherche en mémoire ou requête Firestore adaptée. |
| Points utilisateurs | `listOutCreationPoints()` et `subscribeOutCreationPoints()` lisent tous les OUT Page 2 pour compter par créateur. | Agrégation par utilisateur, compteur stocké, ou requête/collection dédiée. |
| Export Page 2 | Peut nécessiter les détails Page 3 du site. | Déjà plus ciblé côté Page 3 avec `where('siteId', '==', siteId)`. |

### Synthèse

La dépendance Page 1 ↔ Page 2 n'est pas une dépendance de contenu complet, mais une dépendance de **compteur**. Le code actuel calcule ce compteur en chargeant tous les OUT et en les comptant côté client.

---

## 6. Firestore reads dans `StorageService`

| Fonction | Collection | Type | Filtre | Quand ? | Global ? | Utilisé par |
|---|---|---|---|---|---|---|
| `isUsernameDuplicate()` | `users` | `getDocs()` | Aucun | Changement/création profil | 🔴 global | Profil/utilisateurs |
| `ensureCurrentUser()` | `users/{uid}` | `getDoc()` | Doc id | Après auth | 🟢 ciblé | Bootstrap |
| `getCurrentUserProfile()` | `users/{uid}` | `getDoc()` | Doc id | Bootstrap/permissions/actions | 🟢 ciblé | Toutes pages |
| `listUsers()` | `users` | `getDocs()` | Aucun | Pages/admin selon flux | 🔴 global | Utilisateurs/Page 1/Page 2 |
| `cleanupInactiveUsers()` | `users` | `getDocs()` | Aucun | Page utilisateurs/admin | 🔴 global | Utilisateurs |
| `listOutCreationPoints()` | `pages/page2/items` | `getDocs()` | Aucun | Page utilisateurs | 🔴 global | Utilisateurs |
| `subscribeOutCreationPoints()` | `pages/page2/items` | `onSnapshot()` | Aucun | Page utilisateurs | 🔴 global listener | Utilisateurs |
| `deleteUser()` | `users/{userId}` | `getDoc()` | Doc id | Suppression utilisateur | 🟢 ciblé | Utilisateurs |
| `subscribeCurrentUserProfile()` | `users/{uid}` | `onSnapshot()` | Doc id | Profil courant | 🟢 ciblé listener | Paramètres/global |
| `subscribeUsers()` | `users` | `onSnapshot()` | Aucun | Page utilisateurs | 🔴 global listener | Utilisateurs |
| `subscribeMaintenanceState()` | `appSettings/maintenance` | `onSnapshot()` | Doc id | Maintenance | 🟢 ciblé listener | Global |
| `hasReachedOutDeletionLimit()` | `users/{uid}/outDeletionLimits/{date}` | `getDoc()` | Doc id | Suppression OUT | 🟢 ciblé | Page 2 |
| `recordOutDeletionLimitUsage()` | `users/{uid}/outDeletionLimits/{date}` | `getDoc()` | Doc id | Suppression OUT | 🟢 ciblé | Page 2 |
| `readPageItems('page1')` | `pages/page1/items` | `getDocs()` | Aucun | `loadRemoteSnapshot()` | 🔴 global | Page 1/2/3 |
| `readPageItems('page2')` | `pages/page2/items` | `getDocs()` | Aucun | `loadRemoteSnapshot()` | 🔴 global | Page 1/2/3 |
| `readPageItems('page3')` | `pages/page3/items` | `getDocs()` | Aucun | Bootstrap material codes si vide | 🔴 global conditionnel | Page 3/materialCodes |
| `readMaterialCodes()` | `materialCodes` | `getDocs()` | Aucun | Init ou suggestions Page 3 | 🔴 global | Page 3 |
| `readDetailsByQuery(where('siteId'))` | `pages/page3/items` | `getDocs(query(where))` | `siteId == ...` | Page 2 détails site | 🟢 ciblé | Page 2 |
| `readDetailsByQuery(where('siteId'), where('itemId'))` | `pages/page3/items` | `getDocs(query(where, where))` | `siteId == ...`, `itemId == ...` | Page 3 détails OUT | 🟢 ciblé | Page 3 |
| `isTrashEnabled()` | `appSettings/trash` | `getDoc()` | Doc id | Avant suppression/restauration | 🟢 ciblé | Toutes suppressions |
| `purgeExpiredTrashEntries()` | `trash` | `getDocs()` | Aucun | Gestion corbeille | 🔴 global | Corbeille |
| `subscribeTrashSettings()` | `appSettings/trash` | `onSnapshot()` | Doc id | Corbeille | 🟢 ciblé listener | Corbeille |
| `subscribeTrashEntries()` | `trash` | `onSnapshot(query(orderBy))` | Tri `deletedAtIso desc` | Corbeille | 🔴 global listener trié | Corbeille |
| `restoreTrashEntry()` | `trash/{entryId}` | `getDoc()` | Doc id | Restauration | 🟢 ciblé | Corbeille |
| `pruneHistoryEntries()` | `historiques` | `getDocs(query(orderBy))` | Tri `createdAt desc` | Après écriture historique | 🔴 global trié | Historique/actions |
| `listHistoriques()` | `historiques` | `getDocs(query(orderBy))` | Tri `createdAt desc` | Page historiques | 🔴 global trié | Historiques |
| `subscribeHistoriques()` | `historiques` | `onSnapshot(query(orderBy))` | Tri `createdAt desc` | Page historiques | 🔴 global listener trié | Historiques |

Classement principal :

- 🟢 ciblé : doc précis ou requête `where` par `siteId/itemId`.
- 🟡 partiellement ciblé : non retenu ici sauf lectures conditionnelles comme Page 3 via bootstrap.
- 🔴 global : collection entière ou collection triée sans limite.

---

## 7. Firestore writes dans `StorageService`

| Fonction | Collection | Déclencheur | Données modifiées | Pages concernées |
|---|---|---|---|---|
| `recordCurrentUserActivity()` | `users/{uid}` | Activité utilisateur | `lastActivity`, `updatedAt` | Global |
| `ensureCurrentUser()` | `users/{uid}` | Bootstrap auth | Profil utilisateur par défaut | Global |
| `saveUsername()`, `changeUsername()`, `updateAvatarUrl()` | `users/{uid}` | Profil | Nom/avatar/dates | Paramètres/global |
| `updateUserRole()`, `updateUserMaintenanceAccess()` | `users/{userId}` | Admin utilisateurs | Rôle/maintenance | Utilisateurs |
| `deleteUser()` | `users/{userId}`, `trash` éventuel | Suppression utilisateur | Doc utilisateur, entrée corbeille | Utilisateurs/corbeille |
| `cleanupInactiveUsers()` | `users/{userId}` | Nettoyage admin | Suppression docs utilisateurs | Utilisateurs |
| `setMaintenanceState()` | `appSettings/maintenance` | Toggle maintenance | `enabled`, `updatedAt`, `updatedBy` | Paramètres/global |
| `setTrashEnabled()` | `appSettings/trash` | Toggle corbeille | `enabled`, `updatedAt` | Corbeille/paramètres |
| `addTrashEntry()` | `trash` | Suppression avec corbeille activée | Snapshot supprimé | Corbeille |
| `purgeExpiredTrashEntries()` | `trash` | Nettoyage corbeille | Suppressions expirées | Corbeille |
| `createSite()` | `pages/page1/items` | Création site | Site | Page 1 |
| `updateSiteName()` | `pages/page1/items/{siteId}` | Édition nom | `nom`, `dateModification` | Page 1/Page 2 |
| `updateSiteCreator()` | `pages/page1/items/{siteId}` | Admin créateur | Propriétaire/créateur | Page 1 |
| `setSiteLock()`, `clearSiteLock()` | `pages/page1/items/{siteId}` | Verrouillage site | Hash, date, état verrou | Page 1/Page 2 |
| `refreshSiteInactivityStates()` | `pages/page1/items/{siteId}` | Gestion inactivité | `inactiveSince`, `inactivityDecisionPending` | Page 1 |
| `restoreInactiveSite()` | `pages/page1/items/{siteId}` | Décision créateur | Champs inactivité supprimés | Page 1 |
| `removeSite()` | `pages/page1/items/{siteId}` | Suppression site | Supprime site, éventuellement corbeille | Page 1/Page 2 |
| `restoreSite()` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | Restauration | Recrée site, OUT, détails | Page 1/2/3 |
| `createItem()` | `pages/page2/items` | Création OUT | OUT avec `siteId` | Page 2 / compteur Page 1 |
| `updateItemName()` | `pages/page2/items/{itemId}` | Édition OUT | `numero`, `dateModification` | Page 2 |
| `removeItem()` | `pages/page2/items/{itemId}` | Suppression OUT | Supprime OUT, corbeille éventuelle | Page 2 / compteur Page 1 |
| `restoreItem()` | `pages/page2/items`, `pages/page3/items` | Restauration OUT | Recrée OUT et détails | Page 2/Page 3 |
| `createDetail()` | `pages/page3/items` | Ajout article | Détail avec `siteId`, `itemId` | Page 3 / statut Page 2 |
| `updateDetail()` | `pages/page3/items/{detailId}` | Édition article | Champs article | Page 3 / statut Page 2 |
| `removeDetail()` | `pages/page3/items/{detailId}` | Suppression article | Supprime détail, corbeille éventuelle | Page 3 / statut Page 2 |
| `ensureMaterialCode()` | `materialCodes/{codeId}` | Création/édition article | Code + désignation | Page 3 suggestions |
| `bootstrapMaterialCodesFromDetails()` | `materialCodes/*` | `materialCodes` vide | Codes déduits Page 3 | Page 3 suggestions |
| `appendHistoryEntry()` | `historiques` | Actions utilisateur | Entrée historique | Historiques/global |
| `pruneHistoryEntries()` | `historiques` | Après historique | Supprime au-delà de 100 | Historiques |
| `importData()` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | Import | Données importées | Page 1/2/3 |

Objectif futur : réduire les **lectures**. Les écritures ne sont pas modifiées dans cette analyse.

---

## 8. Cache

### Clé et durée

Le cache local est :

```text
suiviMateriel.offlineCache.v1
```

Durée de fraîcheur :

```text
180 000 ms = 3 minutes
```

### Données mises en cache

`persistOfflineState()` stocke :

```js
{
  savedAt,
  pages: {
    page1: state.sites,
    page2: tous les items de state.itemsBySite,
    page3: tous les détails de state.detailsByItem,
  },
  materialCodes: state.materialCodes,
}
```

### Quand le cache est lu

`parseOfflineState()` est appelé au début de `StorageService.init()`.

- Si un snapshot cache existe : `applySnapshot(cache)` est appelé immédiatement.
- Si le cache est frais : pas de lecture distante principale.
- Si le cache est absent ou expiré : `loadRemoteSnapshot()` relit Firestore.

### Quand le cache est écrit

Le cache est écrit après :

- un `loadRemoteSnapshot()` réussi ;
- de nombreuses écritures locales : création/modification/suppression/restauration sites/OUT/détails ;
- chargement ciblé de détails Page 3 (`ensureSiteDetailsLoaded()` / `ensurePairDetailsLoaded()`) ;
- mise à jour du catalogue `materialCodes`.

### Données utilisées par Page 1 / Page 2

| Page | Données cache utilisées |
|---|---|
| Page 1 | `pages.page1` pour sites, `pages.page2` pour compteurs via `state.itemsBySite`. |
| Page 2 | `pages.page1` pour site courant, `pages.page2` pour OUT du site, `pages.page3` si présent pour compteurs/statuts/détails. |
| Page 3 | `pages.page1`, `pages.page2`, `pages.page3`, `materialCodes`. |

### Le cache oblige-t-il à charger Page 1 + Page 2 ensemble ?

Le cache ne force pas techniquement Firestore à charger Page 1 + Page 2 ensemble, mais le format actuel du cache **représente un snapshot global partagé**. Aujourd'hui, `loadRemoteSnapshot()` recharge Page 1 + Page 2 ensemble, puis `persistOfflineState()` sauvegarde cette vision globale.

Pour une optimisation future, le cache peut devenir un blocage si :

- il est supposé complet alors qu'il ne contient qu'un site ou un OUT ;
- `subscribeItemCounts()` continue à considérer `state.itemsBySite` comme global ;
- les compteurs Page 1 sont déduits d'un cache partiel de Page 2.

### Le cache peut-il empêcher une optimisation ciblée ?

Oui, si son contrat n'est pas clarifié. Il faudra distinguer :

- cache global complet ;
- cache Page 1 seulement ;
- cache Page 2 par `siteId` ;
- cache Page 3 par `siteId:itemId` ;
- compteurs ou métadonnées dérivés.

Sans cette distinction, un cache partiel pourrait produire des compteurs faux.

---

## 9. Realtime

### `onSnapshot()` dans `StorageService`

| Fonction | Collection / doc | Requête | Filtre | Déclencheur | Données surveillées | Pages concernées | Unsubscribe | Risque global |
|---|---|---|---|---|---|---|---|---|
| `subscribeOutCreationPoints()` | `pages/page2/items` | collection directe | Aucun | Page utilisateurs | Tous les OUT, réduits par créateur | Utilisateurs | Retourné | 🔴 listener global Page 2 |
| `subscribeCurrentUserProfile()` | `users/{uid}` | doc direct | Doc id | Profil courant | Profil utilisateur courant | Paramètres/global | Retourné | 🟢 ciblé |
| `subscribeUsers()` | `users` | collection directe | Aucun | Page utilisateurs | Tous les utilisateurs | Utilisateurs | Retourné | 🔴 global |
| `subscribeMaintenanceState()` | `appSettings/maintenance` | doc direct | Doc id | Maintenance | État maintenance | Global | Retourné | 🟢 ciblé |
| `subscribeTrashSettings()` | `appSettings/trash` | doc direct | Doc id | Corbeille | Réglage corbeille | Corbeille | Retourné | 🟢 ciblé |
| `subscribeTrashEntries()` | `trash` | `query(orderBy('deletedAtIso', 'desc'))` | Aucun filtre | Corbeille | Toutes les entrées corbeille triées | Corbeille | Retourné | 🔴 global trié |
| `subscribeHistoriques()` | `historiques` | `query(orderBy('createdAt', 'desc'))` | Aucun filtre | Historiques | Tout l'historique trié | Historiques | Retourné | 🔴 global trié |

### Page 1 et Page 2 utilisent-elles le même listener Firestore ?

Non pour les flux principaux Page 1 / Page 2.

- `subscribeSites()` est un abonnement local à `state.sites`, pas un `onSnapshot()` Firestore.
- `subscribeItemCounts()` est un abonnement local à `state.itemsBySite`, pas un `onSnapshot()` Firestore.
- `subscribeItems(siteId)` est un abonnement local à `state.itemsBySite.get(siteId)`, pas un `onSnapshot()` Firestore.

Le risque global principal côté Page 2 en realtime est plutôt `subscribeOutCreationPoints()` sur `pages/page2/items`, utilisé pour les points utilisateurs, pas pour Page 1/Page 2 elles-mêmes.

---

## 10. Page 3 — contexte

Page 3 fonctionne maintenant davantage avec le couple :

```text
siteId + itemId
```

### Fonctionnement actuel

Dans `js/app.js`, Page 3 récupère :

- le site courant avec `StorageService.getSite(siteId)` ;
- l'OUT courant avec `StorageService.getItem(siteId, itemId)` ;
- les détails avec `StorageService.subscribeDetails(siteId, itemId)` ;
- les suggestions de codes avec `StorageService.getMaterialCodes()`.

Dans `StorageService.subscribeDetails(siteId, itemId)` :

1. la fonction émet immédiatement les détails déjà présents en mémoire ;
2. elle appelle `ensurePairDetailsLoaded(siteId, itemId)` ;
3. cette fonction exécute une requête ciblée sur `pages/page3/items` avec :
   - `where('siteId', '==', siteId)` ;
   - `where('itemId', '==', itemId)`.

### Différences avec Page 1 et Page 2

| Page | Chargement principal actuel | Ciblage Firestore actuel |
|---|---|---|
| Page 1 | Sites globaux + OUT globaux pour compteurs | Pas de ciblage Page 2 ; compteur calculé en mémoire. |
| Page 2 | OUT déjà chargés globalement puis filtrés par `siteId` en mémoire | Détails Page 3 ciblés par `siteId`, mais OUT Page 2 non ciblés. |
| Page 3 | Site/OUT depuis état local, détails chargés par couple si besoin | Détails ciblés par `siteId + itemId`. |

Page 3 est donc plus proche de l'architecture désirée pour les détails, mais elle dépend encore du fait que l'OUT courant soit déjà disponible dans `state.itemsBySite`, lui-même rempli par le chargement global Page 2 au démarrage.

---

## Architecture potentielle

Objectif papier uniquement :

```text
Lancement
↓
Page 1 uniquement
↓
Site sélectionné
↓
Page 2 uniquement pour ce site
↓
OUT sélectionné
↓
Page 3 uniquement pour cet OUT
```

### Architecture cible possible

1. **Au lancement Page 1**
   - Charger `pages/page1/items`.
   - Charger ou disposer uniquement des compteurs OUT par site.
   - Ne pas charger `pages/page2/items` complet.
   - Ne pas charger `pages/page3/items`, sauf besoin indépendant de `materialCodes`.

2. **À l'ouverture d'un site Page 2**
   - Charger les OUT du site avec `where('siteId', '==', siteId)`.
   - Trier par `dateModification` côté client ou côté Firestore.
   - Charger les détails Page 3 du site uniquement si nécessaires pour compteurs/statuts/export : déjà possible via `ensureSiteDetailsLoaded(siteId)`.

3. **À l'ouverture d'un OUT Page 3**
   - Charger les détails avec `where('siteId', '==', siteId)` + `where('itemId', '==', itemId)`.
   - Vérifier que l'OUT courant peut être obtenu sans avoir chargé tous les OUT globaux : soit depuis Page 2, soit par une lecture ciblée `pages/page2/items/{itemId}` ou par requête `siteId + itemId` selon choix futur.

### Points à résoudre avant modification

- Remplacer le calcul global `subscribeItemCounts()` par une source de compteurs fiable.
- Clarifier le contrat de `state.itemsBySite` : complet globalement ou partiel par site ?
- Clarifier le contrat du cache : global ou partiel.
- Préserver la logique d'inactivité qui dépend de `getSiteOutCount()`.
- Préserver les points utilisateurs qui utilisent tous les OUT (`listOutCreationPoints()` / `subscribeOutCreationPoints()`).
- Préserver les filtres/statuts Page 2 qui dépendent de détails Page 3.
- Préserver la navigation Page 3 si l'utilisateur arrive directement sur `page3.html?siteId=...&itemId=...`.
- Vérifier les indexes nécessaires si une requête Firestore ajoute `where('siteId')` + `orderBy('dateModification')`.

---

## Blocages à résoudre

| Niveau | Blocage | Impact |
|---|---|---|
| 🔴 critique | `subscribeItemCounts()` calcule les compteurs depuis `state.itemsBySite`, donc depuis tous les OUT chargés. | Page 1 perd les compteurs si Page 2 n'est plus globale. |
| 🔴 critique | `getSiteOutCount()` utilise `state.itemsBySite` pour l'inactivité. | La logique d'inactivité peut devenir fausse avec un cache/chargement partiel. |
| 🔴 critique | `loadRemoteSnapshot()` appelle toujours `readPageItems('page2')`. | Lecture globale Page 2 au démarrage tant que cette fonction reste inchangée. |
| 🟠 important | `state.itemsBySite` n'indique pas si ses données sont globales ou seulement chargées pour certains sites. | Risque de compteurs incomplets et comportements incohérents. |
| 🟠 important | Le cache `pages.page2` peut être partiel dans une future architecture sans métadonnée. | Risque de restaurer un état incomplet comme s'il était complet. |
| 🟠 important | Page 3 dépend de `getItem(siteId, itemId)` et `subscribeItems(siteId)` pour l'OUT courant. | Arrivée directe Page 3 à gérer si Page 2 n'a pas été chargée. |
| 🟠 important | Points utilisateurs lisent tous les OUT Page 2. | Une optimisation Page 1/Page 2 ne résout pas ce listener global utilisé ailleurs. |
| 🟠 important | Export Page 2 peut nécessiter les détails de tout le site. | Déjà ciblable par `siteId`, mais à conserver. |
| 🟡 mineur | `materialCodes` peut déclencher un bootstrap global Page 3 si collection vide. | Cas conditionnel, mais coûteux si `materialCodes` est absent. |
| 🟡 mineur | Historique lit la collection complète triée après écriture. | Hors Page 1/Page 2 principale, mais peut ajouter des lectures. |

---

## 13. Objectif final — réponses

### 1. Pourquoi Page 1 et Page 2 sont-elles actuellement chargées globalement au démarrage ?

Parce que `StorageService.init()` appelle `loadRemoteSnapshot()` lorsque le cache est absent ou expiré, et `loadRemoteSnapshot()` lance `readPageItems('page1')` et `readPageItems('page2')` en parallèle, sans filtre Firestore.

### 2. Quelle fonction provoque cette lecture ?

La chaîne exacte est :

```text
bootstrap() dans js/app.js
↓
StorageService.init()
↓
loadRemoteSnapshot()
↓
readPageItems('page1') + readPageItems('page2')
↓
getDocs(collection(state.db, 'pages', pageName, 'items'))
```

La fonction qui provoque la lecture globale Page 2 est donc `loadRemoteSnapshot()`, via `readPageItems('page2')`.

### 3. Page 1 a-t-elle réellement besoin de tous les OUT pour afficher ses informations ?

Non. Pour son affichage principal, Page 1 a besoin des sites et d'un compteur OUT par site. Elle n'a pas besoin du contenu complet de tous les documents OUT.

### 4. Peut-on charger Page 2 uniquement lorsqu'un site est ouvert ?

Oui, en principe. Le champ `siteId` est présent dans la structure actuelle des OUT et peut servir à une requête ciblée. Le code actuel ne le fait pas encore pour Page 2 ; il charge tout puis filtre en mémoire.

### 5. Quels champs sont nécessaires pour filtrer les OUT par `siteId` ?

Champ strictement nécessaire :

- `siteId`

Champs nécessaires pour conserver le comportement Page 2 après filtrage :

- `numero`
- `dateCreation`
- `dateModification`
- `magasin`
- `createdBy`
- `ownerId`
- `createdByName`

Selon le tri Firestore futur, `dateModification` peut devenir nécessaire dans `orderBy()`.

### 6. Quelles fonctions risquent d'être cassées si `page2/items` n'est plus global ?

- `subscribeItemCounts()`
- `getSiteOutCount()`
- `refreshSiteInactivityStates()`
- `isSitePendingInactivityDecision()` indirectement via compteurs/inactivité
- `listInactiveSitesForCurrentCreator()` indirectement
- `removeSite()` si elle suppose tous les OUT/détails disponibles en mémoire pour snapshot corbeille/restauration
- `exportData()` si l'export global doit contenir tous les OUT
- `getItem(siteId, itemId)` pour arrivée directe Page 3 si le site n'est pas chargé
- `subscribeItems(siteId)` si `state.itemsBySite` devient partiel sans chargement à la demande
- les points utilisateurs (`listOutCreationPoints()`, `subscribeOutCreationPoints()`) restent globaux dans un autre flux

### 7. Quelle solution permettrait de conserver les compteurs sans charger tous les OUT ?

Solutions possibles à analyser avant modification :

- compteur pré-calculé stocké sur chaque site (`pages/page1/items`) ;
- agrégation Firestore par site ;
- requêtes de comptage ciblées par `siteId` ;
- collection ou document de statistiques par site ;
- mise à jour transactionnelle/atomique du compteur lors de `createItem()`, `removeItem()`, `restoreItem()` et suppressions/restaurations de site.

### 8. Quelle modification minimale serait nécessaire ?

Sur papier, la modification minimale serait de découpler le compteur Page 1 de `state.itemsBySite` global, puis de remplacer le chargement global de `page2` dans `loadRemoteSnapshot()` par un chargement à la demande lors de l'ouverture de Page 2.

Mais cela nécessite d'abord de sécuriser le compteur, l'inactivité, le cache et l'arrivée directe Page 3.

### 9. Quel est le risque de cette modification ?

Risques principaux :

- compteurs Page 1 incorrects ;
- logique d'inactivité incorrecte ;
- Page 3 incapable de résoudre l'OUT courant en arrivée directe ;
- export global incomplet ;
- suppression/restauration de site incomplète ;
- cache partiel interprété comme global ;
- indexes Firestore nécessaires si tri/filtrage combinés ;
- régressions dans recherche/filtres/statuts Page 2 si les détails Page 3 ne sont pas chargés au bon moment.

### 10. Quelles vérifications devront être faites avant de modifier le code ?

- Vérifier en Firestore que tous les documents `pages/page2/items` ont bien un `siteId` valide.
- Vérifier la présence et la cohérence de `dateModification`, `dateCreation`, `numero`, `magasin`, `createdBy`, `ownerId`.
- Vérifier les règles Firestore pour autoriser une requête `where('siteId', '==', siteId)`.
- Vérifier les indexes requis si `orderBy('dateModification')` est ajouté.
- Définir une source fiable pour les compteurs OUT par site.
- Définir le nouveau contrat de cache partiel/global.
- Tester Page 1, Page 2, Page 3 en accès direct et navigation normale.
- Tester création, modification, suppression et restauration de site/OUT/détail.
- Tester export, recherche, filtres et historique.

---

## 14. Comparaison avec les audits existants

### `FIRESTORE_GLOBAL.md`

Informations concordantes :

- L'audit indique que `StorageService.init()` charge `pages/page1/items`, `pages/page2/items` et mentionne historiquement `pages/page3/items` via `loadRemoteSnapshot()`.
- Il identifie `state.sites`, `state.itemsBySite`, `state.detailsByItem` comme état global.
- Il précise que `subscribeSites()`, `subscribeItems()` et `subscribeDetails()` sont des listeners locaux, pas des `onSnapshot()` Firestore directs pour Page 1/Page 2/Page 3.
- Il identifie `subscribeOutCreationPoints()` comme listener global sur `pages/page2/items`.
- Il signale le cache offline `suiviMateriel.offlineCache.v1`.

Différence importante observée dans le code actuel :

- Dans le code actuel de `js/storage.js`, `loadRemoteSnapshot()` retourne `{ page1, page2, page3: [], materialCodes }` et ne lit plus directement `readPageItems('page3')` dans le `Promise.all()`. Page 3 est chargée conditionnellement par `bootstrapMaterialCodesFromDetails()` si `materialCodes` est vide, puis ciblée via `ensureSiteDetailsLoaded()` / `ensurePairDetailsLoaded()`.
- Donc l'audit existant semble décrire un état antérieur ou plus global concernant Page 3. L'analyse actuelle retient que Page 3 n'est plus systématiquement chargée globalement au démarrage, sauf cas conditionnel `materialCodes` vide.

### `FIRESTORE_AUDIT.md`

Informations utilisées uniquement si présentes :

- Le fichier existe dans le projet.
- Il confirme le périmètre Firestore global à auditer et sert de comparaison historique.

Différences importantes :

- La présente analyse se concentre spécifiquement sur la dépendance Page 1 ↔ Page 2 et sur la raison du chargement global de `pages/page2/items` au démarrage.
- La présente analyse isole aussi le rôle du cache et la faisabilité d'une requête Page 2 par `where('siteId', '==', siteId)` en vérifiant le champ dans le code.

Aucune information non observée dans les fichiers n'est inventée ici.

---

## CONCLUSION

### Problème actuel

Au lancement sans cache frais, l'application charge globalement `pages/page1/items` et `pages/page2/items`. Cela signifie que Page 1 et Page 2 sont initialisées à partir d'un snapshot global, même si l'utilisateur n'ouvre pas encore un site.

### Cause

La cause directe est `StorageService.init()` → `loadRemoteSnapshot()` → `readPageItems('page2')`. Cette lecture fait `getDocs()` sur toute la collection `pages/page2/items` sans `where`.

### Dépendances

La dépendance majeure entre Page 1 et Page 2 est le compteur OUT par site : Page 1 affiche et utilise ce compteur, mais il est actuellement calculé à partir de tous les documents `pages/page2/items` stockés dans `state.itemsBySite`.

### Blocages

Les blocages principaux sont :

- compteur Page 1 dépendant de tous les OUT ;
- logique d'inactivité dépendant de `getSiteOutCount()` ;
- cache qui ne distingue pas état global et état partiel ;
- Page 3 qui dépend encore de l'OUT courant présent dans `state.itemsBySite` ;
- flux utilisateurs qui lit/écoute tous les OUT pour les points de création.

### Solution potentielle

Sur papier, l'architecture cible serait :

```text
Lancement : charger Page 1 + compteurs uniquement
Ouverture site : charger OUT du site avec siteId
Ouverture OUT : charger détails avec siteId + itemId
```

Le champ `siteId` existe dans les OUT et semble permettre une requête ciblée de type `where('siteId', '==', siteId)`.

### Risques

Les risques principaux sont des compteurs faux, une logique d'inactivité cassée, un cache incomplet interprété comme complet, une arrivée directe Page 3 non résolue, et des exports/suppressions/restaurations incomplets.

### Prochaine étape recommandée

Avant toute modification de code, valider cette analyse puis décider de la source cible des compteurs OUT par site. La première optimisation ne devrait pas supprimer le chargement global de `pages/page2/items` tant que les compteurs, l'inactivité, le cache et l'accès direct Page 3 ne sont pas sécurisés.
