# Audit séparation Page 1 / Page 2 — chargement Firestore ciblé par site

## Statut

✅ Séparation Page 1 / Page 2 appliquée côté code.

Page 1 n'a plus besoin de charger globalement `pages/page2/items` au démarrage pour afficher les compteurs OUT. Page 2 charge les OUT avec une requête ciblée `where('siteId', '==', siteId)` uniquement lors de l'ouverture d'un site.

## 1. Lectures Firestore au démarrage

Au démarrage distant, `loadRemoteSnapshot()` lit uniquement :

- `pages/page1/items` pour les sites ;
- `materialCodes` pour le typeahead ;
- conditionnellement `pages/page3/items` uniquement si `materialCodes` est vide, via le bootstrap historique existant.

`pages/page2/items` n'est plus lu globalement par `loadRemoteSnapshot()`.

## 2. Collections lues

| Moment | Collection | Fonction | Type |
|---|---|---|---|
| Démarrage | `pages/page1/items` | `readPageItems('page1')` | Globale sites |
| Démarrage | `materialCodes` | `readMaterialCodes()` | Globale catalogue |
| Bootstrap catalogue vide | `pages/page3/items` | `bootstrapMaterialCodesFromDetails()` | Globale conditionnelle existante |
| Ouverture Page 2 | `pages/page2/items` | `readPage2ItemsBySite(siteId)` | Ciblée par `siteId` |
| Page 2 détails site | `pages/page3/items` | `ensureSiteDetailsLoaded(siteId)` | Ciblée par `siteId` |
| Page 3 | `pages/page3/items` | `ensurePairDetailsLoaded(siteId, itemId)` | Ciblée par `siteId + itemId` |

## 3. Requêtes globales

- Conservées : lecture globale des sites Page 1 (`pages/page1/items`).
- Conservée : lecture globale `materialCodes` pour le typeahead.
- Conservée conditionnellement : bootstrap `pages/page3/items` uniquement si `materialCodes` est vide, sans modification du typeahead.
- Supprimée du démarrage : lecture globale `pages/page2/items`.

## 4. Requêtes ciblées

- Page 2 : `pages/page2/items` avec `where('siteId', '==', siteId)`.
- Page 2 détails : `pages/page3/items` avec `where('siteId', '==', siteId)`.
- Page 3 : `pages/page3/items` avec `where('siteId', '==', siteId)` et `where('itemId', '==', itemId)`.

## 5. Page 1

Page 1 utilise les sites et le champ `outCount`. Le listener `subscribeItemCounts()` émet désormais les compteurs depuis `site.outCount`, et non depuis les OUT complets en mémoire.

Fonctions conservées : affichage, recherche, filtres, tri, date de création, créateur, navigation, édition, verrouillage et suppression. Les écritures de site restent partielles (`setDoc(..., { merge: true })`, `updateDoc()` ou transaction ciblée sur `outCount`).

## 6. Page 2

`subscribeItems(siteId)` ne suppose plus que tous les OUT sont déjà en mémoire. À l'inscription :

1. elle enregistre le listener du site demandé ;
2. elle émet `[]` si le site n'est pas encore chargé, pour éviter d'afficher les OUT d'un autre site ;
3. elle déclenche `ensureSiteItemsLoaded(siteId)` ;
4. elle lit uniquement les OUT du site via `readPage2ItemsBySite(siteId)` ;
5. elle met le cache mémoire à jour par site.

Les recherches, filtres, tris, compteurs de cartes et actions Page 2 restent locaux sur les OUT du site courant.

## 7. Page 3

Aucun changement fonctionnel Page 3 n'a été introduit. Le chargement reste ciblé par paire `siteId + itemId` via `ensurePairDetailsLoaded(siteId, itemId)`.

## 8. Typeahead / `materialCodes`

`materialCodes` n'a pas été remplacé par une lecture globale Page 3. Les fonctions de suggestions, déduplication, casse, sélection et remplissage continuent d'utiliser le catalogue existant.

## 9. Cache

Le cache conserve les sites, les OUT déjà chargés par site, les détails déjà chargés et `materialCodes`. Un cache frais peut réhydrater les OUT déjà consultés, mais il ne déclenche pas de lecture globale `pages/page2/items` au démarrage. Les nouveaux sites consultés sont chargés à la demande puis conservés en mémoire/cache.

## 10. Listeners

Les listeners applicatifs locaux sont conservés. Aucun nouveau `onSnapshot()` Firestore n'a été ajouté pour Page 1/Page 2. Le listener global historique `subscribeOutCreationPoints()` sur `pages/page2/items` reste limité à la page utilisateurs et n'est pas utilisé par le chargement Page 1/Page 2.

## 11. Écritures

- Création site : document Page 1 créé avec `outCount: 0`.
- Création OUT : document Page 2 créé avec `siteId`, puis incrément atomique `outCount + 1`.
- Modification OUT actuelle : renommage uniquement, pas de changement `siteId`, donc pas de modification `outCount`.
- Suppression OUT : suppression ciblée par `itemId`, puis transaction de décrément avec minimum à `0`.
- Import/restauration : les OUT ajoutés sont insérés dans le cache du site concerné et `outCount` est recalculé sur les sites importés/restaurés concernés.

## 12. Fonctions impactées

| Fonction | Collection | Avant | Après | Global/Ciblée |
|---|---|---|---|---|
| `loadRemoteSnapshot()` | `pages/page2/items` | Lecture globale au démarrage | Plus de lecture Page 2 au démarrage | Supprimée |
| `subscribeItemCounts()` | `pages/page1/items` / état sites | Compteurs depuis `state.itemsBySite` | Compteurs depuis `site.outCount` | Ciblée état sites |
| `subscribeItems(siteId)` | `pages/page2/items` | État supposé déjà rempli globalement | Appelle `ensureSiteItemsLoaded(siteId)` | Ciblée |
| `readPage2ItemsBySite(siteId)` | `pages/page2/items` | N'existait pas | `where('siteId', '==', siteId)` | Ciblée |
| `ensureSiteItemsLoaded(siteId)` | `pages/page2/items` | N'existait pas | Cache par site + lecture à la demande | Ciblée |
| `removeSite(siteId)` | `pages/page2/items`, `pages/page3/items` | Utilisait l'état global | Charge le site ciblé avant suppression | Ciblée par site |
| `createItem(siteId)` | `pages/page2/items` | Ajout après état global | Charge le site ciblé avant contrôle doublon, puis ajoute | Ciblée par site |
| `removeItem(siteId, itemId)` | `pages/page2/items` | Suppression depuis état global | Charge le site ciblé si nécessaire, puis supprime | Ciblée par site + doc |
| `ensureSiteDetailsLoaded(siteId)` | `pages/page3/items` | Ciblée | Inchangée | Ciblée |
| `ensurePairDetailsLoaded(siteId, itemId)` | `pages/page3/items` | Ciblée | Inchangée | Ciblée |
| `materialCodes` | `materialCodes` | Catalogue dédié | Inchangé | Globale catalogue |
| `subscribeOutCreationPoints()` | `pages/page2/items` | Listener global utilisateurs | Inchangé, hors Page 1/Page 2 | Global historique |

## 13. Tests effectués

- `node --check js/storage.js` : validation syntaxique JavaScript.
- `rg "readPageItems\\('page2'\\)|readPageItems\\(" -n js/storage.js` : vérification que `readPageItems('page2')` n'est plus appelé au démarrage.
- `rg "readPage2ItemsBySite|ensureSiteItemsLoaded|subscribeItemCounts|loadedItemSites" -n js/storage.js` : vérification des nouveaux points de chargement ciblé et de cache par site.

## 14. Régressions / limites éventuelles

- Aucun test navigateur authentifié n'a été exécuté dans cet environnement ; les validations fonctionnelles Page 1/Page 2/Page 3/typeahead doivent être confirmées sur une instance Firestore réelle.
- Les sites historiques sans champ `outCount` ne peuvent plus être corrigés par une lecture globale automatique Page 2 au démarrage. Ils sont normalisés à `0` en mémoire tant que le champ n'existe pas. La migration `outCount` doit donc rester validée en production avant cette séparation.
- `subscribeOutCreationPoints()` conserve volontairement une lecture/listener global Page 2 pour la page utilisateurs ; elle n'est pas liée au chargement Page 1/Page 2 demandé.

## 15. Comparaison avant/après

### Avant

Lancement → lecture globale `pages/page1/items` → lecture globale `pages/page2/items` → calcul compteurs depuis tous les OUT → Page 2 filtre localement le site.

### Après

Lancement → lecture globale `pages/page1/items` + `site.outCount` → Page 1 affiche les compteurs sans OUT complets → clic site → lecture ciblée `pages/page2/items where('siteId', '==', siteId)` → clic OUT → Page 3 ciblée `siteId + itemId`.

## Conclusion

✅ SÉPARATION RÉUSSIE côté architecture de chargement : Page 1 est indépendante des OUT complets, Page 2 charge les OUT par `siteId`, Page 3 reste ciblée, et le typeahead `materialCodes` reste inchangé.
