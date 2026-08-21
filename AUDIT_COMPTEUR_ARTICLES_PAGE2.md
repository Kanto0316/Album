# Audit — source du compteur « Nombre d’articles » de la Page 2

## Périmètre et méthode

Audit statique uniquement, sans modification des fichiers existants.

Recherches effectuées dans le dépôt :

- `Nombre d’articles` / variantes avec apostrophe ;
- `nombreArticles` ;
- `articleCount` ;
- `totalArticles` ;
- `itemsCount` ;
- `detailsCount` ;
- `outCount` ;
- `articles` ;
- lectures Firestore : `getDocs()`, `onSnapshot()`, `collection()`, `query()`, `where()` ;
- fonctions liées : `readDetailsByQuery()`, `ensureSiteDetailsLoaded()`, `subscribeDetailCounts()`, Page 2 / `renderItems()`.

## Résultat de recherche sur le libellé

Le libellé exact `Nombre d’articles` n’apparaît pas dans le code source actuel.

Le compteur correspondant aux articles affichés sur la Page 2 est rendu dans les cartes OUT avec le libellé dynamique :

```js
Article${detailCountForCard > 1 ? 's' : ''}
```

Ce compteur est donc affiché sous la forme `0 Article`, `1 Article`, `2 Articles`, etc., dans chaque carte OUT de la Page 2.

## 1. Fichier qui affiche le compteur

Le compteur d’articles de Page 2 est affiché dans :

- `js/app.js`, dans la fonction `renderItems()`.

Le conteneur de Page 2 est déclaré dans :

- `page2.html`, qui définit la page avec `body data-page="site-detail"` ;
- `page2.html`, qui contient aussi le compteur d’OUT global `#itemCount`, distinct du compteur d’articles par OUT.

## 2. Fonction qui génère l’affichage

La fonction qui génère l’affichage du compteur d’articles est :

```js
renderItems(options = {})
```

Dans cette fonction :

1. les OUT filtrés sont calculés dans `filteredItems` ;
2. chaque OUT est rendu dans une carte ;
3. le compteur d’articles de la carte est calculé dans `detailCountForCard` ;
4. la valeur est injectée dans le HTML de la carte avec le libellé `Article` / `Articles`.

Extrait logique :

```js
const detailCountForCard = getOutDetailCountForActiveFilter(item.id, query);
...
<span class="outs-number">${detailCountForCard}</span>
<span class="outs-label">Article${detailCountForCard > 1 ? 's' : ''}</span>
```

## 3. Variable utilisée pour afficher la valeur

La variable directement affichée est :

```js
detailCountForCard
```

Elle est locale à `renderItems()` et est calculée pour chaque OUT rendu.

## 4. Fonction qui calcule cette valeur

La valeur est calculée par :

```js
getOutDetailCountForActiveFilter(item.id, query)
```

Cette fonction utilise deux sources selon le contexte :

### Cas normal : aucun filtre de statut actif et aucune recherche

```js
return Number(detailCountsByItem[itemId] || 0);
```

Dans ce cas, le compteur affiché vient directement de :

```js
detailCountsByItem[itemId]
```

### Cas filtré : filtre de statut actif ou recherche active

La fonction recalcule le nombre à partir des lignes détaillées en mémoire :

- `detailRowsByItem[item.id]` ;
- `getMatchingDetailCountForItem(item, query, activeStatusFilter)` ;
- ou un `reduce()` sur les détails si l’OUT n’est pas retrouvé.

Ce recalcul reste basé sur les données Page 3 déjà chargées dans l’état local.

## 5. Source des données

La source métier du compteur d’articles est la liste des détails/articles Page 3.

En mémoire, ces données sont stockées dans :

```js
state.detailsByItem
```

avec une clé composite :

```txt
siteId:itemId
```

Le compteur non filtré est construit par `buildDetailCountsForSite(siteId)`, qui parcourt `state.detailsByItem`, conserve uniquement les clés dont le `siteId` correspond au site courant, puis affecte :

```js
counts[itemId] = details.length;
```

`subscribeDetailCounts(siteId, ...)` transmet ensuite ce résultat à Page 2, où il devient :

```js
detailCountsByItem = counts;
```

## 6. Collection Firestore utilisée

La collection Firestore utilisée pour le compteur d’articles est :

```txt
pages/page3/items
```

Elle est construite par :

```js
makePageItemsCollection('page3')
```

puis lue par :

```js
readDetailsByQuery(...constraints)
```

## 7. Requête Firestore utilisée

La requête directe participant au compteur Page 2 est :

```js
getDocs(query(makePageItemsCollection('page3'), where('siteId', '==', normalizedSiteId)))
```

Chemin exact dans le code :

```txt
subscribeDetailCounts(siteId)
↓
ensureSiteDetailsLoaded(siteId)
↓
readDetailsByQuery(where('siteId', '==', normalizedSiteId))
↓
getDocs(query(makePageItemsCollection('page3'), ...constraints))
```

## 8. Filtres `where()`

Pour le compteur d’articles de Page 2, le filtre Firestore identifié est :

```js
where('siteId', '==', normalizedSiteId)
```

Aucun filtre `where('itemId', '==', itemId)` n’est utilisé pour le compteur agrégé de Page 2 : la lecture se fait par site complet, puis les compteurs par OUT sont calculés en mémoire.

Le filtre `where('itemId', '==', itemId)` existe dans `ensurePairDetailsLoaded(siteId, itemId)`, mais il sert au chargement ciblé d’un couple Page 3 précis, pas au compteur global par OUT affiché dans la liste Page 2 lorsque `subscribeDetailCounts(siteId)` charge les détails du site.

## 9. `siteId` utilisé

Le `siteId` de Page 2 provient des paramètres d’URL :

```js
const params = UiService.getQueryParams();
const siteId = params.get('siteId');
```

Si aucun `siteId` n’est présent, Page 2 redirige vers `index.html`.

Ce même `siteId` est transmis à :

- `StorageService.subscribeItems(siteId, ...)` pour charger les OUT Page 2 du site ;
- `StorageService.subscribeDetailCounts(siteId, ...)` pour calculer les compteurs d’articles ;
- `StorageService.subscribeDetailDesignations(siteId, ...)` ;
- `StorageService.subscribeDetailRows(siteId, ...)`.

Pour le compteur d’articles, le chemin critique est `subscribeDetailCounts(siteId)`.

## 10. Cache utilisé

Oui, un cache existe.

### Cache mémoire

Les détails Page 3 sont conservés dans :

```js
state.detailsByItem
```

Les sites déjà chargés pour les détails sont suivis dans :

```js
state.loadedDetailSites
```

`ensureSiteDetailsLoaded(siteId)` ne relit pas Firestore si :

```js
state.loadedDetailSites.has(normalizedSiteId)
```

est vrai.

### Cache localStorage

Le cache persistant utilise :

```js
OFFLINE_CACHE_KEY = 'suiviMateriel.offlineCache.v1'
OFFLINE_CACHE_TTL_MS = 180 * 1000
```

`persistOfflineState()` stocke notamment :

```js
pages: {
  page1: state.sites,
  page2: items,
  page3: details,
}
```

À l’application du snapshot, les détails Page 3 du cache sont réindexés par clé `siteId:itemId` dans `state.detailsByItem`.

Point important : `applySnapshot()` remplit `state.detailsByItem` depuis `snapshot.page3`, mais ne marque pas explicitement `loadedDetailSites`. Donc, sauf si `loadedDetailSites` est déjà renseigné en mémoire, `subscribeDetailCounts(siteId)` peut déclencher `ensureSiteDetailsLoaded(siteId)` et relire Firestore pour ce site.

## 11. Flux complet du compteur

Flux réel identifié pour le compteur d’articles affiché dans les cartes OUT de Page 2 :

```txt
pages/page3/items
↓
readDetailsByQuery(where('siteId', '==', normalizedSiteId))
↓
getDocs(query(makePageItemsCollection('page3'), where('siteId', '==', normalizedSiteId)))
↓
mergeDetails(details)
↓
state.detailsByItem, clés siteId:itemId
↓
buildDetailCountsForSite(siteId)
↓
counts[itemId] = details.length
↓
StorageService.subscribeDetailCounts(siteId, callback)
↓
detailCountsByItem = counts dans initSiteDetailPage()
↓
renderActiveTabContent() / renderItems()
↓
getOutDetailCountForActiveFilter(item.id, query)
↓
detailCountForCard
↓
<span class="outs-number">${detailCountForCard}</span><span class="outs-label">Article(s)</span>
```

## 12. Vérification de l’isolation par site

### Récupération du site courant

Le site courant est récupéré depuis l’URL de Page 2 :

```js
const siteId = params.get('siteId');
```

### Transmission du site courant

Le `siteId` est transmis directement à `StorageService.subscribeDetailCounts(siteId, ...)`.

### Filtre Firestore

La lecture Firestore des détails Page 3 pour les compteurs utilise bien :

```js
where('siteId', '==', normalizedSiteId)
```

### Séparation du cache par site

Le cache mémoire des détails utilise la clé composite :

```txt
siteId:itemId
```

`buildDetailCountsForSite(siteId)` reparcourt cette map et ne conserve que les entrées dont la partie `siteId` de la clé est égale au site demandé.

Conclusion isolation : le compteur d’articles de Page 2 est isolé par `siteId` dans la requête Firestore et dans le calcul mémoire.

## 13. Risque d’utilisation des données d’un autre site

Le code actuel limite ce risque pour le compteur d’articles :

- la lecture Firestore principale est filtrée par `siteId` ;
- les données en cache sont indexées par `siteId:itemId` ;
- le calcul `buildDetailCountsForSite(siteId)` filtre explicitement par la partie `siteId` de la clé ;
- `renderItems()` calcule le compteur pour les OUT affichés sur la Page 2 courante.

Aucun chemin direct n’a été identifié où le compteur d’articles Page 2 additionnerait volontairement des détails Page 3 d’un autre site.

## 14. Lecture globale de `pages/page3/items`

Pour le compteur d’articles de Page 2, aucune lecture globale directe de `pages/page3/items` n’est utilisée.

La lecture directe du compteur est ciblée par :

```js
where('siteId', '==', normalizedSiteId)
```

Une lecture globale de `pages/page3/items` existe toutefois ailleurs :

```js
bootstrapMaterialCodesFromDetails()
↓
readPageItems('page3')
↓
getDocs(makePageItemsCollection('page3'))
```

Cette lecture globale est conditionnelle : elle se produit dans `loadRemoteSnapshot()` uniquement si `readMaterialCodes()` retourne un catalogue vide. Elle sert au bootstrap du catalogue `materialCodes`, pas au calcul direct du compteur d’articles Page 2.

## 15. Lecture à chaque ouverture de Page 2

À l’initialisation de Page 2, `subscribeDetailCounts(siteId, ...)` appelle toujours `ensureSiteDetailsLoaded(siteId)`.

Cependant, `ensureSiteDetailsLoaded(siteId)` ne lit Firestore que si le site n’est pas déjà présent dans `state.loadedDetailSites`.

Donc :

- première ouverture du site dans une session sans détails déjà marqués chargés : lecture Firestore ciblée sur `pages/page3/items where siteId == siteId` ;
- réouverture du même site dans la même session après chargement : pas de nouvelle lecture pour ce compteur ;
- après restauration depuis cache localStorage, les détails peuvent être présents dans `state.detailsByItem`, mais `loadedDetailSites` n’est pas reconstruit par `applySnapshot()`, donc une lecture ciblée peut tout de même être relancée.

## 16. Volume potentiel lu

La requête du compteur d’articles Page 2 lit potentiellement tous les documents de :

```txt
pages/page3/items
```

ayant :

```txt
siteId == siteId courant
```

Elle ne lit pas toute la collection pour ce compteur, mais elle peut lire tous les articles/détails de tous les OUT du site sélectionné. Le volume dépend donc de la taille du site courant.

## 17. Cas `outCount`

Le compteur d’articles de Page 2 n’utilise pas `outCount`.

`outCount` est un compteur d’OUT stocké sur le document site :

```txt
pages/page1/items/{siteId}.outCount
```

Il est utilisé pour les compteurs d’OUT par site, notamment Page 1, via `subscribeItemCounts()` / `emitAll()` / `getSiteOutCount()`.

Maintenance de `outCount` identifiée :

- création de site : initialisation à `0` ;
- création d’OUT : après `addDoc()` dans `pages/page2/items`, appel à `incrementSiteOutCount(siteId, 1)` ;
- suppression d’OUT : après `deleteDoc()` dans `pages/page2/items/{itemId}`, appel à `incrementSiteOutCount(siteId, -1)` ;
- restauration/import : initialisation ou réconciliation selon les flux existants.

Conclusion : `outCount` correspond au nombre d’OUT d’un site, pas au nombre d’articles/détails Page 3. Il ne correspond donc pas au compteur `Article(s)` affiché dans les cartes OUT de Page 2.

## 18. Lectures Firestore impliquées directement ou indirectement

### Directement impliquée dans le compteur d’articles Page 2

```js
readDetailsByQuery(where('siteId', '==', normalizedSiteId))
```

exécutée sous forme :

```js
getDocs(query(makePageItemsCollection('page3'), where('siteId', '==', normalizedSiteId)))
```

### Indirectement liée à l’affichage Page 2

Les OUT affichés sur Page 2 sont chargés séparément depuis :

```js
getDocs(query(makePageItemsCollection('page2'), where('siteId', '==', normalizedSiteId)))
```

via :

```txt
subscribeItems(siteId)
↓
ensureSiteItemsLoaded(siteId)
↓
readPage2ItemsBySite(siteId)
```

Cette lecture Page 2 détermine la liste des cartes OUT affichées, mais pas le nombre d’articles par carte. Le nombre d’articles vient de Page 3.

### Non impliquées directement dans ce compteur

- `onSnapshot()` : aucun listener Firestore direct n’a été identifié dans le flux du compteur d’articles Page 2 ; les abonnements `subscribeDetailCounts()` sont des listeners locaux sur l’état mémoire.
- `readPageItems('page3')` : lecture globale utilisée par le bootstrap de `materialCodes` si le catalogue est vide, pas par le compteur Page 2.
- `outCount` : compteur d’OUT sur Page 1, pas compteur d’articles.

## 19. Test logique Site A / Site B

### Site A

```txt
URL page2.html?siteId=SiteA
↓
siteId = SiteA
↓
subscribeDetailCounts(SiteA)
↓
ensureSiteDetailsLoaded(SiteA)
↓
pages/page3/items where siteId == SiteA
↓
state.detailsByItem clés SiteA:itemId
↓
buildDetailCountsForSite(SiteA)
↓
compteurs affichés pour les OUT de SiteA
```

### Site B

```txt
URL page2.html?siteId=SiteB
↓
siteId = SiteB
↓
subscribeDetailCounts(SiteB)
↓
ensureSiteDetailsLoaded(SiteB)
↓
pages/page3/items where siteId == SiteB
↓
state.detailsByItem clés SiteB:itemId
↓
buildDetailCountsForSite(SiteB)
↓
compteurs affichés pour les OUT de SiteB
```

### Garantie logique

Le code actuel garantit logiquement que :

```txt
compteur A ≠ données de Site B
compteur B ≠ données de Site A
```

pour le compteur d’articles Page 2, sous réserve que les documents Firestore Page 3 aient un champ `siteId` correct et cohérent avec leur OUT.

## Conclusion

- Source exacte du compteur : détails/articles Page 3 stockés en mémoire dans `state.detailsByItem`, agrégés par `buildDetailCountsForSite(siteId)`, transmis à Page 2 via `StorageService.subscribeDetailCounts(siteId, ...)`, puis affichés via `detailCountForCard` dans `renderItems()`.
- Collection Firestore utilisée : `pages/page3/items`.
- Requête exacte : `getDocs(query(makePageItemsCollection('page3'), where('siteId', '==', normalizedSiteId)))`.
- Le compteur est-il indépendant par `siteId` ? OUI.
- Une lecture globale existe-t-elle ? OUI, mais pas pour ce compteur : `bootstrapMaterialCodesFromDetails()` peut lire globalement `pages/page3/items` si le catalogue `materialCodes` est vide.
- Le compteur peut-il être optimisé ? OUI. Il lit tous les détails/articles du site courant pour calculer les compteurs par OUT, ce qui peut devenir volumineux pour un site important.
- Niveau actuel : 🟡 À optimiser.

## Recommandation

Ne rien modifier dans l’immédiat.

Optimisation ultérieure possible : matérialiser un compteur d’articles par OUT, par exemple sur chaque document `pages/page2/items/{itemId}` ou dans une collection d’agrégats dédiée, maintenu lors des créations/suppressions/modifications de détails Page 3. Page 2 pourrait alors afficher le nombre d’articles sans lire tous les documents `pages/page3/items` du site courant à chaque premier chargement non marqué en cache mémoire.

Une autre optimisation plus limitée consisterait à reconstruire `loadedDetailSites` à partir du cache `page3` lors de `applySnapshot()`, si et seulement si le cache est considéré complet par site. Cette option nécessite un marqueur de complétude par `siteId`, afin d’éviter de croire qu’un site est chargé alors que le cache ne contient qu’un sous-ensemble de ses détails.

## Résumé console demandé

```txt
fichier d’audit créé : AUDIT_COMPTEUR_ARTICLES_PAGE2.md
source du compteur : pages/page3/items → state.detailsByItem → buildDetailCountsForSite(siteId) → detailCountsByItem → renderItems() → detailCountForCard
collection Firestore : pages/page3/items
requête utilisée : getDocs(query(makePageItemsCollection('page3'), where('siteId', '==', normalizedSiteId)))
indépendant par site : OUI
lecture globale détectée : OUI, mais hors flux direct du compteur Page 2 (bootstrap materialCodes conditionnel)
```
