# Audit spécifique — compteur « Articles » des cartes OUT de Page 2

## Périmètre

Cet audit porte uniquement sur le compteur « Article(s) » affiché dans chaque carte OUT de `page2.html` / page `site-detail`, sans modification du code applicatif.

## Résumé exécutif

- Le compteur affiché sur chaque carte OUT est rendu avec la variable locale `detailCountForCard`.
- `detailCountForCard` est calculée dans `renderItems()` par appel à `getOutDetailCountForActiveFilter(item.id, query)`.
- La donnée source du compteur est Page 3 : les documents Firestore de `pages/page3/items`, chargés en mémoire dans `detailCountsByItem` et `detailRowsByItem`.
- Page 2 déclenche une lecture Page 3 ciblée par `siteId`, via trois abonnements (`subscribeDetailCounts`, `subscribeDetailDesignations`, `subscribeDetailRows`) qui appellent tous `ensureSiteDetailsLoaded(siteId)`.
- Grâce au cache `state.loadedDetailSites`, ces trois appels ne devraient produire qu'une seule requête Firestore Page 3 pour un site donné, si l'état de chargement n'est pas déjà rempli.
- Cette lecture n'est pas répétée pour chaque carte OUT : elle est globale au site.
- Le compteur exact ne peut pas être calculé à partir des seules données Page 2 actuellement disponibles, car les documents Page 2 représentent les OUT, pas les lignes/articles Page 3. Une optimisation est toutefois possible en matérialisant ou agrégeant un compteur par OUT.

## 1. Variable exacte utilisée pour afficher le nombre d'articles

Dans `renderItems()`, la variable utilisée pour chaque carte OUT est :

```js
const detailCountForCard = getOutDetailCountForActiveFilter(item.id, query);
```

Elle est injectée directement dans le HTML de la carte :

```js
<span class="outs-number">${detailCountForCard}</span>
<span class="outs-label">Article${detailCountForCard > 1 ? 's' : ''}</span>
```

Donc, pour chaque carte OUT affichée :

- variable affichée : `detailCountForCard` ;
- carte concernée : l'itération `filteredItems.forEach((item) => { ... })` ;
- clé de rattachement : `item.id`, c'est-à-dire l'identifiant du document OUT de Page 2.

## 2. Où cette variable est calculée

`detailCountForCard` est calculée dans la fonction `renderItems()` de Page 2.

Le calcul délégué est :

```js
getOutDetailCountForActiveFilter(item.id, query)
```

La fonction `getOutDetailCountForActiveFilter(itemId, query)` applique deux chemins :

1. Cas normal, sans recherche et avec filtre `all` :
   - retourne `Number(detailCountsByItem[itemId] || 0)`.

2. Cas avec recherche et/ou filtre de statut :
   - utilise `detailRowsByItem[itemId] || []` ;
   - filtre les lignes Page 3 avec `getMatchingDetailCountForItem(...)` ou `detailMatchesOutCombinedFilters(...)` ;
   - retourne le nombre de lignes qui correspondent aux critères actifs.

Conclusion : le compteur visible n'est pas calculé à partir de la carte OUT elle-même, mais à partir de structures dérivées des détails/articles Page 3.

## 3. Source exacte des données

### Structures utilisées côté Page 2

Page 2 initialise trois structures en mémoire :

- `detailCountsByItem = {}` : nombre d'articles par OUT ;
- `detailDesignationsByItem = {}` : désignations d'articles par OUT, principalement utile à la recherche ;
- `detailRowsByItem = {}` : lignes/articles complètes par OUT, utiles aux filtres, recherches et export.

Pour le compteur de carte :

- sans recherche / filtre `all` : source directe = `detailCountsByItem[itemId]` ;
- avec recherche et/ou filtre de statut : source directe = `detailRowsByItem[itemId]`.

### Origine Firestore

Ces structures sont construites par `StorageService` à partir de `state.detailsByItem`, lui-même alimenté par `ensureSiteDetailsLoaded(siteId)`.

La lecture Firestore est :

```js
getDocs(query(makePageItemsCollection('page3'), where('siteId', '==', normalizedSiteId)))
```

`makePageItemsCollection('page3')` pointe vers :

```js
collection(state.db, 'pages', pageName, 'items')
```

Donc la collection lue est exactement :

```text
pages/page3/items
```

avec contrainte :

```text
where('siteId', '==', <siteId Page 2 courant>)
```

### Classification demandée

- Données déjà chargées dans Page 2 : oui, après chargement, le rendu lit `detailCountsByItem` / `detailRowsByItem` en mémoire.
- Collection Page 2 : non pour le nombre d'articles ; Page 2 fournit seulement la liste des OUT (`currentItems`) et leurs `id`.
- Collection Page 3 : oui, source réelle des articles comptés.
- `materialCodes` : non.
- Autre collection : non pour ce compteur.

## 4. Lectures Firestore déclenchées uniquement pour calculer ce compteur

Les lectures Page 3 déclenchées pendant l'initialisation Page 2 sont :

1. `subscribeDetailCounts(siteId, ...)`
   - appelle `ensureSiteDetailsLoaded(siteId)` ;
   - nécessaire au compteur brut `detailCountsByItem[itemId]`.

2. `subscribeDetailDesignations(siteId, ...)`
   - appelle aussi `ensureSiteDetailsLoaded(siteId)` ;
   - utile à la recherche par article/désignation, pas au compteur brut simple.

3. `subscribeDetailRows(siteId, ...)`
   - appelle aussi `ensureSiteDetailsLoaded(siteId)` ;
   - utile au compteur lorsque recherche/filtre sont actifs, aux compteurs de filtres et à l'export.

Ces trois abonnements ne créent pas nécessairement trois requêtes réseau distinctes, car `ensureSiteDetailsLoaded(siteId)` retourne immédiatement si `state.loadedDetailSites` contient déjà le site. Dans le flux normal séquentiel, la première résolution charge Page 3, puis les suivantes réutilisent l'état mémoire.

Point de vigilance : les trois appels sont lancés depuis Page 2 sans mutualisation explicite d'une promesse en cours. Si les trois appels arrivent strictement en parallèle avant que `state.loadedDetailSites.add(siteId)` soit exécuté, il existe un risque de requêtes dupliquées transitoires. Le code ne stocke pas une promesse `loadingDetailsBySite` qui empêcherait ce scénario.

## 5. Page 2 déclenche-t-elle `pages/page3/items` ?

Oui.

Page 2 déclenche la lecture de :

```text
pages/page3/items
```

via :

```js
readDetailsByQuery(where('siteId', '==', normalizedSiteId))
```

qui utilise :

```js
getDocs(query(makePageItemsCollection('page3'), ...constraints))
```

Il n'y a pas de lecture de `materialCodes` pour ce compteur. `materialCodes` existe dans le service de stockage, mais il n'est pas impliqué dans `detailCountForCard`.

## 6. Nature de la lecture

La lecture Page 3 pour Page 2 est :

- globale : non, elle ne lit pas tous les sites ;
- ciblée par `siteId` : oui ;
- ciblée par `itemId` : non dans Page 2 ;
- répétée pour chaque carte : non ;
- répétée par abonnement : potentiellement oui au niveau des appels, mais le cache `loadedDetailSites` vise à limiter à une lecture effective par site chargé.

Requête exacte :

```text
collection: pages/page3/items
filter: where('siteId', '==', siteId courant)
```

La requête par paire `siteId + itemId` existe dans `ensurePairDetailsLoaded(siteId, itemId)`, mais elle est utilisée par `subscribeDetails(siteId, itemId, ...)`, c'est-à-dire la Page 3 / détail d'un OUT, pas par le rendu des cartes OUT de Page 2.

## 7. Nombre de requêtes possibles selon le nombre d'OUT

Hypothèses : site non encore chargé en détails Page 3, cache vide pour ce site, initialisation normale de Page 2.

| Nombre d'OUT du site | Requêtes Page 3 attendues pour le compteur | Requêtes Page 3 théoriques en cas de course entre les 3 abonnements | Lecture répétée par carte ? |
| ---: | ---: | ---: | :-- |
| 1 OUT | 1 requête `pages/page3/items` filtrée par `siteId` | jusqu'à 3 | Non |
| 10 OUT | 1 requête `pages/page3/items` filtrée par `siteId` | jusqu'à 3 | Non |
| 50 OUT | 1 requête `pages/page3/items` filtrée par `siteId` | jusqu'à 3 | Non |

Important : le nombre de requêtes ne dépend pas du nombre d'OUT. En revanche, le nombre de documents lus dans cette unique requête dépend du nombre total d'articles Page 3 du site.

## 8. Peut-on calculer le compteur avec les données déjà disponibles dans Page 2 sans charger Page 3 ?

Avec le modèle actuel visible dans le code : non, pas exactement.

Raison : Page 2 charge les OUT (`pages/page2/items`) par `siteId`. Ces documents donnent la liste des cartes OUT, mais le code ne montre pas de champ Page 2 tel que `articleCount`, `detailCount` ou compteur matérialisé permettant de connaître le nombre d'articles de chaque OUT sans lire les lignes Page 3.

Le compteur exact est donc dépendant des documents Page 3, sauf si une optimisation de modèle est ajoutée.

## 9. Optimisation possible pour conserver exactement le même compteur sans lecture inutile de Page 3

Pour conserver exactement le même compteur sans charger tous les articles Page 3 depuis Page 2, il faut matérialiser ou agréger le nombre par OUT au moment où les articles Page 3 changent.

Options possibles :

1. Ajouter un compteur dénormalisé sur chaque document Page 2 OUT, par exemple :
   - collection : `pages/page2/items/{itemId}` ;
   - champ : `detailCount` ou `articleCount` ;
   - mise à jour : incrémenter à l'ajout d'un article Page 3, décrémenter à la suppression, recalculer si restauration/import.

2. Ajouter une collection d'agrégats par OUT, par exemple :
   - `pages/page2/items/{itemId}/stats/articleCount` ou une collection dédiée ;
   - Page 2 lit seulement les stats nécessaires, ou les embarque avec les OUT.

3. Utiliser une requête d'agrégation Firestore `count()` par OUT serait moins bon ici si elle est faite par carte, car cela deviendrait N requêtes pour N OUT. Pour Page 2, un compteur matérialisé dans le document OUT est préférable.

Pour garder le même comportement avec recherche/filtres de statut qui dépendent des lignes, il faut distinguer :

- compteur simple « Article(s) » sans filtre : peut être servi par un champ matérialisé Page 2 ;
- compteur filtré/recherche par statut/désignation : nécessite soit les lignes Page 3, soit des index/agrégats supplémentaires par statut et termes recherchables.

## Réponses synthétiques aux questions

1. Variable exacte : `detailCountForCard`.
2. Calcul : `renderItems()` → `getOutDetailCountForActiveFilter(item.id, query)`.
3. Source : `detailCountsByItem` / `detailRowsByItem`, alimentés par `pages/page3/items` filtré par `siteId`.
4. Lectures Firestore : `ensureSiteDetailsLoaded(siteId)` via `subscribeDetailCounts`, `subscribeDetailDesignations`, `subscribeDetailRows`.
5. Page 2 déclenche `pages/page3/items` : oui.
6. Lecture : ciblée par `siteId`, non ciblée par `itemId`, non répétée par carte.
7. Requêtes : normalement 1 pour 1, 10 ou 50 OUT ; théoriquement jusqu'à 3 si les trois abonnements lancent une lecture concurrente avant cache.
8. Calcul depuis Page 2 seule : non avec les champs actuels ; oui après ajout d'un compteur matérialisé par OUT.

## Verdict

🟡 Le compteur utilise Page 3 mais une optimisation est possible.

Page 2 lit exactement la collection `pages/page3/items` avec `where('siteId', '==', siteId courant)`. Cette lecture est déclenchée à l'initialisation de Page 2 par les abonnements aux compteurs, désignations et lignes de détail, parce que le compteur affiché sur chaque carte OUT est dérivé des articles Page 3. Pour conserver le même compteur sans lecture inutile de Page 3, il faut stocker un compteur d'articles maintenu à jour sur chaque OUT de Page 2, puis afficher ce champ pour le cas simple sans filtre/recherche.
