# Rapport de correction — Shimmer de la page 2

## Cause identifiée

Le Shimmer global était démarré par `UiService.startContentLoadingState()` au chargement du document, puis arrêté par `UiService.markAppReady()` dans le `finally` du bootstrap. Or l'initialisation de la page 2 ne retournait aucune promesse : ses abonnements Firestore (OUT, détails et statistiques), la lecture des achats et la résolution des noms utilisateurs continuaient après la fin du bootstrap. Le Shimmer dépendait donc de l'initialisation générale du DOM et de l'authentification, pas de la fin réelle du chargement et du rendu de la page 2.

Un second défaut réduisait la qualité du repli hors ligne : lorsque la lecture distante de la page 1 réussissait, le snapshot local complet n'était pas appliqué au préalable. Les données page 2 en cache pouvaient donc ne pas être disponibles si sa lecture Firestore dédiée échouait.

## Fichiers modifiés

- `js/app.js` : ajout de l'état explicite `isPage2Loading`, création d'une barrière regroupant toutes les lectures initiales de la page 2, attente du rendu navigateur et gestion du repli cache.
- `js/storage.js` : exposition de la promesse `initialRead` sur les abonnements, hydratation initiale du cache et mutualisation des lectures de détails simultanées.
- `tests/page2-shimmer-loading.test.mjs` : contrôles de non-régression de la barrière de chargement.
- `RAPPORT_CORRECTION_SHIMMER_PAGE2.md` : présent rapport.

Les fichiers HTML et CSS n'ont pas nécessité de modification : le design et l'animation Shimmer existants restent inchangés.

## Logique avant / après

### Avant

1. `ui.js` activait le Shimmer au démarrage.
2. Le bootstrap initialisait la page 2 et lançait plusieurs lectures asynchrones sans les attendre.
3. Le `finally` appelait immédiatement `markAppReady()` après l'initialisation synchrone.
4. Le Shimmer disparaissait alors que Firestore, le cache, les statistiques ou les cartes pouvaient encore évoluer.

### Après

1. La page 2 positionne `isPage2Loading = true` et `aria-busy="true"`.
2. Chaque abonnement de stockage expose une promesse `initialRead`, résolue après la réponse serveur ou, en cas d'erreur, après le rendu des données en cache.
3. La page attend ensemble :
   - les OUT ;
   - les compteurs/statistiques de détails ;
   - les désignations utilisées par la recherche ;
   - les lignes de détails utilisées par les filtres ;
   - les achats ;
   - les noms utilisateurs.
4. Les données sont traitées par les callbacks existants et les cartes/statistiques sont rendues.
5. Une `requestAnimationFrame` confirme que les changements ont été remis au navigateur.
6. `isPage2Loading` passe à `false`, `aria-busy` est retiré, la promesse d'initialisation se termine, puis seulement `markAppReady()` masque le Shimmer.

## Condition exacte de disparition du Shimmer

Sur la page 2, le Shimmer est masqué uniquement lorsque `Promise.all(initialReads)` est résolue **et** qu'une frame de rendu supplémentaire a été atteinte. Cette liste comprend toutes les lectures initiales citées ci-dessus. Le bootstrap attend désormais explicitement `initSiteDetailPage(...)`.

En cas d'erreur Firestore, `initialRead` se résout après le callback de repli cache. La page sort donc proprement de l'état de chargement et affiche un toast indiquant que certaines données proviennent du cache. Il n'existe aucun délai artificiel.

## Tests réalisés

- Vérification syntaxique JavaScript avec `node --check`.
- Exécution de la suite Node complète avec `node --test`.
- Contrôle statique dédié vérifiant l'état explicite, toutes les dépendances de la barrière, l'attente de la frame de rendu, l'attente du contrôleur page 2 par le bootstrap et le chemin serveur/cache.
- Contrôle Git des espaces et erreurs de patch avec `git diff --check`.

## Absence d'impact sur les autres pages

- Le bootstrap n'attend le nouveau contrôleur que lorsque `data-page="site-detail"`.
- L'API historique des abonnements reste compatible : leur valeur de retour demeure une fonction de désabonnement, enrichie d'une propriété `initialRead` facultative.
- Les sélecteurs, classes CSS, durées et animations du Shimmer ne changent pas.
- Les structures Firestore et les formats de données ne changent pas.
- Aucun composant Android n'a été modifié.
