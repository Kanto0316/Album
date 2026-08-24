# Rapport de migration `articleCount`

## 1. Structure avant

- Les OUT de Page 2 sont stockés dans `pages/page2/items/{itemId}`.
- Chaque OUT contient notamment `siteId`, `numero`, `magasin`, `ownerId`, `createdBy`, `createdByName`, `dateCreation` et `dateModification`.
- Les articles de Page 3 sont stockés dans `pages/page3/items/{detailId}`.
- Chaque article Page 3 contient `siteId` et `itemId` : `itemId` référence l'identifiant du document OUT Page 2 auquel l'article appartient.
- Le compteur affiché sur Page 2 sans recherche et sans filtre venait de `detailCountsByItem[itemId]`, construit à partir du nombre de lignes Page 3 groupées par couple `siteId:itemId`.
- `detailRowsByItem[itemId]` contient les lignes Page 3 triées par `champ` et reste utilisé pour la recherche et les filtres Page 2.

## 2. Structure après

- Les documents `pages/page2/items/{itemId}` conservent tous leurs champs existants.
- Un champ auxiliaire numérique `articleCount` est ajouté à chaque OUT.
- Exemple de document Page 2 après migration :

```json
{
  "siteId": "...",
  "numero": "OUT-0001",
  "articleCount": 12
}
```

## 3. Nombre d'OUT analysés

- Calculé par `reconcileItemArticleCounts()` à partir des OUT Page 2 chargés en mémoire pour les sites concernés.
- Le rapport détaillé avant/après peut être affiché avec `reconcileItemArticleCounts(siteIds, { logReport: true })`.

## 4. Nombre d'articles analysés

- Calculé par somme des documents Page 3 présents dans `state.detailsByItem` pour les OUT analysés.

## 5. Nombre de `articleCount` créés

- Retourné par `reconcileItemArticleCounts()` dans la propriété `created`.
- Un `articleCount` est considéré créé lorsque le champ était absent du document OUT chargé.

## 6. Nombre corrigé

- Retourné par `reconcileItemArticleCounts()` dans la propriété `corrected`.
- Un compteur est corrigé lorsque `articleCount` existait déjà mais ne correspondait pas au nombre réel de lignes Page 3.

## 7. Anomalies

- Aucune anomalie connue dans la relation attendue : Page 3 rattache chaque article à un OUT par `siteId` et `itemId`.
- Les détails sans `siteId` ou sans `itemId` sont ignorés par la logique existante de groupement et ne peuvent pas être attribués à un OUT.

## 8. Logique de création

- La création d'un OUT initialise `articleCount` à `0`.
- Après création réussie d'un article Page 3, le document OUT correspondant est mis à jour avec un incrément Firestore atomique `articleCount + 1`.

## 9. Logique de suppression

- Après suppression réussie d'un article Page 3, le document OUT correspondant est décrémenté.
- La décrémentation utilise une transaction Firestore et applique `Math.max(0, compteur + delta)` pour empêcher `articleCount < 0`.

## 10. Logique d'import

- À l'import, chaque OUT importé reçoit un `articleCount` recalculé depuis les articles Page 3 importés qui référencent cet OUT.
- Après l'import, une réconciliation recalcule les compteurs depuis les données réelles chargées pour éviter un double comptage.

## 11. Logique de restauration

- La restauration d'un site recrée chaque OUT avec un `articleCount` égal au nombre d'articles restaurés pour cet OUT.
- La restauration d'un OUT recrée l'OUT avec un `articleCount` égal au nombre d'articles restaurés avec lui.
- La restauration d'un article seul incrémente l'OUT cible avec l'opération sûre existante.

## 12. Risques éventuels

- La migration s'exécute pour les sites dont les OUT et les articles ont été chargés. Le chargement Page 3 de Page 2 est volontairement conservé à cette étape.
- Si Firestore refuse une mise à jour réseau, les données existantes restent intactes ; seule la synchronisation de `articleCount` peut être retardée.

## 13. Confirmation de protection des données

- Aucune suppression de données n'est effectuée par la migration `articleCount`.
- Les mises à jour utilisent des écritures partielles (`setDoc(..., { merge: true })`, `updateDoc` ou transaction `set(..., { merge: true })`).
- Les champs existants comme `itemId`, `siteId`, nom du site, dates, créateur, données OUT et données articles ne sont pas remplacés.

## Tableau avant/après

| OUT | itemId | Nombre réel Page 3 | articleCount | Écart |
|---|---|---:|---:|---:|
| Généré à l'exécution par `reconcileItemArticleCounts(..., { logReport: true })` |  |  |  |  |

## Conclusion

✅ `articleCount` est créé et synchronisé depuis le nombre réel de documents/lignes Page 3 appartenant à chaque OUT, tout en conservant les lectures Page 3 de Page 2 pour cette étape préparatoire.
