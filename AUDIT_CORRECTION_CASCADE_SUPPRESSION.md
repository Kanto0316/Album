# Audit — correction des suppressions en cascade

## Problème initial

La suppression d'un OUT supprimait le document Page 2 et décrémentait `outCount`, mais conservait ses documents Page 3. La suppression d'un site lançait détails, OUT et parent avec `Promise.all`, sans garantir que les enfants soient confirmés avant le parent. Les achats matériels n'étaient ni capturés dans la corbeille ni supprimés avec le site.

## Fichiers modifiés

- `js/storage.js` : lectures serveur, snapshots de corbeille complets, orchestration des cascades et mutation locale après confirmation.
- `js/cascade-deletion.js` : séquences ordonnées et suppression contrôlée par lots.
- `tests/cascade-deletion.test.mjs` : ordre, erreur injectée, lots et rechargement serveur simulé.

## Nouvelle séquence

### OUT

1. Lecture serveur du document OUT et des détails filtrés par `siteId` et `itemId`.
2. Écriture du snapshot de corbeille complet si elle est activée.
3. Suppression et confirmation de tous les détails.
4. Appel inchangé à la transaction existante qui supprime l'OUT et décrémente `outCount`.
5. Seulement après succès : mise à jour de `detailsByItem`, `itemsBySite`, du compteur local, du cache, puis `emitAll()`.

### Site

1. Lecture serveur du site, de ses OUT, détails et achats.
2. Écriture du snapshot de corbeille (`site`, `items`, `details`, `purchases`).
3. Suppression des achats, puis des détails, puis des OUT.
4. Suppression du site en dernier.
5. Seulement après confirmation complète : mise à jour de l'état, du cache et des abonnés.

## Stratégie batch/transaction

Les enfants sont supprimés avec des `writeBatch` séquentiels limités à 450 écritures, sous la limite Firestore de 500. Chaque catégorie attend la confirmation de tous ses lots avant la suivante. La transaction `deleteOutAndDecrementCounter` reste inchangée et n'est appelée qu'après la confirmation des détails.

## Gestion des erreurs

Une erreur interrompt immédiatement la séquence : aucune mutation locale, persistance cache ou émission ne prétend que la suppression est complète. L'erreur est journalisée avec l'identifiant concerné et une erreur explicite demande un rechargement avant nouvelle tentative. Une cascade volumineuse ne pouvant être atomique entre plusieurs lots peut avoir supprimé une partie des enfants, mais jamais le parent avant eux. L'entrée de corbeille n'est pas retirée par le flux de suppression.

## Tests réalisés

Les tests Node vérifient : deux détails avant l'OUT et son compteur, l'ordre complet achats/détails/OUT/site, l'arrêt sur erreur détail, le découpage séquentiel des lots et l'absence de retour des données après un rechargement serveur simulé. La suite existante valide séparément la transaction du compteur OUT et les stratégies de lecture serveur/cache.

## Risques restants

- Firestore ne permet pas une atomicité globale au-delà de 500 écritures : une panne entre deux lots laisse le parent présent et rend l'état partiel détectable/rejouable.
- Un snapshot de corbeille est créé avant la cascade ; en cas d'échec il est volontairement conservé et peut nécessiter une décision utilisateur.
- Les règles Firestore et index composites doivent autoriser la lecture Page 3 par `siteId` + `itemId`.
