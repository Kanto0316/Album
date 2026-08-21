# Audit uniquement — compteur « Nombre d’articles » Page 2 et découplage possible de Page 3

## 1. Périmètre et méthode

Cet audit est basé uniquement sur le code présent dans le repository. Aucun fichier existant n'a été modifié et aucune correction n'a été appliquée.

Recherches effectuées dans le dépôt :

- `Nombre d’articles`
- `Nombre d'articles`
- `articleCount`
- `articlesCount`
- `totalArticles`
- `itemsCount`
- `detailsCount`
- `outCount`
- `count`
- `ensureSiteDetailsLoaded`
- `readDetailsByQuery`

Fichier créé uniquement pour le rapport : `AUDIT_COMPTEUR_ARTICLES_PAGE2_DECOUPLAGE.md`.

## 2. Identification exacte du compteur Page 2

### 2.1 Libellé réel trouvé dans le code

Le libellé exact `Nombre d’articles` n'apparaît pas dans les fichiers applicatifs actuels. Le compteur visible en Page 2 correspondant au nombre d'articles est rendu dans les cartes OUT sous la forme :

```html
<span class="outs-number">${detailCountForCard}</span>
<span class="outs-label">Article${detailCountForCard > 1 ? 's' : ''}</span>
```

Ce rendu est produit dans `renderItems()` dans `js/app.js`.

Il existe aussi des compteurs de filtres Page 2 (`Tous`, `Terminés`, `En cours`, `À corriger`, `K.O`) et une carte de progression affichant `Total • N ARTICLE(S)`. Ces compteurs sont également basés sur les détails Page 3.

### 2.2 Ce que représente actuellement le compteur

Le compteur `Article(s)` affiché dans chaque carte OUT de Page 2 représente le nombre de documents détail Page 3 associés à l'OUT courant, avec une logique dépendant du filtre actif et de la recherche :

- si aucun filtre de statut n'est actif (`all`) et aucune recherche n'est saisie : le compteur utilise `detailCountsByItem[itemId]`, construit à partir de la longueur du tableau de détails Page 3 de chaque OUT ;
- si un filtre de statut ou une recherche est actif : le compteur recalcule le nombre de détails Page 3 qui correspondent aux critères de recherche/statut.

Donc le compteur ne représente pas le nombre de documents Page 2 (`pages/page2/items`) et ne représente pas `outCount`. Il représente des documents de la collection `pages/page3/items`.

### 2.3 Documents comptés

Les documents comptés sont les documents normalisés de `pages/page3/items` chargés pour le site courant, puis regroupés en mémoire par clé :

```text
siteId:itemId
```

Pour le compteur simple par OUT, `buildDetailCountsForSite(siteId)` parcourt `state.detailsByItem` et compte `details.length` pour chaque `itemId` dont la partie `siteId` de la clé correspond au site demandé.

### 2.4 Collection Firestore utilisée

La collection Firestore lue pour le compteur d'articles Page 2 est :

```text
pages/page3/items
```

La fonction `readDetailsByQuery(...constraints)` exécute :

```js
getDocs(query(makePageItemsCollection('page3'), ...constraints))
```

### 2.5 Filtre par siteId

Oui. Pour Page 2, `ensureSiteDetailsLoaded(siteId)` appelle :

```js
readDetailsByQuery(where('siteId', '==', normalizedSiteId))
```

Donc la lecture Page 3 est filtrée par `siteId`.

### 2.6 Filtre par itemId

Pour la Page 2 globale d'un site, non : la requête charge tous les détails du site courant, sans contrainte `itemId`. Ensuite le regroupement par OUT est fait en mémoire.

La contrainte `itemId` existe dans `ensurePairDetailsLoaded(siteId, itemId)`, utilisée pour charger les détails d'une paire site/OUT, notamment côté Page 3.

### 2.7 Exclusions, statut et suppression

- Aucun champ de suppression logique n'est filtré dans la requête `ensureSiteDetailsLoaded(siteId)`.
- Aucun statut n'est filtré au niveau Firestore pour le compteur simple : tous les documents Page 3 du site sont lus.
- Le compteur simple `detailCountsByItem[itemId]` compte `details.length`, sans exclure par statut.
- Les compteurs de filtres Page 2 utilisent ensuite `matchesStatusClassification(detail, filterKey)` en mémoire pour répartir les articles entre `done`, `todo`, `fix` et `ko`.
- Les documents en corbeille ne restent pas dans `pages/page3/items` après suppression : `removeDetail()` ajoute éventuellement une entrée `trash`, puis supprime le document Page 3 avec `deleteDoc`. Ils ne sont donc plus comptés après passage en corbeille.

### 2.8 Correspondance avec `pages/page3/items`

Oui, le compteur correspond au nombre de documents `pages/page3/items` associés au site et à l'OUT, sous réserve du filtre actif :

- en mode normal : nombre réel de documents Page 3 pour `siteId + itemId` présents dans l'état local après chargement ;
- avec recherche/filtre : sous-ensemble des mêmes documents Page 3 correspondant aux critères UI.

## 3. Flux actuel complet

Chemin exact du compteur `Article(s)` affiché dans une carte OUT de Page 2 :

```text
Page 2 : page2.html
↓
initSiteDetailPage() dans js/app.js initialise la Page 2
↓
siteId lu depuis l'URL
↓
StorageService.subscribeDetailCounts(siteId, callback)
StorageService.subscribeDetailDesignations(siteId, callback)
StorageService.subscribeDetailRows(siteId, callback)
↓
subscribeDetailCounts(siteId) appelle buildDetailCountsForSite(siteId), puis ensureSiteDetailsLoaded(siteId)
subscribeDetailDesignations(siteId) appelle buildDetailDesignationsForSite(siteId), puis ensureSiteDetailsLoaded(siteId)
subscribeDetailRows(siteId) appelle buildDetailRowsForSite(siteId), puis ensureSiteDetailsLoaded(siteId)
↓
ensureSiteDetailsLoaded(siteId)
↓
readDetailsByQuery(where('siteId', '==', normalizedSiteId))
↓
Firestore : getDocs(query(makePageItemsCollection('page3'), where('siteId', '==', normalizedSiteId)))
↓
Collection : pages/page3/items
↓
Documents récupérés : tous les détails dont detail.siteId == siteId
↓
mergeDetails(details) remplit state.detailsByItem avec les clés siteId:itemId
↓
buildDetailCountsForSite(siteId) calcule counts[itemId] = details.length
↓
callback Page 2 met à jour detailCountsByItem
↓
renderItems()
↓
getOutDetailCountForActiveFilter(item.id, query)
↓
detailCountForCard
↓
affichage : Article / Articles dans la carte OUT
```

## 4. Pourquoi Page 2 lit actuellement `pages/page3/items`

Page 2 ne lit pas `pages/page3/items` uniquement pour le compteur simple par carte. Cette lecture alimente plusieurs fonctionnalités Page 2.

### 4.1 Compteur par carte OUT

`subscribeDetailCounts(siteId)` utilise `ensureSiteDetailsLoaded(siteId)` pour compter les détails par `itemId`.

### 4.2 Recherche par article

`outMatchesSearch(item, query)` vérifie d'abord le numéro OUT, puis utilise `detailDesignationsByItem[item.id]` pour rechercher dans les désignations d'articles. Ces désignations proviennent de `subscribeDetailDesignations(siteId)`, qui charge aussi `pages/page3/items` via `ensureSiteDetailsLoaded(siteId)`.

### 4.3 Filtres de statut Page 2

Les filtres `Tous`, `Terminés`, `En cours`, `À corriger`, `K.O` utilisent les lignes détail via `detailRowsByItem`, alimentées par `subscribeDetailRows(siteId)`. Les fonctions `itemMatchesStatusFilter()`, `getMatchingDetailCountForItem()`, `getTotalMatchingDetailCount()` et `updateCursorFilterCounters()` dépendent de ces détails.

### 4.4 Carte de progression Page 2

`updateItemProgressStatsCard()` affiche un total et des pourcentages à partir des compteurs de filtres calculés sur les détails Page 3.

### 4.5 Export Page 2

Le code d'export Page 2 utilise des lignes détail pour exporter les articles d'un site/OUT. La lecture Page 3 reste donc utile pour l'export et les données article.

### 4.6 Conclusion sur cette lecture

La lecture `pages/page3/items` sert au compteur, mais aussi à la recherche par article, aux filtres de statut, à la carte de progression et aux flux d'export/articles. Elle ne peut pas être supprimée globalement de Page 2 uniquement parce qu'un champ `articleCount` serait ajouté. En revanche, le compteur simple peut être découplé si un compteur fiable est stocké ailleurs.

## 5. Structure actuelle du document site `pages/page1/items`

### 5.1 Champs explicitement créés pour un site

`createSite()` crée un document `pages/page1/items` avec les champs suivants :

| Champ | Rôle |
|---|---|
| `nom` | nom du site |
| `outCount` | compteur d'OUT Page 2 associés au site |
| `ownerId` | propriétaire |
| `createdBy` | créateur |
| `createdByName` | nom du créateur |
| `dateCreation` | date de création |
| `dateModification` | date de modification |

### 5.2 Champs de compteur trouvés

| Champ | Présence | Rôle exact identifié |
|---|---:|---|
| `outCount` | Oui | Nombre d'OUT (`pages/page2/items`) associés au site. Utilisé par Page 1 et maintenu lors des créations/suppressions/restaurations/imports d'OUT. |
| `articleCount` | Non trouvé dans le code applicatif | Aucun rôle actuel. |
| `articlesCount` | Non trouvé dans le code applicatif | Aucun rôle actuel. |
| `detailsCount` | Non trouvé comme champ site | Aucun rôle site actuel. |
| `itemsCount` | Non trouvé comme champ site | Aucun rôle site actuel. |
| `totalArticles` | Non trouvé comme champ site | Aucun rôle actuel. |

### 5.3 Normalisation de `outCount`

Au chargement, si un site n'a pas `outCount`, le code ajoute `site.outCount = 0` en mémoire et marque `__outCountWasMissing`. Si le champ existe, il est normalisé via `normalizeOutCount()`.

`outCount` ne peut pas remplacer le compteur d'articles Page 2 : il compte les OUT Page 2, pas les détails Page 3.

## 6. Un champ `articleCount` est-il possible ?

Réponse : **OUI MAIS AVEC CONDITIONS**.

Un champ `articleCount` sur le document site pourrait représenter exactement le total non filtré des documents `pages/page3/items` du site, c'est-à-dire :

```text
articleCount = nombre de documents pages/page3/items où siteId == site.id
```

Conditions nécessaires :

1. Le champ doit être maintenu sur toutes les opérations qui créent ou suppriment des documents Page 3.
2. Il doit être décrémenté dès qu'un article est déplacé en corbeille, car le code actuel supprime immédiatement le document `pages/page3/items` lors de `removeDetail()`.
3. Il doit être incrémenté lors de la restauration d'un détail depuis la corbeille.
4. Il doit être mis à jour lors de la restauration d'un OUT avec ses détails.
5. Il doit être initialisé/migré pour les sites existants par comptage réel de `pages/page3/items where siteId == site.id`.
6. Il ne permettrait de remplacer que le total non filtré au niveau site. Il ne remplacerait pas les compteurs par OUT, la recherche par désignation, les filtres de statut ou les compteurs filtrés sans champs supplémentaires ou agrégats plus fins.

Important : le compteur affiché dans chaque carte OUT est aujourd'hui un compteur par OUT (`itemId`), pas seulement un total site. Un unique `site.articleCount` ne suffirait pas à afficher le nombre d'articles de chaque OUT. Si l'objectif est uniquement un total Page 2 au niveau du site sélectionné, `site.articleCount` convient sous conditions. Si l'objectif est le compteur `Article(s)` sur chaque carte OUT, il faudrait plutôt un compteur par OUT, par exemple au niveau des documents `pages/page2/items`, ou conserver la lecture Page 3.

## 7. Événements qui modifient le nombre d'articles

Le nombre d'articles au sens Page 2 correspond aux documents `pages/page3/items`. Les événements pertinents sont donc les opérations qui ajoutent ou suppriment ces documents.

| Action | Fichier | Fonction | Collection | Impact compteur |
|---|---|---|---|---|
| Création d'article | `js/storage.js` | `createDetail(siteId, itemId, payload)` | `pages/page3/items` | `+1` pour le site du détail |
| Modification d'article | `js/storage.js` | `updateDetail(siteId, itemId, detailId, changes)` | `pages/page3/items` | `0` si `siteId` et `itemId` ne changent pas ; le code ne modifie pas `siteId`/`itemId` |
| Suppression d'article | `js/storage.js` | `removeDetail(siteId, itemId, detailId)` | `pages/page3/items` + éventuellement `trash` | `-1` dès la suppression du document Page 3 |
| Restauration d'article | `js/storage.js` | `restoreDetail(snapshot)` | `pages/page3/items` | `+1` pour le site du détail restauré |
| Suppression d'OUT | `js/storage.js` | `removeItem(siteId, itemId)` | `pages/page2/items`; détails sauvegardés en corbeille si chargés | Impact indirect : les détails associés sont retirés de l'état local, mais le code audité ne supprime pas explicitement les documents `pages/page3/items` dans ce flux |
| Restauration d'OUT | `js/storage.js` | `restoreItem(snapshot)` | `pages/page2/items` et `pages/page3/items` | `+N` détails restaurés avec le nouvel OUT |
| Suppression de site | `js/storage.js` | `removeSite(siteId)` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | `-N` pour tous les détails du site, mais le site est supprimé |
| Restauration de site | `js/storage.js` | `restoreSite(snapshot)` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | `+N` pour les détails restaurés sur le nouveau site |
| Import | `js/storage.js` | `importData(payload)` | `pages/page1/items`, `pages/page2/items`, `pages/page3/items` | `+N` détails importés par site |
| Export | `js/storage.js` | `exportData()` | Lecture état local uniquement | `0` |

## 8. Corbeille

### 8.1 Suppression d'un article avec corbeille activée

`removeDetail()` vérifie `isTrashEnabled()`. Si la corbeille est activée, il crée une entrée `trash` contenant le détail, puis supprime le document `pages/page3/items/{detailId}`.

Conséquence actuelle : le compteur diminue dès le passage en corbeille, car le document Page 3 n'est plus dans la collection comptée.

### 8.2 Restauration d'un article

`restoreTrashEntry()` appelle `restoreDetail(snapshot)` pour une entrée `detail`. `restoreDetail()` recrée un nouveau document dans `pages/page3/items` et l'ajoute à l'état local.

Conséquence actuelle : le compteur augmente lors de la restauration.

### 8.3 Suppression définitive après 24 h

`subscribeTrashEntries()` déclenche `purgeExpiredTrashEntries()`. Les entrées de corbeille expirées sont supprimées de la collection `trash`. Comme le document Page 3 a déjà été supprimé au moment du passage en corbeille, la purge définitive ne doit pas modifier le compteur actuel.

### 8.4 Logique à conserver pour un futur `articleCount`

Un futur `articleCount` devrait suivre la même logique que le compteur actuel :

- décrémenter au moment du passage en corbeille, car le document Page 3 est supprimé ;
- incrémenter lors de la restauration ;
- ne pas changer lors de la purge définitive d'une entrée déjà supprimée de Page 3.

## 9. Changement de site

Aucune fonction de déplacement d'article Page 3 vers un autre site n'a été identifiée dans le code audité.

`updateDetail()` ne synchronise que les champs `code`, `designation`, `qteSortie`, `unite`, `qteRetour`, `qtePosee`, `qteRebus`, `observation`, `dateRetour`, `statut` et `dateModification`. Elle ne modifie pas `siteId` ni `itemId`.

Si une telle fonctionnalité était ajoutée plus tard, l'impact attendu serait :

```text
Site A : articleCount - 1
Site B : articleCount + 1
```

Mais cette opération n'existe pas réellement dans le code actuel.

## 10. Import / export

### 10.1 Import

`importData(payload)` normalise les données, crée les sites dans `pages/page1/items`, crée les OUT dans `pages/page2/items`, puis crée les détails dans `pages/page3/items`. Plusieurs articles peuvent donc être créés par import.

Un futur `articleCount` devrait être maintenu pendant ou après l'import, par exemple en calculant le nombre de détails ajoutés par `mappedSiteId` et en écrivant/incrémentant le compteur correspondant. Le code actuel ne le fait pas, car `articleCount` n'existe pas.

### 10.2 Export

`exportData()` construit un payload depuis `state.sites`, `state.itemsBySite` et `state.detailsByItem`. Il ne crée, ne modifie et ne supprime aucun document Firestore. Impact compteur : `0`.

## 11. Cohérence avec les données existantes

Pour initialiser un futur `articleCount` sur les sites existants, il faudrait calculer :

```text
articleCount(site) = nombre de documents pages/page3/items où siteId == site.id
```

Collection à utiliser :

```text
pages/page3/items
```

Requête nécessaire par site :

```js
query(makePageItemsCollection('page3'), where('siteId', '==', siteId))
```

Une migration serait nécessaire pour les documents `pages/page1/items` existants, car `articleCount` n'est pas présent dans la structure actuelle.

## 12. Risques d'incohérence d'un compteur stocké

Un compteur stocké dans `pages/page1/items/{siteId}.articleCount` introduirait les risques suivants :

| Situation | Risque |
|---|---|
| Création d'article réussie puis incrément compteur échoué | `articleCount` trop faible |
| Incrément compteur réussi puis création article échouée | `articleCount` trop élevé |
| Suppression article réussie puis décrément échoué | `articleCount` trop élevé |
| Décrément réussi puis suppression échouée | `articleCount` trop faible |
| Restauration détail partiellement réussie | compteur potentiellement trop faible ou trop élevé selon l'ordre des écritures |
| Import interrompu | compteur incomplet si les détails sont partiellement créés |
| Restauration OUT/site avec plusieurs détails | nécessité de compter exactement les détails restaurés |
| Suppression de site | le champ disparaît avec le site ; pas besoin de décrément final, mais attention aux opérations partielles de suppression enfants/site |
| Opérations multi-documents non transactionnelles | risque de désynchronisation durable jusqu'à réconciliation |

Le projet connaît déjà ce type de risque pour `outCount`, car les écritures `pages/page2/items` et `outCount` ne sont pas toujours atomiques de bout en bout.

## 13. Impact sur les lectures Firestore

### Situation actuelle

Pour Page 2, le flux peut inclure :

```text
lecture du site sélectionné
lecture de pages/page2/items pour les OUT du site
lecture de pages/page3/items where siteId == siteId pour les compteurs/articles/recherche/filtres
```

### Future solution potentielle avec `site.articleCount`

Pour le compteur total non filtré au niveau site :

```text
lecture du site sélectionné
lecture de pages/page2/items pour les OUT du site
lecture de site.articleCount depuis le document site déjà disponible
```

Impact qualitatif sur le compteur seul : **important** si le site contient beaucoup de documents Page 3, car une requête qui lit tous les articles du site serait remplacée par un champ déjà présent sur le document site.

Impact qualitatif sur la Page 2 complète : **faible à moyen** dans le code actuel, car Page 2 utilise encore les documents Page 3 pour d'autres fonctions : recherche par article, filtres, progression, données d'export et compteurs par OUT.

Aucun chiffre réel n'est inventé ici ; le dépôt ne contient pas les volumes Firestore de production.

## 14. Indépendance Page 2 / Page 3

### A. Indépendance du compteur

Oui, pour un compteur total site non filtré, Page 2 pourrait afficher un `articleCount` lu depuis le document site sans accéder à `pages/page3/items` uniquement pour ce compteur.

Non, pour les compteurs actuels par carte OUT, si l'objectif est de conserver le nombre `Article(s)` de chaque OUT : un unique champ site `articleCount` ne suffit pas. Il faudrait soit conserver la lecture Page 3, soit stocker un compteur par OUT.

### B. Indépendance complète de Page 2

Non dans le code actuel. Page 2 utilise encore `pages/page3/items` pour :

- les désignations d'articles dans la recherche ;
- les filtres de statut ;
- les compteurs filtrés ;
- la carte de progression ;
- les lignes détail nécessaires à certains exports et calculs UI ;
- le nombre d'articles par OUT.

## 15. Options et recommandation

### Option A — Conserver la logique actuelle

Avantages :

- compteur toujours calculé depuis les documents réels chargés ;
- pas de risque de désynchronisation de compteur stocké ;
- compatible avec les filtres, la recherche et le détail par OUT.

Inconvénients :

- Page 2 doit lire `pages/page3/items` pour le site ;
- coût et latence potentiellement élevés si un site contient beaucoup d'articles ;
- couplage maintenu entre Page 2 et Page 3.

Impact Firestore : **important** pour les gros sites, car tous les détails du site sont lus.

Complexité : **faible**.

Risque d'incohérence : **faible**, car le compteur est dérivé des documents chargés.

### Option B — Créer un champ `articleCount` dans le document site

Avantages :

- permet d'afficher un total articles site sans requête Page 3 dédiée ;
- réduit les lectures Firestore pour ce compteur ;
- cohérent avec l'approche déjà utilisée pour `outCount`.

Inconvénients :

- nécessite migration des sites existants ;
- nécessite maintenance sur création, suppression, restauration, import et suppression/restauration de site/OUT avec détails ;
- ne remplace pas les compteurs par OUT ni les filtres/recherches basés sur les lignes détail ;
- risque de désynchronisation si les écritures ne sont pas atomiques.

Impact Firestore : **important pour le compteur total**, mais **limité pour la Page 2 complète** tant que d'autres fonctionnalités lisent Page 3.

Complexité : **moyenne à élevée** selon le niveau d'atomicité/réconciliation choisi.

Risque d'incohérence : **moyen à élevé** sans transaction/batch/réconciliation.

### Option C — Compteurs par OUT existants ou à créer

Aucune solution existante complète n'a été identifiée dans le projet pour stocker le nombre d'articles par OUT. Une solution future pourrait consister à ajouter un compteur sur chaque document `pages/page2/items`, par exemple `detailCount`, si l'objectif réel est de supprimer la lecture Page 3 pour afficher le compteur `Article(s)` de chaque carte OUT.

Avantages :

- correspond mieux au compteur actuellement affiché par carte OUT ;
- permettrait à Page 2 d'afficher les nombres d'articles par OUT après lecture de `pages/page2/items` seulement.

Inconvénients :

- migration plus fine nécessaire, par OUT ;
- maintenance lors de création/suppression/restauration/import de détails ;
- ne remplace pas les filtres de statut ni la recherche par désignation sans agrégats supplémentaires.

Impact Firestore : **important pour les compteurs par carte**, mais incomplet pour l'indépendance totale.

Complexité : **élevée**.

Risque d'incohérence : **moyen à élevé** sans écritures atomiques.

### Recommandation

Recommandation : **Option B uniquement si l'objectif est un total d'articles au niveau du site ; Option C si l'objectif est le compteur `Article(s)` affiché dans chaque carte OUT.**

Le champ `articleCount` au niveau site est pertinent pour découpler un compteur total Page 2 de la lecture Page 3. En revanche, il ne représente pas exactement le compteur par OUT actuellement rendu sur les cartes Page 2. Pour éviter une régression fonctionnelle, il faut d'abord clarifier si le compteur visé est :

1. un total site affiché dans l'en-tête ou une zone Page 2 ;
2. le compteur `Article(s)` par OUT dans chaque carte ;
3. les compteurs filtrés de la Page 2.

## Conclusion

### Source actuelle du compteur

La source actuelle est l'état local `state.detailsByItem`, rempli à partir des documents `pages/page3/items`. Le compteur simple par OUT utilise `details.length` via `buildDetailCountsForSite(siteId)`, puis `detailCountsByItem[itemId]` dans `renderItems()`.

### Collection actuellement lue

```text
pages/page3/items
```

### Requête actuelle

```js
readDetailsByQuery(where('siteId', '==', normalizedSiteId))
```

Cette requête lit les documents Page 3 du site courant.

### Pourquoi Page 2 lit Page 3

Page 2 lit Page 3 pour compter les articles, mais aussi pour la recherche par désignation d'article, les filtres de statut, les compteurs filtrés, la carte de progression, l'export et les lignes de détails utilisées en mémoire.

### Le compteur peut-il être stocké au niveau du site ?

**OUI AVEC CONDITIONS** pour un total d'articles du site.

**NON** si l'objectif est de remplacer exactement le compteur `Article(s)` par OUT actuellement affiché dans chaque carte avec un unique champ site.

### Champ recommandé

- Pour un total site : `articleCount` sur `pages/page1/items/{siteId}`.
- Pour le compteur par OUT : un compteur par document OUT serait plus adapté, par exemple sur `pages/page2/items/{itemId}`, mais cette solution n'existe pas actuellement dans le code.

### Événements nécessitant une mise à jour du compteur

Création d'article, suppression d'article, restauration d'article, restauration d'OUT avec détails, restauration de site avec détails, import de détails et toute future opération de déplacement d'article entre sites.

### Gestion de la Corbeille

Le compteur actuel diminue dès le passage d'un article en corbeille, car le document `pages/page3/items` est supprimé immédiatement. Il augmente lors d'une restauration. La purge définitive après 24 h ne devrait pas modifier un futur `articleCount`, car l'article est déjà sorti de la collection comptée.

### Impact estimé sur les lectures Firestore

Impact **important** pour le compteur total seul si `articleCount` est déjà disponible dans le document site. Impact **faible à moyen** sur la Page 2 complète, car d'autres fonctionnalités continuent à dépendre de `pages/page3/items`.

### Indépendance du compteur

Oui, pour un compteur total site non filtré stocké en `articleCount`. Non, pour les compteurs par OUT ou les compteurs filtrés sans agrégats supplémentaires.

### Indépendance complète de Page 2

Non. Le code actuel utilise encore `pages/page3/items` pour d'autres fonctionnalités Page 2.

### Recommandation finale

Introduire `articleCount` au niveau du site est recommandé uniquement pour un total d'articles du site et uniquement avec migration, maintenance sur tous les événements listés, et stratégie de réconciliation/atomicité. Pour remplacer le compteur `Article(s)` affiché sur chaque carte OUT, un compteur par OUT serait plus exact qu'un unique `articleCount` site. Aucune implémentation ne doit être faite dans le cadre de cet audit.
