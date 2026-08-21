# AUDIT GÉNÉRAL FIRESTORE — Page 1 / Page 2 / Page 3

> Audit statique non destructif réalisé sur le code du dépôt. Aucun code applicatif, aucune donnée Firestore, aucune règle, aucun index et aucune collection Firestore n'ont été modifiés. Le seul fichier créé est ce rapport.

## Résumé exécutif

- **Lectures globales au démarrage** : si le cache local est absent ou expiré, `StorageService.init()` charge globalement `pages/page1/items` et `materialCodes`. Si `materialCodes` est vide, un bootstrap historique lit aussi globalement `pages/page3/items` pour créer le catalogue. Si le cache local est frais, aucune lecture Firestore Page 1/Page 2/Page 3/materialCodes n'est déclenchée par `init()`.
- **Page 2 ciblée** : les OUT d'un site sont chargés par `readPage2ItemsBySite(siteId)` avec la requête exacte `query(makePageItemsCollection('page2'), where('siteId', '==', normalizedSiteId))`.
- **Page 3 ciblée** : les détails d'un OUT sont chargés par `ensurePairDetailsLoaded(siteId, itemId)` avec `where('siteId', '==', String(siteId))` + `where('itemId', '==', String(itemId))`. Les agrégats Page 2 sur les détails utilisent encore une lecture ciblée par site uniquement.
- **`outCount`** : Page 1 utilise `site.outCount` via `subscribeItemCounts()`/`getSiteOutCount()`, sans lecture globale de `pages/page2/items` au démarrage pour les compteurs.
- **`materialCodes`** : le typeahead repose sur la collection dédiée `materialCodes`; il ne dépend plus normalement d'une lecture globale de `pages/page3/items`, sauf bootstrap conditionnel si le catalogue est vide.
- **Listeners globaux** : aucun `onSnapshot()` Firestore global n'est utilisé pour Page 1/Page 2/Page 3. Des listeners globaux restent pour `users`, `pages/page2/items` dans `users.html`, `trash`, `historiques` et `adminMessages`.
- **Principaux problèmes** : l'audit statique ne peut pas vérifier la cohérence réelle `site.outCount` vs données de production; plusieurs écritures couplées `addDoc/deleteDoc` + `incrementSiteOutCount()` ne sont pas atomiques de bout en bout; les vérifications syntaxiques JavaScript non destructives passent.
- **Optimisations restantes** : éviter le bootstrap global `pages/page3/items` si `materialCodes` est vide, rendre atomiques les mutations OUT + compteur, limiter les lectures/listeners globaux des pages utilisateurs/historique/corbeille selon les besoins métier.

---

## 1. Inventaire complet Firestore

### 1.1 Imports Firestore utilisés

`js/storage.js` importe `addDoc`, `collection`, `deleteDoc`, `deleteField`, `doc`, `getDoc`, `getDocs`, `increment`, `onSnapshot`, `orderBy`, `query`, `where`, `serverTimestamp`, `setDoc`, `Timestamp`, `updateDoc`, `runTransaction`. `writeBatch`, `limit` et `startAfter` n'y sont pas utilisés. D'autres fichiers utilisent Firestore directement : `js/app.js`, `js/materiels.js`, `js/maintenance-banner.js`, `users.html`.

### 1.2 Inventaire par appel/fonction principale

| Fichier | Fonction / zone | Collection/document | Opération | Déclencheur | Page | Global/ciblé | Données |
|---|---|---|---|---|---|---|---|
| `js/storage.js` | `recordCurrentUserActivity()` | `users/{uid}` | `setDoc(..., merge)` | actions/historique | Global | ciblé doc | activité utilisateur |
| `js/storage.js` | `isUsernameDuplicate()` | `users` | `getDocs()` | création/changement profil | Utilisateurs | global | doublons noms |
| `js/storage.js` | `ensureCurrentUser()` | `users/{uid}` | `getDoc()`, `setDoc(..., merge)` | initialisation utilisateur | Global | ciblé doc | profil courant |
| `js/storage.js` | `updateCurrentUserProfile()` et assimilées | `users/{uid}` | `setDoc(..., merge)` | profil | Utilisateurs | ciblé doc | profil |
| `js/storage.js` | `listUsers()` | `users` | `getDocs()` | page utilisateurs/admin | Utilisateurs | global | utilisateurs |
| `js/storage.js` | `cleanupInactiveUsers()` | `users` | `getDocs()`, `deleteDoc()` | maintenance utilisateurs | Utilisateurs | global | utilisateurs inactifs |
| `js/storage.js` | `listOutCreationPoints()` | `pages/page2/items` | `getDocs()` | page utilisateurs | Utilisateurs | global | OUT créés |
| `js/storage.js` | `subscribeOutCreationPoints()` | `pages/page2/items` | `onSnapshot(collection)` | page utilisateurs | Utilisateurs | global listener | points OUT |
| `js/storage.js` | `deleteUser()` | `users/{userId}` | `getDoc()`, `deleteDoc()` | suppression utilisateur | Utilisateurs | ciblé doc | utilisateur |
| `js/storage.js` | `subscribeCurrentUserProfile()` | `users/{uid}` | `onSnapshot(doc)` | profil courant | Global | ciblé doc | utilisateur courant |
| `js/storage.js` | `subscribeUsers()` | `users` | `onSnapshot(collection)` | page utilisateurs | Utilisateurs | global listener | utilisateurs |
| `js/storage.js` | `subscribeMaintenanceState()` | `appSettings/maintenance` | `onSnapshot(doc)` | bannière/contrôle global | Global | ciblé doc | maintenance |
| `js/storage.js` | `hasReachedOutDeletionLimit()` | `users/{uid}/outDeletionLimits/{date}` | `getDoc()` | suppression OUT | Page 2 | ciblé doc | limite quotidienne |
| `js/storage.js` | `recordOutDeletionLimitUsage()` | `users/{uid}/outDeletionLimits/{date}` | `getDoc()`, `setDoc(..., merge)` | suppression OUT | Page 2 | ciblé doc | compteur suppressions |
| `js/storage.js` | `setSiteOutCount()` | `pages/page1/items/{siteId}` | `setDoc(..., merge)` | réconciliation compteur | Page 1/2/import | ciblé doc | `outCount` |
| `js/storage.js` | `incrementSiteOutCount()` | `pages/page1/items/{siteId}` | `updateDoc(increment)` ou `runTransaction().set(..., merge)` | création/suppression/restauration OUT | Page 2 | ciblé doc | `outCount` |
| `js/storage.js` | `reconcileSiteOutCounts()` | état local + sites | `setDoc(..., merge)` indirect | import/réconciliation manuelle | Page 1/2 | ciblé par sites | `outCount` |
| `js/storage.js` | `readPageItems(pageName)` | `pages/{pageName}/items` | `getDocs(collection)` | init/bootstrap | Page 1/materialCodes | global | items page demandée |
| `js/storage.js` | `readPage2ItemsBySite(siteId)` | `pages/page2/items` | `getDocs(query(where('siteId','==',siteId)))` | ouverture site/Page 2 | Page 2 | ciblé site | OUT du site |
| `js/storage.js` | `readMaterialCodes()` | `materialCodes` | `getDocs(collection)` | init/typeahead | Page 3 | global catalogue | codes matériels |
| `js/storage.js` | `bootstrapMaterialCodesFromDetails()` | `pages/page3/items`, `materialCodes/{code}` | `getDocs(page3 global)`, `setDoc(..., merge)` | uniquement si catalogue vide | Page 3/typeahead | global conditionnel | bootstrap codes |
| `js/storage.js` | `loadRemoteSnapshot()` | `pages/page1/items`, `materialCodes`, parfois `pages/page3/items` | `getDocs()` | init cache absent/expiré | démarrage | global | sites + catalogue |
| `js/storage.js` | `refreshSiteInactivityStates()` | `pages/page1/items/{siteId}` | `setDoc(..., merge)` | contrôle inactivité | Page 1 | ciblé doc | statut inactivité |
| `js/storage.js` | `restoreInactiveSite()` | `pages/page1/items/{siteId}` | `setDoc(..., merge)` | restauration site inactif | Page 1 | ciblé doc | champs inactivité |
| `js/storage.js` | `ensureMaterialCode()` | `materialCodes/{code}` | `setDoc(..., merge)` | création/modif détail | Page 3 | ciblé doc | code/désignation |
| `js/storage.js` | `readDetailsByQuery()` | `pages/page3/items` | `getDocs(query(...constraints))` | Page 2/Page 3 | Page 2/3 | ciblé selon contraintes | détails |
| `js/storage.js` | `ensureSiteDetailsLoaded(siteId)` | `pages/page3/items` | `where('siteId','==',siteId)` | compteurs/désignations/lignes Page 2 | Page 2 | ciblé site | détails du site |
| `js/storage.js` | `ensurePairDetailsLoaded(siteId,itemId)` | `pages/page3/items` | `where('siteId','==',siteId)` + `where('itemId','==',itemId)` | ouverture OUT/Page 3 | Page 3 | ciblé paire | détails OUT |
| `js/storage.js` | `createSite()` | `pages/page1/items` | `addDoc()` | création site | Page 1 | ajout collection | site |
| `js/storage.js` | `updateSiteName()` | `pages/page1/items/{siteId}` | `setDoc(..., merge)` | édition site | Page 1 | ciblé doc | nom/dateModification |
| `js/storage.js` | `updateSiteCreator()` | `pages/page1/items/{siteId}` | `setDoc(..., merge)` | changement créateur | Page 1/admin | ciblé doc | créateur |
| `js/storage.js` | `setSiteLock()` / `clearSiteLock()` | `pages/page1/items/{siteId}` | `setDoc(..., merge)` | verrouillage/déverrouillage | Page 1 | ciblé doc | verrou |
| `js/storage.js` | `isTrashEnabled()` | `appSettings/trash` | `getDoc()` | avant suppression/restauration | Global | ciblé doc | paramètre corbeille |
| `js/storage.js` | `purgeExpiredTrashEntries()` | `trash` | `getDocs()`, `deleteDoc()` | ouverture corbeille/listener | Corbeille | global | entrées expirées |
| `js/storage.js` | `addTrashEntry()` | `trash` | `addDoc()` | suppression site/OUT/détail | Global | ajout collection | snapshot supprimé |
| `js/storage.js` | `setTrashEnabled()` | `appSettings/trash` | `setDoc(..., merge)` | réglage corbeille | Corbeille | ciblé doc | config |
| `js/storage.js` | `subscribeTrashSettings()` | `appSettings/trash` | `onSnapshot(doc)` | page corbeille | Corbeille | ciblé doc listener | config |
| `js/storage.js` | `subscribeTrashEntries()` | `trash` | `onSnapshot(query(orderBy))` | page corbeille | Corbeille | global trié listener | corbeille |
| `js/storage.js` | `restoreTrashEntry()` | `trash/{entryId}` puis collections restaurées | `getDoc()`, `deleteDoc()`, `addDoc()`/`setDoc()` | restauration | Corbeille | ciblé entrée + ajouts | snapshot restauré |
| `js/storage.js` | `removeSite()` | `pages/page1/items/{siteId}`, `pages/page2/items/{itemId}`, `pages/page3/items/{detailId}` | `deleteDoc()` multiples | suppression site | Page 1 | ciblé par cache site | site/OUT/détails |
| `js/storage.js` | `createItem()` | `pages/page2/items`, `pages/page1/items/{siteId}` | `addDoc()`, `incrementSiteOutCount()`, parfois `setDoc(..., merge)` | création OUT | Page 2 | ajout + doc ciblé | OUT + compteur |
| `js/storage.js` | `updateItemName()` | `pages/page2/items/{itemId}` | `setDoc(..., merge)` | modification OUT | Page 2 | ciblé doc | numéro/dateModification |
| `js/storage.js` | `removeItem()` | `pages/page2/items/{itemId}`, `pages/page1/items/{siteId}` | `deleteDoc()`, `incrementSiteOutCount(-1)` | suppression OUT | Page 2 | ciblé doc | OUT + compteur |
| `js/storage.js` | `restoreSite()` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | `addDoc()` multiples | restauration corbeille site | Corbeille | ajouts | site/OUT/détails |
| `js/storage.js` | `restoreItem()` | `pages/page2/items`, `pages/page3/items`, site compteur | `addDoc()`, `incrementSiteOutCount(1)` | restauration OUT | Corbeille/Page 2 | ajouts + doc ciblé | OUT/détails |
| `js/storage.js` | `restoreDetail()` | `pages/page3/items` | `addDoc()` | restauration détail | Corbeille/Page 3 | ajout | détail |
| `js/storage.js` | `createDetail()` | `pages/page3/items`, `materialCodes/{code}` | `addDoc()`, `setDoc(..., merge)` | création détail | Page 3 | ajout + doc ciblé | détail + code |
| `js/storage.js` | `updateDetail()` | `pages/page3/items/{detailId}`, `materialCodes/{code}` | `updateDoc()`, `setDoc(..., merge)` | modification détail | Page 3 | ciblé doc | détail + code |
| `js/storage.js` | `removeDetail()` | `pages/page3/items/{detailId}` | `deleteDoc()` | suppression détail | Page 3 | ciblé doc | détail |
| `js/storage.js` | `appendHistoryEntry()` | `historiques`, `users/{uid}` | `addDoc()`, puis prune, activité | Global | ajout/global prune | historique |
| `js/storage.js` | `pruneHistoryEntries()` | `historiques` | `getDocs(query(orderBy))`, `deleteDoc()` | après historique | Global | global trié | historique >100 |
| `js/storage.js` | `listHistoriques()` | `historiques` | `getDocs(query(orderBy))` | page historique | Historique | global trié | historique |
| `js/storage.js` | `subscribeHistoriques()` | `historiques` | `onSnapshot(query(orderBy))` | page historique | Historique | global trié listener | historique |
| `js/storage.js` | `importData()` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | `addDoc()` multiples + réconciliation | import | Global | ajouts | données importées |
| `js/app.js` | achats matériels | `sites/{siteId}/achatsMateriels` | `addDoc()`, `getDocs(query(orderBy))`, `getDoc()`, `updateDoc()`, `deleteDoc()` | module achats Page 2 | Page 2 | ciblé site | achats matériels |
| `js/materiels.js` | demande matériels | `materialRequests` | `addDoc()` | formulaire demande | Matériels | ajout collection | demandes |
| `js/materiels.js` | bootstrap/search legacy | `pages/page3/items` | `getDocs(collection)` | init page matériels | Matériels | global | détails matériels |
| `users.html` | page utilisateurs inline | `users`, `pages/page2/items`, `adminMessages` | `setDoc()`, `addDoc()`, `onSnapshot()` | page utilisateurs | Utilisateurs | global listeners | utilisateurs/OUT/messages |
| `js/maintenance-banner.js` | bannière maintenance/messages | `users/{uid}`, `appSettings/maintenance`, `adminMessages` | `setDoc(..., merge)`, `onSnapshot(doc/query(orderBy,limit))` | bannière globale | Global | ciblé + global limité | profil/messages |

---

## 2. Audit du démarrage

### Ordre réel observé statiquement

```text
Application
↓
StorageService.init()
↓
state.initialized, authUser, userId, db
↓
parseOfflineState() localStorage
↓
si snapshot local présent : applySnapshot(snapshot)
↓
si cache absent ou expiré : loadRemoteSnapshot()
↓
readPageItems('page1') + readMaterialCodes() en parallèle
↓
si materialCodes vide : bootstrapMaterialCodesFromDetails() => readPageItems('page3') global + setDoc materialCodes
↓
applySnapshot(remote)
↓
persistOfflineState()
↓
listeners locaux alimentés par emit/applySnapshot
↓
affichage via abonnements locaux
```

| Étape | Fonction | Collection | Opération | Global/Ciblée | Pourquoi ? |
|---|---|---|---|---|---|
| 1 | `init()` | aucune | état local | n/a | initialise `state`, auth et DB |
| 2 | `parseOfflineState()` | aucune | `localStorage.getItem` | local | réhydrate cache local |
| 3 | `applySnapshot()` | aucune | mutation mémoire | local | affiche vite le cache si présent |
| 4 | `loadRemoteSnapshot()` | orchestration | `Promise.all` | n/a | uniquement si cache absent/expiré |
| 5 | `readPageItems('page1')` | `pages/page1/items` | `getDocs(collection)` | globale | charger tous les sites visibles côté état |
| 6 | `readMaterialCodes()` | `materialCodes` | `getDocs(collection)` | globale catalogue | charger le typeahead |
| 7 | `bootstrapMaterialCodesFromDetails()` | `pages/page3/items` | `getDocs(collection)` | globale conditionnelle | seulement si catalogue vide |
| 8 | `bootstrapMaterialCodesFromDetails()` | `materialCodes/{code}` | `setDoc(..., merge)` | ciblée par code | peupler le catalogue initial |
| 9 | `persistOfflineState()` | aucune | `localStorage.setItem` | local | cache 180 secondes |

### Réponse : combien de lectures Firestore au démarrage ?

- **Cache frais** : 0 lecture Firestore Page 1/Page 2/Page 3/materialCodes dans `StorageService.init()`.
- **Cache absent/expiré et `materialCodes` non vide** : 2 requêtes globales (`pages/page1/items`, `materialCodes`). Le nombre de lectures facturées dépend du nombre de documents retournés.
- **Cache absent/expiré et `materialCodes` vide** : 3 requêtes globales (`pages/page1/items`, `materialCodes`, puis `pages/page3/items` pour bootstrap). Le bootstrap peut aussi écrire dans `materialCodes`.
- **`pages/page2/items` au démarrage** : aucune lecture globale détectée dans `loadRemoteSnapshot()`.

---

## 3. Page 1 — audit complet

### Lecture

- Les sites sont chargés globalement via `readPageItems('page1')` au démarrage distant.
- Les compteurs affichés viennent de `subscribeItemCounts()`, qui parcourt `state.sites` et expose `normalizeOutCount(site.outCount)`.
- `getSiteOutCount(siteId)` lit aussi `site.outCount` en mémoire, sans requête Page 2.
- Recherche, filtres et tris Page 1 sont en mémoire après chargement des sites; aucune requête Firestore spécifique de recherche/tri Page 1 n'a été détectée.
- Les champs `dateCreation`, `createdBy`, `createdByName`, `ownerId`, `siteId`/`id` sont portés par les documents site et conservés en mémoire.

### Confirmation Page 1 / compteur

Page 1 **n'a plus besoin de charger globalement `pages/page2/items` pour calculer les compteurs** dans le flux principal. `loadRemoteSnapshot()` ne lit plus `page2`; `subscribeItemCounts()` utilise `site.outCount`.

### Écriture

- Création site : `createSite()` ajoute un document `pages/page1/items` avec `outCount: 0`, créateur, dates et propriétaire.
- Modification nom : `updateSiteName()` fait `setDoc(doc(...siteId), { nom, dateModification }, { merge: true })`; les autres champs ne sont pas remplacés.
- Créateur : `updateSiteCreator()` fait un `setDoc(..., merge)` limité aux champs créateur/propriétaire/date.
- Verrouillage/déverrouillage : `setSiteLock()` et `clearSiteLock()` font des écritures partielles avec `merge: true`; `deleteField()` supprime volontairement uniquement les champs de verrou.
- Inactivité : `refreshSiteInactivityStates()` et `restoreInactiveSite()` écrivent des champs ciblés avec `merge: true`.
- Suppression site : `removeSite()` supprime explicitement le site, ses OUT et ses détails après chargements ciblés par site; ce n'est pas une modification partielle mais une suppression volontaire.

### Risques Page 1

- La cohérence réelle du compteur n'est vérifiable qu'avec les données Firestore; statiquement, les chemins principaux maintiennent `outCount`, mais les mutations OUT + compteur ne sont pas atomiques de bout en bout.
- `reconcileSiteOutCounts()` dépend des OUT déjà présents en mémoire; si un site n'a jamais eu ses OUT chargés dans la session, la réconciliation ciblée peut être incomplète hors flux import où les nouveaux items sont ajoutés en mémoire.

---

## 4. Page 2 — audit complet

### Lecture ciblée par site

La requête exacte de chargement Page 2 est :

```js
getDocs(query(makePageItemsCollection('page2'), where('siteId', '==', normalizedSiteId)))
```

Elle est appelée par `ensureSiteItemsLoaded(siteId)`, qui :

1. normalise `siteId`;
2. abandonne si `loadedItemSites` contient déjà ce site;
3. initialise temporairement `state.itemsBySite.set(siteId, [])` et émet pour éviter d'afficher l'ancien site;
4. lit uniquement les OUT du site;
5. fusionne via `mergeSiteItems()`, qui filtre encore `item.siteId === normalizedSiteId`.

### Changement de site / cache / retour

- Site A puis site B : `itemsBySite` est indexé par `siteId`; `subscribeItems(siteId)` s'abonne à une clé par site. L'état de B est vide tant que B n'est pas chargé, donc A ne doit pas s'afficher pour B.
- Retour sur site déjà consulté : `loadedItemSites` évite une nouvelle lecture tant que le cache mémoire est présent.
- Cache local : `persistOfflineState()` stocke les OUT déjà chargés; `applySnapshot()` marque chargés seulement les sites présents dans `page2` du cache.
- Recherche/filtres/tri Page 2 : réalisés sur le tableau local du site, sans lecture Firestore additionnelle détectée.
- Pagination : aucun `limit()`/`startAfter()` Page 2 détecté; le chargement ciblé lit tous les OUT du site.

### Création OUT

- `createItem(siteId, numberValue, options)` force `ensureSiteItemsLoaded(siteId)` avant validation doublon.
- Le document créé contient `siteId`, `numero`, `magasin`, créateur, propriétaire, dates.
- Après `addDoc(page2)`, `incrementSiteOutCount(siteId, 1)` met à jour `site.outCount`.
- Doublons : contrôlés en mémoire par site après chargement ciblé.
- Concurrence : `increment()` est atomique côté Firestore pour l'incrément, mais `addDoc()` et l'incrément ne sont pas dans un batch/transaction commune; échec intermédiaire possible.

### Modification OUT

- `updateItemName()` met à jour uniquement `numero` et `dateModification` avec `setDoc(..., merge)`.
- Aucun changement de `siteId` n'a été détecté dans cette fonction; donc pas d'impact `outCount` à gérer pour déplacement de site.

### Suppression OUT

- `removeItem()` charge d'abord les OUT du site ciblé, vérifie les permissions/limites, écrit éventuellement la corbeille, supprime `pages/page2/items/{itemId}`, puis appelle `incrementSiteOutCount(siteId, -1)`.
- Protection compteur négatif : pour un delta négatif, `incrementSiteOutCount()` utilise une transaction qui lit le site et écrit `outCount = Math.max(0, current + delta)` avec merge.
- Les détails de l'OUT ne sont pas supprimés de Firestore par `removeItem()`; ils sont retirés du cache local et éventuellement sauvegardés dans la corbeille s'ils étaient déjà chargés. C'est un point à vérifier fonctionnellement selon l'intention métier.

### Import / restauration

- `importData()` ajoute sites, OUT, détails puis appelle `reconcileSiteOutCounts()` sur les sites ajoutés/impactés.
- `restoreSite()` restaure un site avec `outCount` égal au nombre d'items du snapshot, puis ajoute OUT/détails remappés.
- `restoreItem()` ajoute l'OUT puis incrémente `outCount` de 1.
- Risque : ces flux n'utilisent pas un batch atomique unique; une restauration/import interrompu peut laisser un état partiel.

---

## 5. Page 3 — audit complet

### Lecture ciblée `siteId + itemId`

- `subscribeDetails(siteId, itemId)` lit d'abord le cache `detailsByItem.get(`${siteId}:${itemId}`)` puis appelle `ensurePairDetailsLoaded(siteId, itemId)`.
- `ensurePairDetailsLoaded()` ne lit Firestore que si la paire n'est pas déjà chargée et si tout le site n'a pas déjà été chargé.
- La requête exacte est `readDetailsByQuery(where('siteId', '==', String(siteId)), where('itemId', '==', String(itemId)))`.
- `readDetailsByQuery()` exécute `getDocs(query(makePageItemsCollection('page3'), ...constraints))`.

### Lectures Page 3 globales

Aucune lecture globale `pages/page3/items` n'est détectée dans le flux Page 3 principal. Les exceptions sont :

1. `bootstrapMaterialCodesFromDetails()` dans `js/storage.js`, uniquement si `materialCodes` est vide pendant `loadRemoteSnapshot()`;
2. `js/materiels.js` lit globalement `pages/page3/items` dans son module matériels, hors Page 3 principale.

### Création/modification/suppression

- Création détail : `createDetail()` ajoute `siteId`, `itemId`, champs métier, propriétaire, dates; puis appelle `ensureMaterialCode()`.
- Modification détail : `updateDetail()` fait `updateDoc(pages/page3/items/{detailId}, syncedChanges)` uniquement sur les champs modifiés + `dateModification`; puis met à jour `materialCodes` si code/désignation change.
- Suppression détail : `removeDetail()` supprime `pages/page3/items/{detailId}` et ajoute éventuellement une entrée corbeille.
- Import/restauration : `importData()`, `restoreSite()`, `restoreItem()`, `restoreDetail()` recréent les détails avec `siteId`/`itemId` remappés si nécessaire.

---

## 6. Typeahead / `materialCodes`

| Aspect | Constats |
|---|---|
| Lecture | `readMaterialCodes()` lit globalement la petite collection catalogue `materialCodes`. |
| Écriture | `ensureMaterialCode()` écrit `materialCodes/{materialCodeDocId(code)}` avec `setDoc(..., merge)`. |
| Création code | À la création/modification de détail, un code absent est ajouté au catalogue. |
| Déduplication | La clé de déduplication est `sanitizeText(code).toLowerCase()`, et l'id encode cette clé. |
| Casse | La casse du code affiché est conservée dans `entry.code`, mais la comparaison est insensible à la casse. |
| Désignation | Si un code existe sans désignation et qu'une désignation arrive, elle est complétée. |
| Suggestions | `getMaterialCodes()` retourne le cache mémoire trié; pas de lecture répétée si `state.materialCodes` est déjà chargé. |
| Bootstrap | Si `materialCodes` est vide au démarrage distant, `bootstrapMaterialCodesFromDetails()` lit globalement `pages/page3/items` et peuple le catalogue. |
| Risque | Le bootstrap global est la principale lecture Page 3 potentiellement coûteuse restante; il est conditionnel. |

---

## 7. `outCount` — cohérence

### Tableau demandé

Aucune donnée Firestore réelle n'a été lue pendant cet audit. La cohérence document par document ne peut donc pas être mesurée. Tableau statique :

| Site | siteId | outCount | OUT réel | Écart | Statut |
|---|---|---:|---:|---:|---|
| Non mesuré | Non mesuré | n/a | n/a | n/a | Limite audit statique |

### Scénarios de cohérence

| Scénario | Maintenance `outCount` | Risque |
|---|---|---|
| Création OUT | `addDoc(page2)` puis `incrementSiteOutCount(+1)` | non atomique entre création et compteur |
| Suppression OUT | `deleteDoc(page2)` puis `incrementSiteOutCount(-1)` | non atomique, mais décrément borné à 0 par transaction |
| Modification OUT | pas de changement `siteId`; pas de compteur | correct si pas de déplacement de site |
| Import | ajoute données puis `reconcileSiteOutCounts()` | état partiel possible si échec avant fin |
| Restauration site | `outCount` fixé au nombre d'items snapshot | cohérent dans le payload restauré |
| Restauration OUT | `addDoc(page2)` puis `incrementSiteOutCount(+1)` | non atomique |
| Suppression multiple site | supprime détails/OUT/site après chargement ciblé | pas de compteur nécessaire car site supprimé |

---

## 8. Cache

| Données | Emplacement | Durée | Invalidation/réhydratation | Risques |
|---|---|---:|---|---|
| Page 1 sites | `state.sites` + `localStorage` | 180 s | `loadRemoteSnapshot()` si cache expiré | sites obsolètes pendant TTL |
| Page 2 OUT | `state.itemsBySite` par `siteId` + cache | 180 s | `ensureSiteItemsLoaded(siteId)` si site non chargé | pas de refresh Firestore si déjà chargé en mémoire |
| Page 3 détails | `state.detailsByItem` par `siteId:itemId` + cache | 180 s | `ensurePairDetailsLoaded` ou `ensureSiteDetailsLoaded` | détails obsolètes si autre client modifie |
| `materialCodes` | `state.materialCodes` + cache | 180 s | init distant si cache absent/expiré | catalogue obsolète pendant TTL |

Le risque A/B est mitigé par les Maps indexées par `siteId` et par l'initialisation à `[]` avant lecture de B. Un cache frais n'entraîne pas de lecture globale dans `init()`.

---

## 9. Listeners / temps réel

| Listener | Collection | Requête | Global/Ciblée | Déclencheur | Utilisateur |
|---|---|---|---|---|---|
| `subscribeOutCreationPoints()` | `pages/page2/items` | collection entière | global | page utilisateurs | admin/utilisateurs |
| `subscribeCurrentUserProfile()` | `users/{uid}` | doc | ciblé | profil courant | utilisateur connecté |
| `subscribeUsers()` | `users` | collection entière | global | page utilisateurs | admin |
| `subscribeMaintenanceState()` | `appSettings/maintenance` | doc | ciblé | état maintenance | global |
| `subscribeTrashSettings()` | `appSettings/trash` | doc | ciblé | page corbeille | admin |
| `subscribeTrashEntries()` | `trash` | `orderBy('deletedAtIso','desc')` | global trié | page corbeille | admin |
| `subscribeHistoriques()` | `historiques` | `orderBy('createdAt','desc')` | global trié | page historique | admin/utilisateurs autorisés |
| `users.html` inline users | `users` | collection entière | global | page utilisateurs HTML | admin |
| `users.html` inline outs | `pages/page2/items` | collection entière | global | page utilisateurs HTML | admin |
| `maintenance-banner.js` user profile | `users/{uid}` | doc | ciblé | bannière messages | utilisateur |
| `maintenance-banner.js` maintenance | `appSettings/maintenance` | doc | ciblé | bannière maintenance | global |
| `maintenance-banner.js` messages | `adminMessages` | `orderBy('createdAt','desc'), limit(20)` | global limité | bannière messages | utilisateur |

Les abonnements Page 1/Page 2/Page 3 (`subscribeSites`, `subscribeItems`, `subscribeDetails`, etc.) sont des listeners locaux en mémoire, pas des `onSnapshot()` Firestore.

---

## 10. Firestore reads — analyse des lectures

| Page | Fonction | Collection | Lecture | Global/Ciblée | Déclencheur | Risque |
|---|---|---|---|---|---|---|
| Démarrage/Page 1 | `readPageItems('page1')` | `pages/page1/items` | tous sites | globale | cache absent/expiré | 🟡 nécessaire mais améliorable selon volume |
| Démarrage/Page 3 | `readMaterialCodes()` | `materialCodes` | catalogue complet | globale | cache absent/expiré | 🟡 acceptable si catalogue petit |
| Démarrage/typeahead | `bootstrapMaterialCodesFromDetails()` | `pages/page3/items` | tous détails | globale conditionnelle | catalogue vide | 🔴 lecture globale problématique si gros volume |
| Page 2 | `readPage2ItemsBySite()` | `pages/page2/items` | OUT du site | ciblée `siteId` | ouverture site | 🟢 nécessaire et ciblée |
| Page 2 agrégats | `ensureSiteDetailsLoaded()` | `pages/page3/items` | détails du site | ciblée `siteId` | compteurs/désignations/lignes | 🟡 nécessaire mais peut être volumineux |
| Page 3 | `ensurePairDetailsLoaded()` | `pages/page3/items` | détails OUT | ciblée `siteId+itemId` | ouverture OUT | 🟢 nécessaire et ciblée |
| Suppression OUT | `hasReachedOutDeletionLimit()` | sous-doc limite | limite du jour | ciblée doc | suppression OUT | 🟢 nécessaire |
| Corbeille | `isTrashEnabled()` | `appSettings/trash` | config | ciblée doc | suppression/restauration | 🟢 nécessaire |
| Corbeille | `purgeExpiredTrashEntries()` | `trash` | toutes entrées | globale | page corbeille | 🟠 potentiellement coûteux |
| Historique | `pruneHistoryEntries()` | `historiques` | tout trié | globale triée | après chaque historique | 🟠 répétée/potentiellement inutile |
| Utilisateurs | `listUsers()`/`subscribeUsers()` | `users` | tous utilisateurs | globale | page utilisateurs | 🟡 selon rôle/volume |
| Utilisateurs | `listOutCreationPoints()` | `pages/page2/items` | tous OUT | globale | page utilisateurs | 🔴 global hors flux Page 2 |
| Achats Page 2 | module achats | `sites/{siteId}/achatsMateriels` | achats du site | ciblée site + orderBy | section achats | 🟢 ciblée |
| Matériels | `js/materiels.js` | `pages/page3/items` | tous détails | globale | page matériels | 🔴 globale hors Page 3 |

---

## 11. Firestore writes — analyse des écritures

| Type | Fonctions | Collections | Analyse |
|---|---|---|---|
| Création site | `createSite()`, `restoreSite()`, `importData()` | `pages/page1/items` | inclut `outCount`; non batché avec enfants |
| Modification site | `updateSiteName()`, `updateSiteCreator()`, locks, inactivité | `pages/page1/items/{siteId}` | écritures partielles, champs existants préservés sauf `deleteField()` volontaire |
| Suppression site | `removeSite()` | page1/page2/page3 | ciblée par site chargé; suppression multi-doc non batchée |
| Création OUT | `createItem()`, restore/import | `pages/page2/items` + site `outCount` | compteur maintenu, non atomique de bout en bout |
| Modification OUT | `updateItemName()` | `pages/page2/items/{itemId}` | partielle, pas de déplacement site |
| Suppression OUT | `removeItem()` | `pages/page2/items/{itemId}` + site `outCount` | décrément borné à 0 par transaction, non batché avec delete |
| Création détail | `createDetail()` | `pages/page3/items`, `materialCodes` | ajoute code catalogue si besoin |
| Modification détail | `updateDetail()` | `pages/page3/items/{detailId}`, `materialCodes` | ciblée, partielle via `updateDoc()` |
| Suppression détail | `removeDetail()` | `pages/page3/items/{detailId}` | ciblée |
| Historique | `appendHistoryEntry()`, `pruneHistoryEntries()` | `historiques` | prune global après écriture; attention syntaxe doublon `const profile` |
| Corbeille | `addTrashEntry()`, `restoreTrashEntry()` | `trash` + collections restaurées | snapshot utile; restauration non atomique |

---

## 12. Analyse par scénario utilisateur

| Scénario | Lectures | Écritures | Listeners | Cache/données chargées |
|---|---|---|---|---|
| A Lancement | 0 si cache frais; sinon page1 + materialCodes; page3 si bootstrap | bootstrap materialCodes seulement si vide | aucun Firestore Page 1/2/3 | réhydratation localStorage puis remote si expiré |
| B Ouverture Page 1 | sites en mémoire | éventuelle activité/historique selon action | local `subscribeSites`, `subscribeItemCounts` | sites + `outCount` |
| C Recherche site | aucune Firestore | historique possible si enregistré | locaux | filtrage mémoire |
| D Ouverture site | `pages/page2/items where siteId` si non chargé; détails site si compteurs/désignations demandés | historique éventuel | local par site | OUT du site uniquement |
| E Recherche OUT | aucune si OUT du site déjà chargés | historique possible | local | filtrage mémoire des OUT du site |
| F Ouverture OUT | `pages/page3/items where siteId + itemId` si paire non chargée | historique éventuel | local paire | détails OUT uniquement |
| G Création OUT | ensure OUT site si non chargé | `addDoc(page2)`, `incrementSiteOutCount(+1)`, historique, activité | locaux | cache site mis à jour |
| H Modification OUT | aucune lecture si item en mémoire | `setDoc(page2/{itemId}, merge)`, historique | locaux | cache item mis à jour |
| I Suppression OUT | ensure OUT site; profil; limite; trash config | trash éventuel, `deleteDoc(page2)`, décrément outCount, historique, limite | locaux | cache item supprimé |
| J Import | aucune lecture Firestore principale; dépend du fichier local | `addDoc` pages 1/2/3, réconciliation outCount | locaux | cache enrichi |
| K Restauration | `getDoc(trash/{entryId})`; éventuellement trash config/listener | addDoc/setDoc/deleteDoc selon type | corbeille si ouverte | cache restauré |
| L Retour site consulté | aucune si `loadedItemSites` contient site | aucune | locaux | données mémoire/cachées |

---

## 13. Comparaison avant / après

### Avant documenté

```text
Page 1
↓
lecture globale Page 2
↓
compteurs
↓
Page 2
↓
lecture globale Page 3
↓
Page 3
```

### Après vérifié dans le code

```text
Lancement
↓
Page 1 globale + outCount depuis sites, materialCodes globale catalogue
↓
clic site
↓
Page 2 ciblée par where('siteId', '==', siteId)
↓
clic OUT
↓
Page 3 ciblée par where('siteId', '==', siteId) + where('itemId', '==', itemId)
```

Cette représentation correspond au flux principal actuel, avec deux réserves :

1. Page 2 peut déclencher `ensureSiteDetailsLoaded(siteId)` pour des informations de détails, mais cette lecture reste ciblée par site.
2. `bootstrapMaterialCodesFromDetails()` peut encore lire globalement Page 3 si `materialCodes` est vide.

---

## 14. Recherche de lectures inutiles

| Priorité | Fichier | Fonction | Problème | Impact | Solution possible |
|---|---|---|---|---|---|
| 🔴 critique | `js/storage.js` | `bootstrapMaterialCodesFromDetails()` | lecture globale `pages/page3/items` si catalogue vide | coûteux sur gros historique | migration/outillage séparé ou bootstrap paginé/ciblé |
| 🔴 critique | `js/materiels.js` | init matériels | lecture globale `pages/page3/items` | hors optimisation Page 3 | utiliser `materialCodes` ou requêtes ciblées |
| 🟠 importante | `js/storage.js` | `listOutCreationPoints()`/`subscribeOutCreationPoints()` | lecture/listener global Page 2 page utilisateurs | coûts selon volume OUT | agréger par utilisateur ou limiter/paginer |
| 🟠 importante | `js/storage.js` | `pruneHistoryEntries()` | relit tout l'historique après chaque action | lectures répétées | requête limitée/pagination ou maintenance planifiée |
| 🟠 importante | `js/storage.js` | `subscribeTrashEntries()` | listener global corbeille | coût si beaucoup d'entrées | limiter/paginer/filtrer |
| 🟡 optimisation | `js/storage.js` | `readMaterialCodes()` | catalogue global | acceptable si petit | recherche préfixe/index si gros catalogue |
| 🟢 déjà optimisé | `js/storage.js` | `readPage2ItemsBySite()` | Page 2 ciblée par site | réduit lectures Page 2 | conserver |
| 🟢 déjà optimisé | `js/storage.js` | `ensurePairDetailsLoaded()` | Page 3 ciblée par site+OUT | réduit lectures Page 3 | conserver |

---

## 15. Risques de régression

- **Données site/date/créateur** : les mises à jour courantes sont partielles et préservent les champs existants. Risque limité.
- **`outCount`** : risque de désynchronisation si une opération OUT réussit et l'écriture compteur échoue, ou inversement.
- **OUT Page 2** : le filtrage par `siteId` protège contre l'affichage inter-site; attention aux documents historiques sans `siteId`, qui ne seront plus visibles dans Page 2 ciblée.
- **Détails Page 3** : les documents historiques sans `siteId` ou `itemId` ne seront pas récupérés par la requête ciblée.
- **Typeahead** : dépend de `materialCodes`; si le bootstrap est désactivé un jour sans migration, certains anciens codes peuvent manquer.
- **Cache** : TTL de 180 s peut afficher des données obsolètes en absence de listeners Firestore Page 1/2/3.
- **Import/restauration/suppression** : flux multi-doc non atomiques; état partiel possible en cas d'erreur réseau.
- **Historique** : la fonction ajoute puis prune l'historique; le pruning relit globalement la collection triée après les écritures d'historique.
- **Permissions** : plusieurs vérifications reposent sur profil courant et rôle normalisé; audit statique uniquement.

---

## 16. Validation du code

Vérifications non destructives effectuées :

- Recherche statique des APIs Firestore avec `rg`.
- Inspection des fonctions Firestore clés avec `sed`.
- Vérification Git des changements locaux avec `git status`.
- Vérification syntaxique JavaScript par compilation Node sur les fichiers locaux lorsque possible.

Résultat notable : les vérifications syntaxiques `node --check` réalisées sur les fichiers JavaScript inspectés passent.

---

## 17. Limites de l'audit

- Audit statique uniquement : aucune session navigateur authentifiée n'a été lancée.
- Aucun environnement Firestore de test n'a été utilisé.
- Aucune donnée de production n'a été lue; les nombres exacts de lectures facturées et la table réelle `outCount` vs OUT réel ne peuvent pas être mesurés.
- Les règles Firestore, index et permissions serveur n'ont pas été validés dynamiquement.
- Les tests automatisés éventuels ne prouvent pas la cohérence des données Firestore réelles sans fixtures/émulateur dédié.
- Une vérification statique ne garantit pas l'absence de double déclenchement UI dans le navigateur réel.

---

# VERDICT GÉNÉRAL

🟡 **FONCTIONNEMENT CORRECT AVEC OPTIMISATIONS RESTANTES**

### Page 1

- **État** : architecture principale correcte.
- **Lectures** : lecture globale des sites au démarrage distant; pas de lecture globale Page 2 pour compteurs.
- **Écritures** : créations et modifications majoritairement partielles; `outCount` initialisé/maintenu.
- **Problèmes** : cohérence réelle `outCount` non vérifiée sans données; opérations multi-doc non atomiques.

### Page 2

- **État** : chargement ciblé par `siteId` vérifié.
- **Lectures** : `where('siteId', '==', siteId)`; cache par site; pas d'affichage inter-site attendu.
- **Écritures** : création/suppression maintiennent `outCount`; modification OUT partielle.
- **Problèmes** : création/suppression OUT + compteur non atomiques de bout en bout; suppression OUT ne supprime pas forcément les détails Firestore si non chargés, à confirmer métier.

### Page 3

- **État** : optimisation `siteId + itemId` intacte dans le flux principal.
- **Lectures** : détails OUT ciblés par deux `where`; détails site ciblés par `siteId` pour agrégats Page 2.
- **Écritures** : détails créés/modifiés/supprimés par document ciblé; `materialCodes` maintenu.
- **Problèmes** : bootstrap conditionnel global `pages/page3/items` si `materialCodes` vide; lecture globale distincte dans `js/materiels.js`.

### Firestore global

- **Lectures globales restantes** : `pages/page1/items`, `materialCodes`, `pages/page3/items` conditionnel bootstrap, `pages/page2/items` page utilisateurs, `trash`, `historiques`, `users`, `adminMessages` limité, `js/materiels.js` Page 3 globale.
- **Listeners globaux** : utilisateurs, points OUT utilisateurs, corbeille, historiques, messages admin limités.
- **Lectures potentiellement inutiles** : prune historique après chaque action, bootstrap materialCodes depuis détails, page matériels globale.
- **Optimisations possibles** : atomicité batch/transaction pour OUT+`outCount`, pagination/limites sur historiques/corbeille/users, suppression du bootstrap global après migration complète du catalogue.
