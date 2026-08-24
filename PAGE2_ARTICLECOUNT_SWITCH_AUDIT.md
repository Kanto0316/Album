# Audit — bascule du compteur simple Page 2 vers `articleCount`

## 1. Ancienne source du compteur

Avant cette modification, le compteur simple affiché sur chaque carte OUT de Page 2 était calculé dans `renderItems()` via `getOutDetailCountForActiveFilter(item.id, query)`.

Dans le cas `activeStatusFilter === 'all'` sans recherche active, `getOutDetailCountForActiveFilter()` retournait `Number(detailCountsByItem[itemId] || 0)`, donc une valeur issue des lignes Page 3 chargées en mémoire.

## 2. Nouvelle source du compteur

Pour le compteur simple uniquement, `renderItems()` lit désormais directement `item.articleCount` quand le document OUT possède ce champ.

La valeur affichée reste stockée dans la même variable `detailCountForCard`, et le HTML existant continue d'utiliser `${detailCountForCard}` ainsi que le libellé `Article` / `Articles`.

## 3. Conditions d'utilisation de `articleCount`

`item.articleCount` est utilisé uniquement lorsque toutes les conditions suivantes sont vraies :

- le filtre de statut actif est `all` ;
- aucune recherche n'est active ;
- le document OUT contient explicitement le champ `articleCount` ;
- le document OUT n'est pas marqué par la compatibilité locale `__articleCountWasMissing`.

Compatibilité ancienne donnée : si un ancien document OUT ne contient pas encore `articleCount`, le marquage local `__articleCountWasMissing` est conservé jusqu'à Page 2 et le code conserve le chemin existant avec `getOutDetailCountForActiveFilter(item.id, query)`, ce qui évite d'inventer une valeur incorrecte.

## 4. Fonctions non modifiées

Les fonctions suivantes n'ont pas été supprimées ni réécrites dans cette modification :

- `renderItems()` hors source du compteur simple ;
- `getOutDetailCountForActiveFilter()` ;
- `getMatchingDetailCountForItem()` ;
- `getMatchingOutArticles()` ;
- `itemMatchesStatusFilter()` ;
- `outMatchesSearch()` ;
- les fonctions basées sur `detailRowsByItem`.

## 5. Typeahead non modifié

Le typeahead n'a pas été modifié. Aucune logique de suggestion, de recherche assistée ou de désignation n'a été changée.

## 6. Filtres non modifiés

Les filtres n'ont pas été modifiés. Les filtres de statut continuent d'utiliser les lignes Page 3 via `detailRowsByItem` et les fonctions existantes.

## 7. Export non modifié

L'export n'a pas été modifié. Aucune logique d'export ni aucune fonction liée à l'export n'a été touchée.

## 8. Firestore non modifié

Aucune écriture Firestore n'a été ajoutée pour cette bascule d'affichage. La modification ne recalcule pas, ne supprime pas, ne corrige pas et ne met pas à jour `articleCount`.

## 9. Lectures Page 3 conservées

Les lectures Page 3 sont toujours conservées pour les autres fonctions. Les abonnements suivants restent présents :

- `subscribeDetailCounts()` ;
- `subscribeDetailDesignations()` ;
- `subscribeDetailRows()`.

Cette modification ne réalise pas de séparation complète entre Page 2 et Page 3.

## Verdict

🟢 Compteur simple Page 2 indépendant de Page 3
