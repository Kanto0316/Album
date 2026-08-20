# Audit Firestore après optimisation

Date de l'audit : 2026-08-20.

Cet audit est basé sur le code réellement présent dans le dépôt après optimisation. Les fichiers principalement analysés sont `js/storage.js`, `js/app.js`, `js/materiels.js`, `js/maintenance-banner.js`, `users.html` et le document antérieur `FIRESTORE_GLOBAL.md`.

## 1. Inventaire des collections

| Collection | Fonction | Données stockées observées | Pages / modules utilisateurs | Lecture | Écriture | Realtime |
|---|---|---|---|---|---|---|
| `pages/page1/items` | Sites | Sites, nom, créateur/propriétaire, dates, verrouillage, inactivité | Page 1, Page 2, Page 3, import/export, corbeille | Oui, `getDocs()` global via `readPageItems('page1')` | Oui, création/modification/suppression/restauration/import, verrouillage, inactivité | Non Firestore direct dans `StorageService`; abonnements locaux |
| `pages/page2/items` | OUT | OUT par site, `siteId`, numéro, magasin, créateur/propriétaire, dates | Page 1 compteurs, Page 2 liste OUT, Page 3 contexte OUT, utilisateurs points OUT, import/export, corbeille | Oui, `getDocs()` global via `readPageItems('page2')`; `onSnapshot()` global pour points utilisateurs | Oui, création/modification/suppression/restauration/import | Oui uniquement pour points utilisateurs (`users.html` et `StorageService.subscribeOutCreationPoints`) |
| `pages/page3/items` | Détails/articles OUT | Détails avec `siteId`, `itemId`, code, désignation, quantités, unité, statut, dates | Page 2 recherche/filtres/compteurs, Page 3 tableau détails, demande matériels, import/export, corbeille | Oui, ciblé par `siteId` ou couple `siteId` + `itemId`; global seulement fallback bootstrap `materialCodes` et page `materiels.html` | Oui, création/modification/suppression/restauration/import | Non Firestore direct dans `StorageService`; abonnements locaux |
| `materialCodes` | Catalogue auxiliaire du typeahead | Documents par code normalisé : `code`, `designation` | Page 3 typeahead | Oui, `getDocs()` global | Oui, `setDoc(..., merge: true)` lors bootstrap, création ou mise à jour de détail | Non |
| `users` | Profils et droits utilisateurs | Profil, rôle, accès maintenance, activité, avatar, nom utilisateur, messages lus | Toutes pages via profil courant, utilisateurs, maintenance-banner | Oui, `getDoc()`, `getDocs()`, `onSnapshot()` | Oui, création/mise à jour profil, rôle, accès, activité, suppression/restauration | Oui |
| `users/{userId}/outDeletionLimits` | Limite de suppression OUT | Compteur journalier de suppressions OUT | Suppression OUT | Oui, `getDoc()` | Oui, `setDoc()` | Non |
| `historiques` | Historique applicatif | Action, utilisateur, site, date serveur | Historique, actions principales | Oui, `getDocs(query(orderBy))`, `onSnapshot(query(orderBy))` | Oui, `addDoc()` et purge `deleteDoc()` | Oui |
| `trash` | Corbeille applicative | Élément supprimé, payload original, date, utilisateur | Corbeille, suppressions/restaurations | Oui, `getDocs()`, `getDoc()`, `onSnapshot(query(orderBy))` | Oui, `addDoc()`, `deleteDoc()` | Oui |
| `appSettings/maintenance` | Paramètre maintenance | `enabled`, dates | Maintenance-banner, paramètres | Oui, `getDoc()`, `onSnapshot(doc)` | Oui, `setDoc()` | Oui |
| `appSettings/trash` | Paramètre corbeille | `enabled`, `updatedAt` | Corbeille, suppressions | Oui, `getDoc()`, `onSnapshot(doc)` | Oui, `setDoc()` | Oui |
| `adminMessages` | Messages administrateur | Message, destinataire, expéditeur, date | Utilisateurs, maintenance-banner | Oui, `onSnapshot(query(orderBy, limit))` | Oui, `addDoc()` | Oui |
| `sites/{siteId}/achatsMateriels` | Achats matériels par site | Achats, articles, fournisseur, dates, statut | Page 2 achats, détail achat | Oui, `getDocs(query(orderBy))`, `getDoc()` document précis | Oui, `addDoc()`, `updateDoc()`, `deleteDoc()` | Non |
| `materialRequests` | Demandes matériels | Demandes envoyées depuis la page matériels | `materiels.html` | Non observé | Oui, `addDoc()` | Non |

## 2. Inventaire des lectures Firestore

| Statut | Fichier | Fonction / zone | Collection | Déclencheur et fréquence | Données récupérées | Filtrage | Global / ciblé | Nécessité |
|---|---|---|---|---|---|---|---|---|
| 🟡 À surveiller | `js/storage.js` | `isUsernameDuplicate()` | `users` | Changement / validation de nom utilisateur | Tous les profils utilisateurs | Aucun | Globale | Nécessaire fonctionnellement, mais pourrait être optimisée par requête `where` sur username normalisé. |
| 🟢 Optimisée | `js/storage.js` | `ensureCurrentUser()` | `users/{uid}` | Initialisation profil utilisateur | Profil courant | Document id | Ciblée | Nécessaire. |
| 🟢 Optimisée | `js/storage.js` | `getCurrentUserProfile()` / fonctions profil | `users/{uid}` | Besoin profil courant | Profil courant | Document id | Ciblée | Nécessaire. |
| 🟡 À surveiller | `js/storage.js` | `listUsers()` | `users` | Page utilisateurs / administration | Tous les utilisateurs | Aucun | Globale | Nécessaire à l'administration mais global. |
| 🟡 À surveiller | `js/storage.js` | `listOutCreationPoints()` | `pages/page2/items` | Calcul des points OUT utilisateurs | Tous les OUT | Aucun | Globale | Nécessaire pour points globaux mais coûteux si beaucoup d'OUT. |
| 🟢 Optimisée | `js/storage.js` | `readPageItems('page1')` via `loadRemoteSnapshot()` | `pages/page1/items` | `StorageService.init()` si cache absent/expiré | Tous les sites | Aucun | Globale | Nécessaire pour Page 1. |
| 🟡 À surveiller | `js/storage.js` | `readPageItems('page2')` via `loadRemoteSnapshot()` | `pages/page2/items` | `StorageService.init()` si cache absent/expiré | Tous les OUT | Aucun | Globale | L'optimisation demandée pour Page 2 n'est pas complète : chargement initial global conservé. |
| 🟢 Optimisée | `js/storage.js` | `readMaterialCodes()` | `materialCodes` | Init ou typeahead si catalogue absent | Catalogue code/désignation | Aucun | Globale catalogue | Nécessaire au typeahead indépendant. |
| 🟡 À surveiller | `js/storage.js` | `bootstrapMaterialCodesFromDetails()` | `pages/page3/items` | Seulement si `materialCodes` est vide | Tous les détails pour amorcer le catalogue | Aucun | Globale fallback | Utile migration, mais très coûteux et écrit dans `materialCodes`. |
| 🟢 Optimisée | `js/storage.js` | `ensureSiteDetailsLoaded(siteId)` | `pages/page3/items` | Page 2 : compteurs, désignations, filtres ou recherche par site | Détails du site courant | `where('siteId', '==', siteId)` | Ciblée site | Nécessaire aux fonctions Page 2. |
| 🟢 Optimisée | `js/storage.js` | `ensurePairDetailsLoaded(siteId, itemId)` | `pages/page3/items` | Page 3 : abonnement détails de l'OUT courant | Détails du couple site/OUT | `where('siteId','==',siteId)`, `where('itemId','==',itemId)` | Ciblée couple | Nécessaire au tableau Page 3. |
| 🟢 Optimisée | `js/storage.js` | `isTrashEnabled()` | `appSettings/trash` | Suppression site/OUT/détail | Paramètre corbeille | Document id | Ciblée | Nécessaire. |
| 🟡 À surveiller | `js/storage.js` | `purgeExpiredTrashEntries()` | `trash` | Avant abonnement corbeille | Toutes les entrées corbeille | Aucun | Globale | Nécessaire pour purge, mais sans limite. |
| 🟢 Optimisée | `js/storage.js` | `restoreTrashEntry()` | `trash/{entryId}` | Restauration corbeille | Une entrée | Document id | Ciblée | Nécessaire. |
| 🟡 À surveiller | `js/storage.js` | `pruneHistoryEntries()` | `historiques` | Après ajout historique | Historique complet trié | `orderBy('createdAt','desc')` | Globale triée | Nécessaire à la purge, mais sans `limit`; lit tout l'historique. |
| 🟡 À surveiller | `js/storage.js` | `listHistoriques()` | `historiques` | Page historique | Historique complet trié | `orderBy('createdAt','desc')` | Globale triée | Nécessaire pour affichage complet; peut devenir lourd. |
| 🟢 Optimisée | `js/storage.js` | `hasReachedOutDeletionLimit()` | `users/{uid}/outDeletionLimits/{date}` | Suppression OUT limitée | Compteur du jour | Document id | Ciblée | Nécessaire. |
| 🟢 Optimisée | `js/storage.js` | `recordOutDeletionLimitUsage()` | `users/{uid}/outDeletionLimits/{date}` | Après suppression OUT limitée | Compteur du jour | Document id | Ciblée | Nécessaire. |
| 🟢 Optimisée | `js/app.js` | `loadPurchasesForCurrentSite()` | `sites/{siteId}/achatsMateriels` | Page 2 du site | Achats du site courant | Sous-collection site + `orderBy('createdAt','desc')` | Ciblée site | Nécessaire. |
| 🟢 Optimisée | `js/app.js` | détail achat | `sites/{siteId}/achatsMateriels/{purchaseId}` | Page détail achat | Achat précis | Document id | Ciblée | Nécessaire. |
| 🔴 Inutile / excessive | `js/materiels.js` | `loadAllMaterials()` | `pages/page3/items` | Chargement page demande matériels | Tous les détails puis déduplication code | Aucun | Globale | Incohérent avec la séparation `materialCodes`; cette page devrait probablement lire `materialCodes`. |
| 🟡 À surveiller | `users.html` | listener inline utilisateurs | `users` | Ouverture page utilisateurs | Tous les utilisateurs en temps réel | Aucun | Globale | Nécessaire à l'administration, mais doublonne en partie `StorageService`. |
| 🟡 À surveiller | `users.html` | listener inline points OUT | `pages/page2/items` | Ouverture page utilisateurs | Tous les OUT en temps réel | Aucun | Globale | Nécessaire aux points globaux, mais coûteux et doublonné conceptuellement. |
| 🟢 Optimisée | `js/maintenance-banner.js` | profil utilisateur courant | `users/{uid}` | Auth utilisateur | Profil courant en temps réel | Document id | Ciblée | Nécessaire. |
| 🟢 Optimisée | `js/maintenance-banner.js` | maintenance | `appSettings/maintenance` | Toutes pages avec bannière | État maintenance | Document id | Ciblée | Nécessaire. |
| 🟢 Optimisée | `js/maintenance-banner.js` | messages utilisateur récents | `adminMessages` | Toutes pages avec bannière | Messages récents | `orderBy('createdAt','desc')`, `limit(20)` | Globale limitée | Nécessaire et bornée. |

Nombre exact de lectures : Non déterminable statiquement.

## 3. Inventaire des écritures Firestore

| Fichier | Fonction / zone | Collection | Déclencheur | Données écrites | Fréquence | Raison |
|---|---|---|---|---|---|---|
| `js/storage.js` | `ensureCurrentUser()` | `users/{uid}` | Connexion/init si profil absent | Profil utilisateur par défaut | Par utilisateur absent | Créer le profil applicatif. |
| `js/storage.js` | `recordCurrentUserActivity()` | `users/{uid}` | Actions historisées / activité | `lastActivity`, `updatedAt` | Plusieurs actions | Tracer activité. |
| `js/storage.js` | `saveUsername()`, `changeUsername()`, avatar/rôle/maintenance | `users/{uid}` | Paramètres / administration | Nom, avatar, rôle, accès | À la demande | Gestion utilisateur. |
| `js/storage.js` | `deleteUser()` | `users/{uid}` | Suppression utilisateur | Suppression document | À la demande | Administration/corbeille. |
| `users.html` | `syncDefaults()` et actions admin | `users/{uid}` | Page utilisateurs / modifications | Champs profil/droits | À la demande ou correction défauts | Administration. |
| `js/maintenance-banner.js` | acquittement message | `users/{uid}` | Lecture/fermeture message | `readMessages: arrayUnion(messageId)` | Par message lu | Ne plus réafficher le message. |
| `js/storage.js` | `createSite()` | `pages/page1/items` | Création site | Site complet | À la demande | Créer un site. |
| `js/storage.js` | `updateSiteName()`, `updateSiteCreator()` | `pages/page1/items/{siteId}` | Modification site | Nom/créateur/date | À la demande | Modifier site. |
| `js/storage.js` | `setSiteLock()`, `clearSiteLock()` | `pages/page1/items/{siteId}` | Verrouillage/déverrouillage | Champs verrouillage | À la demande | Sécurité site. |
| `js/storage.js` | `refreshSiteInactivityStates()`, `restoreInactiveSite()` | `pages/page1/items/{siteId}` | Refresh inactivité / restauration | Champs inactivité | À l'ouverture/à la demande | Gestion sites inactifs. |
| `js/storage.js` | `removeSite()` | `pages/page1/items/{siteId}` | Suppression site | Suppression document | À la demande | Supprimer site. |
| `js/storage.js` | `restoreSite()`, `importData()` | `pages/page1/items` | Restauration/import | Sites restaurés/importés | À la demande | Récupération/import. |
| `js/storage.js` | `createItem()` | `pages/page2/items` | Création OUT | OUT complet | À la demande | Créer OUT. |
| `js/storage.js` | `updateItemName()` | `pages/page2/items/{itemId}` | Modification OUT | Numéro/date | À la demande | Renommer OUT. |
| `js/storage.js` | `removeItem()` | `pages/page2/items/{itemId}` | Suppression OUT | Suppression document | À la demande | Supprimer OUT. |
| `js/storage.js` | `restoreItem()`, `restoreSite()`, `importData()` | `pages/page2/items` | Restauration/import | OUT restaurés/importés | À la demande | Récupération/import. |
| `js/storage.js` | `createDetail()` | `pages/page3/items` | Création détail | Détail complet | À la demande | Ajouter article. |
| `js/storage.js` | `updateDetail()` | `pages/page3/items/{detailId}` | Modification détail | Champs modifiés/date | À la demande | Modifier article. |
| `js/storage.js` | `removeDetail()` | `pages/page3/items/{detailId}` | Suppression détail | Suppression document | À la demande | Supprimer article. |
| `js/storage.js` | `restoreDetail()`, `restoreItem()`, `restoreSite()`, `importData()` | `pages/page3/items` | Restauration/import | Détails restaurés/importés | À la demande | Récupération/import. |
| `js/storage.js` | `ensureMaterialCode()` | `materialCodes/{codeNormalisé}` | Création/modification détail avec code, typeahead absent | `code`, `designation` | À la demande | Alimenter catalogue typeahead. |
| `js/storage.js` | `bootstrapMaterialCodesFromDetails()` | `materialCodes/{codeNormalisé}` | `materialCodes` vide | Codes déduits de tous les détails | Migration/fallback | Amorcer catalogue sans perdre typeahead. |
| `js/storage.js` | `appendHistoryEntry()` | `historiques` | Actions non admin | Action, user, site, date | À chaque action tracée | Historique. |
| `js/storage.js` | `pruneHistoryEntries()` | `historiques` | Après ajout historique si >100 | Suppression anciens docs | Après historique | Limiter historique à 100. |
| `js/storage.js` | `addTrashEntry()` | `trash` | Suppression avec corbeille activée | Snapshot élément supprimé | À la suppression | Restauration possible. |
| `js/storage.js` | purge/restauration corbeille | `trash/{entryId}` | Purge expirée/restauration | Suppression entrée | À l'ouverture/restauration | Nettoyage corbeille. |
| `js/storage.js` | `setMaintenanceState()` | `appSettings/maintenance` | Paramètres maintenance | État maintenance | À la demande | Administration. |
| `js/storage.js` | `setTrashEnabled()` | `appSettings/trash` | Paramètres corbeille | État corbeille | À la demande | Administration. |
| `users.html` | envoi messages admin | `adminMessages` | Formulaire admin | Messages destinataires | À la demande | Communication admin. |
| `js/app.js` | achats matériels | `sites/{siteId}/achatsMateriels` | Création achat | Achat matériel | À la demande | Achats par site. |
| `js/app.js` | achats matériels | `sites/{siteId}/achatsMateriels/{purchaseId}` | Modification achat/statut | Champs achat | À la demande | Suivi achat. |
| `js/app.js` | achats matériels | `sites/{siteId}/achatsMateriels/{purchaseId}` | Suppression achat | Suppression document | À la demande | Supprimer achat. |
| `js/materiels.js` | `submitMaterialRequest()` | `materialRequests` | Envoi demande | Demande matériels | À la demande | Demande d'approvisionnement. |

Les écritures existantes sont globalement conservées. Aucune écriture ne supprime `materialCodes` lors de la suppression d'un détail.

## 4. Page 1

Page 1 utilise `StorageService.init()`, puis des abonnements locaux `subscribeSites()` et `subscribeItemCounts()`.

- Collections lues : `pages/page1/items`, `pages/page2/items`, `materialCodes` via init global du service, sauf cache frais.
- Données chargées : sites complets, OUT complets pour les compteurs par site, catalogue `materialCodes`.
- Collection qui n'est plus chargée au démarrage normal : `pages/page3/items` n'est plus lue dans `loadRemoteSnapshot()`, sauf fallback si `materialCodes` est vide.
- Écritures : création site, modification nom/créateur, verrouillage, déverrouillage, inactivité, suppression/restauration, historique, activité utilisateur, corbeille éventuelle.

Vérification : Page 1 ne charge plus globalement `pages/page3/items` dans le chemin normal. Elle charge encore globalement `pages/page2/items` pour les compteurs OUT. Donc l'objectif “ne pas charger Page 3 inutilement” est atteint pour Page 1, mais les OUT restent globaux.

## 5. Page 2

Page 2 reçoit un `siteId` dans l'URL et affiche les OUT du site courant depuis l'état local alimenté par `StorageService.init()`.

### Chargement des OUT

- Requête observée pour les OUT fonctionnels : `readPageItems('page2')`, donc `getDocs(collection(state.db, 'pages', 'page2', 'items'))`.
- Filtre Firestore : aucun `where('siteId', '==', siteId)` observé pour `pages/page2/items` dans le chargement principal.
- Filtrage par site : effectué en mémoire par `applySnapshot()` dans `state.itemsBySite`, puis `subscribeItems(siteId)` renvoie uniquement le tableau du site.
- `orderBy` : aucun pour `pages/page2/items` principal; tri local par `dateModification`.
- `limit` : aucun.
- Listener Firestore : aucun pour Page 2 principale; seulement abonnements locaux.

### Vérifications fonctionnelles

- Recherche OUT/article : fonctionne via `currentItems`, `detailDesignationsByItem` et `detailRowsByItem`. Les détails du site sont chargés par `ensureSiteDetailsLoaded(siteId)` lorsque les abonnements détails Page 2 sont utilisés.
- Filtres et compteurs : reposent sur `subscribeDetailCounts(siteId)`, `subscribeDetailDesignations(siteId)` et `subscribeDetailRows(siteId)`, qui déclenchent une lecture ciblée `where('siteId','==',siteId)`.
- Création OUT : conservée dans `createItem()` avec `addDoc(pages/page2/items)`.
- Modification OUT : conservée dans `updateItemName()` avec `setDoc(..., merge:true)`.
- Suppression OUT : conservée dans `removeItem()` avec `deleteDoc(pages/page2/items/{itemId})`; attention, la suppression des détails associés repose sur les détails déjà présents en mémoire pour la corbeille et ne supprime pas explicitement tous les détails distants si ceux-ci ne sont pas chargés.

Comparaison demandée :

- Avant : chargement global de tous les OUT.
- Après observé : chargement global de tous les OUT conservé au démarrage, puis utilisation ciblée en mémoire par `siteId`. Il n'y a pas de requête Firestore ciblée `where('siteId','==',siteId)` pour les OUT dans le code actuel.

## 6. Page 3

Page 3 charge les détails via `StorageService.subscribeDetails(siteId, itemId, onChange, onError)`.

### Fonctionnement actuel

- `siteId` : lu côté page depuis les paramètres d'URL, transmis à `subscribeDetails()`.
- `itemId` : lu côté page depuis les paramètres d'URL, transmis à `subscribeDetails()`.
- Requête Firestore : `getDocs(query(collection(state.db, 'pages', 'page3', 'items'), where('siteId', '==', String(siteId)), where('itemId', '==', String(itemId))))` via `ensurePairDetailsLoaded()`.
- Données récupérées : uniquement les détails du couple site/OUT demandé.
- Cache mémoire : `state.detailsByItem` par clé `${siteId}:${itemId}`.
- Marqueurs de chargement : `state.loadedDetailPairs` évite de relire un couple déjà chargé; `state.loadedDetailSites` évite aussi de relire un couple si tout le site a déjà été chargé par Page 2.
- Cache localStorage : les détails déjà chargés sont persistés dans `suiviMateriel.offlineCache.v1` pendant 180 secondes.
- Listener Firestore : aucun `onSnapshot()` pour `pages/page3/items`; l'abonnement est local et la lecture Firestore est ponctuelle.

### Avant / après

Avant, d'après `FIRESTORE_GLOBAL.md`, `StorageService.init()` chargeait globalement `pages/page3/items` via `loadRemoteSnapshot()`, puis Page 3 filtrait en mémoire par couple `siteId:itemId`.

Après, `loadRemoteSnapshot()` retourne `page3: []` et ne lit plus `pages/page3/items` dans le chemin normal. Page 3 effectue une lecture ciblée par `siteId` + `itemId` seulement quand `subscribeDetails()` est appelé. C'est une amélioration réelle pour le tableau Page 3.

Réserve importante : si `materialCodes` est vide, `bootstrapMaterialCodesFromDetails()` relit globalement `pages/page3/items`. Cette lecture est un fallback/migration et non le flux normal Page 3.

## 7. Typeahead

Le typeahead de Page 3 ne dépend plus directement du chargement complet de `pages/page3/items` dans le chemin normal.

Flux actuel :

```text
materialCodes
    ↓
code + designation
    ↓
StorageService.getMaterialCodes()
    ↓
buildCodeSuggestionSource(materialCodes)
    ↓
getCodeMatches(query)
    ↓
8 suggestions maximum
```

Vérifications :

- Recherche : `getCodeMatches()` compare la saisie en minuscules sur `entry.code`.
- Déduplication : `buildCodeSuggestionSource()` déduplique par code en minuscules; `materialCodes` déduplique aussi par document id normalisé.
- Casse : recherche en `toLowerCase()` et tri `localeCompare(..., sensitivity: 'base')`.
- Tri : les sources sont triées par code dans le typeahead; `state.materialCodes` est également trié par code.
- Maximum 8 suggestions : `.slice(0, 8)` dans `getCodeMatches()`.
- Clavier : gestion via index actif et sélection; les fonctions d'affichage maintiennent `aria-selected`.
- Souris : les boutons de suggestion portent `data-typeahead-index` et sont rendus comme boutons cliquables.
- Sélection : `applyCodeSuggestion()` remplit `codeInput` et `designationInput`, recalcule l'unité automatique et masque les suggestions.
- Remplissage designation : `designationInput.value = entry.designation || ''`.
- Fonctionnement lorsqu'un autre site n'est pas chargé : oui dans le chemin normal, car le catalogue vient de `materialCodes`, pas de `state.detailsByItem`.
- Code provenant d'un autre site : disponible si le code existe dans `materialCodes`. Si `materialCodes` est incomplet, il ne sera disponible qu'après bootstrap ou après création/modification d'un détail contenant ce code.

## 8. materialCodes

### Structure

Collection : `materialCodes`.

Champs observés :

- `code` : code matériel nettoyé.
- `designation` : désignation nettoyée.
- id document : code normalisé via `encodeURIComponent(normalizeMaterialCodeKey(code)).replace(/\./g, '%2E')`.

### Création et modification

- `bootstrapMaterialCodesFromDetails()` crée/merge les codes depuis `pages/page3/items` uniquement si `materialCodes` est vide.
- `ensureMaterialCode(code, designation)` crée un document si le code n'existe pas dans `state.materialCodes`.
- Si le code existe mais sans désignation et qu'une désignation est fournie, `ensureMaterialCode()` met à jour le document.
- `createDetail()` appelle `ensureMaterialCode()` après création du détail.
- `updateDetail()` appelle `ensureMaterialCode()` si `code` ou `designation` change.

### Suppression

Aucune suppression de document `materialCodes` n'est observée. La suppression d'un détail ne supprime pas de code catalogue. Cela protège les codes encore utilisés par d'autres détails.

### Synchronisation avec détails

`materialCodes` est un catalogue auxiliaire : il est alimenté depuis les détails, mais `pages/page3/items` reste la source de vérité des lignes détaillées. Le catalogue peut être incomplet si des détails historiques existent mais que le bootstrap n'a pas été exécuté ou si des imports/restaurations n'appellent pas `ensureMaterialCode()` pour chaque détail restauré/importé.

### Cache et realtime

- `state.materialCodes` garde le catalogue en mémoire.
- Le cache localStorage le persiste dans `suiviMateriel.offlineCache.v1`.
- Pas de listener temps réel Firestore sur `materialCodes`; les changements d'un autre client ne sont pas reçus avant rechargement/expiration cache ou appel de lecture si état vide.

## 9. Cache

- Nom : `suiviMateriel.offlineCache.v1`.
- Données stockées : `pages.page1`, `pages.page2`, `pages.page3` pour les détails déjà chargés, et `materialCodes`.
- Durée : 180 000 ms, soit 3 minutes.
- Lecture : `StorageService.init()` appelle `parseOfflineState()` et applique le snapshot si présent.
- Rafraîchissement : si le cache est absent ou expiré, `loadRemoteSnapshot()` relit `page1`, `page2` et `materialCodes`, puis persiste. Les chargements ciblés de détails persistent aussi le cache.
- Offline : en cas d'échec Firestore, le code conserve le snapshot offline s'il existe; sinon il applique des tableaux vides.
- Impact lectures : le cache frais évite les lectures initiales `page1`, `page2`, `materialCodes`. Il peut aussi éviter des lectures ciblées de détails si `loadedDetailPairs` / `loadedDetailSites` sont marqués par le cycle courant; toutefois, au rechargement de page, les ensembles `loadedDetailPairs` et `loadedDetailSites` ne sont pas reconstruits depuis le cache, donc une lecture ciblée peut être refaite même si des détails sont présents dans `state.detailsByItem` issu du cache.

## 10. Realtime / onSnapshot

| Fichier | Collection / document | Requête | Page | Raison | Données surveillées | Unsubscribe | Risque |
|---|---|---|---|---|---|---|---|
| `js/storage.js` | `users` | Collection complète | Utilisateurs | Liste utilisateurs admin | Tous profils | Retourné par `subscribeUsers()` | Global mais contrôlé par appelant. |
| `js/storage.js` | `pages/page2/items` | Collection complète | Utilisateurs | Points OUT par créateur | Tous OUT | Retourné par `subscribeOutCreationPoints()` | Global; peut dupliquer `users.html`. |
| `js/storage.js` | `appSettings/maintenance` | Document | Paramètres/maintenance | État maintenance | `enabled` | Retourné | Faible. |
| `js/storage.js` | `users/{uid}` | Document | Toutes pages / profil | Profil courant | Profil user | Retourné | Faible. |
| `js/storage.js` | `appSettings/trash` | Document | Corbeille | État corbeille | `enabled` | Retourné | Faible. |
| `js/storage.js` | `trash` | `orderBy('deletedAtIso','desc')` | Corbeille | Entrées supprimées | Corbeille | Retourné | Global sans limit. |
| `js/storage.js` | `historiques` | `orderBy('createdAt','desc')` | Historique | Historique temps réel | Entrées historique | Retourné | Global sans limit. |
| `js/maintenance-banner.js` | `users/{uid}` | Document | Toutes pages avec bannière | Rôle/profil courant | Profil user | Variable globale, désabonnée au changement auth | Faible. |
| `js/maintenance-banner.js` | `appSettings/maintenance` | Document | Toutes pages avec bannière | Blocage maintenance | `enabled` | Désabonné sur `beforeunload` | Faible. |
| `js/maintenance-banner.js` | `adminMessages` | `orderBy('createdAt','desc')`, `limit(20)` | Toutes pages avec bannière | Messages utilisateur récents | 20 messages récents | Désabonné sur `beforeunload` | Borné. |
| `users.html` | `users` | Collection complète | Utilisateurs | Rendu utilisateurs | Tous profils | Aucun stockage explicite observé | Listener durable jusqu'au déchargement, duplication possible. |
| `users.html` | `pages/page2/items` | Collection complète | Utilisateurs | Points OUT | Tous OUT | Aucun stockage explicite observé | Listener global et potentiellement coûteux. |

Aucun nouveau listener Firestore sur `pages/page3/items` ou `materialCodes` n'a été observé. La nouvelle architecture utilise des lectures ponctuelles ciblées pour les détails.

## 11. Vérification de l'objectif

- [x] Les données des sites ne sont plus chargées inutilement : partiellement vrai. Les sites sont toujours chargés globalement, ce qui est normal pour Page 1; pas de lecture `page3` globale normale.
- [ ] Les OUT sont chargés de manière ciblée : non. Le chargement principal de `pages/page2/items` reste global, même si l'utilisation est ensuite filtrée par site en mémoire.
- [x] Les détails Page 3 sont chargés de manière ciblée : oui dans le flux normal Page 3 via `where(siteId)` + `where(itemId)`.
- [x] Le typeahead fonctionne indépendamment des données Page 3 : oui, via `materialCodes` dans le flux normal.
- [x] `materialCodes` contient les codes nécessaires : probable pour les nouveaux détails et après bootstrap, mais non garanti statiquement pour tous les historiques si la collection est incomplète.
- [x] Les données existantes ne sont pas supprimées : aucune migration destructive observée; suppression de détail ne supprime pas `materialCodes`.
- [x] Les écritures existantes fonctionnent : les fonctions de création/modification/suppression/restauration/import restent présentes.
- [x] Aucun listener inutile n'a été ajouté : aucun listener nouveau sur Page 3/materialCodes; les listeners globaux existants utilisateurs/points demeurent.
- [x] Le cache fonctionne toujours : oui, avec TTL 3 minutes et persistance des détails chargés.
- [x] Les fonctionnalités existantes sont conservées : globalement oui selon le code, avec réserves ci-dessous.

## 12. Comparaison avant / après

| Fonction | Avant | Après | Amélioration |
|---|---|---|---|
| Page 1 | Chargeait `page1`, `page2`, `page3` globalement via init, sauf cache. | Charge `page1`, `page2`, `materialCodes`; ne charge plus `page3` sauf bootstrap si `materialCodes` vide. | Oui pour détails Page 3; OUT encore globaux. |
| Page 2 | OUT globaux; détails globaux via init pour recherches/compteurs. | OUT toujours globaux; détails du site chargés par `where('siteId','==',siteId)`. | Partielle : détails optimisés, OUT non optimisés Firestore. |
| Page 3 | Détails de tous les sites/OUT chargés puis filtrés en mémoire. | Détails du couple `siteId` + `itemId` chargés à la demande. | Oui, amélioration principale atteinte. |
| Typeahead | Dépendait du chargement/déduction depuis tous les détails Page 3. | Lit `materialCodes`, puis déduplique/trie côté client. | Oui, indépendant du site courant si catalogue complet. |
| materialCodes | Non séparé dans l'analyse précédente. | Collection auxiliaire lue globalement et alimentée par création/modification/bootstrap. | Oui, mais pas realtime et pas garantie d'exhaustivité sans bootstrap. |
| Historique | `addDoc`, prune par lecture complète triée, listener complet. | Identique observé. | Aucune amélioration spécifique. |
| Cache | Stockait pages 1/2/3 globales. | Stocke pages 1/2, détails chargés à la demande, materialCodes. | Oui pour ne pas forcer Page 3 globale; marqueurs loaded non reconstruits. |
| Realtime | Pas de realtime Firestore pour pages 1/2/3 métier; listeners globaux users/OUT/historique/trash/messages. | Même logique; pas de nouveau listener Page 3. | Pas de régression observée. |

Nombre exact de lectures : Non déterminable statiquement.

## 13. Risques et anomalies

1. `pages/page2/items` est encore chargé globalement dans `loadRemoteSnapshot()`. L'objectif “OUT ciblés lorsque siteId connu” n'est donc pas atteint côté Firestore.
2. `js/materiels.js` lit encore globalement `pages/page3/items` pour construire la liste matériels, alors que `materialCodes` existe. Cette lecture est excessive par rapport à la nouvelle architecture.
3. `bootstrapMaterialCodesFromDetails()` lit globalement `pages/page3/items` si `materialCodes` est vide. C'est acceptable comme migration, mais coûteux et à surveiller.
4. `pruneHistoryEntries()` lit tout `historiques` trié après chaque historique pour supprimer au-delà de 100. Une stratégie avec `limit` ou compteur serait moins coûteuse.
5. `historiques` et `trash` ont des listeners globaux sans `limit`; coût potentiel si collections volumineuses.
6. Les listeners inline de `users.html` ne stockent pas explicitement les fonctions unsubscribe; ils vivent jusqu'au déchargement de la page.
7. `users.html` et `StorageService` contiennent des flux temps réel utilisateurs/points similaires, ce qui peut créer une duplication selon les pages et appels effectifs.
8. Le cache restaure `detailsByItem`, mais pas `loadedDetailSites` ni `loadedDetailPairs`; une lecture ciblée peut être répétée malgré la présence de détails en cache après reload.
9. Lors de `removeSite()`, les détails supprimés sont ceux présents dans `state.detailsByItem`. Si les détails du site n'ont pas été chargés, des détails distants peuvent ne pas être supprimés. Même remarque pour snapshot corbeille. À vérifier fonctionnellement avant de considérer la suppression site totalement sûre dans la nouvelle architecture.
10. Lors de `removeItem()`, la corbeille capture les détails en mémoire du couple; si le couple n'a pas été chargé, le snapshot corbeille peut être incomplet. La suppression Firestore de l'OUT ne supprime pas explicitement tous les détails distants associés.
11. `importData()`, `restoreSite()`, `restoreItem()` et `restoreDetail()` recréent des détails sans appeler explicitement `ensureMaterialCode()`; les codes restaurés/importés peuvent ne pas alimenter `materialCodes` immédiatement.
12. Index Firestore potentiellement requis : requête `pages/page3/items` avec deux `where` (`siteId`, `itemId`) peut nécessiter un index composite selon les règles Firestore et les évolutions de requête. Non déterminable statiquement.
13. Pas de realtime sur `materialCodes` : un code créé par un autre client peut ne pas apparaître dans le typeahead avant expiration/rechargement.

## 14. Conclusion

## Verdict

⚠️ OBJECTIF PARTIELLEMENT ATTEINT

L'optimisation principale de Page 3 est atteinte : le tableau des détails ne charge plus globalement `pages/page3/items` dans le flux normal et utilise une requête ciblée par `siteId` + `itemId`. Le typeahead est également découplé du chargement complet de Page 3 grâce à `materialCodes`, avec déduplication, tri et limite de 8 suggestions côté client.

L'objectif n'est toutefois pas totalement atteint, car les OUT (`pages/page2/items`) restent chargés globalement au démarrage, la page `materiels.html` continue à lire globalement `pages/page3/items`, et certaines suppressions/restaurations/imports peuvent être fragilisées par le fait que tous les détails ne sont plus forcément chargés en mémoire. Aucune perte de données automatique n'est observée dans le code, mais les suppressions de site/OUT doivent être sécurisées avant de considérer l'architecture entièrement fiable.

Prochaines optimisations proposées, sans application automatique :

1. Remplacer le chargement global de `pages/page2/items` par une lecture ciblée `where('siteId','==',siteId)` pour Page 2 et Page 3, tout en conservant un mécanisme séparé pour les compteurs Page 1.
2. Adapter `materiels.html` pour lire `materialCodes` au lieu de `pages/page3/items`.
3. Avant suppression site/OUT, charger explicitement les détails ciblés depuis Firestore afin de supprimer/restaurer un snapshot complet.
4. Alimenter `materialCodes` lors des imports et restaurations de détails.
5. Réduire les lectures globales `historiques`, `trash`, `users` et points OUT avec des limites, filtres ou agrégats dédiés lorsque les besoins métier le permettent.
