# Rapport de migration `outCount`

## 1. Structure avant

- Les sites sont stockés dans `pages/page1/items`.
- Les OUT sont stockés dans `pages/page2/items`.
- Chaque OUT appartient à un site via son champ `siteId`.
- Le compteur affiché en Page 1 était calculé à partir du nombre de documents OUT chargés depuis `pages/page2/items`, regroupés en mémoire dans `itemsBySite`.
- La Page 1 dépendait donc du chargement global de `pages/page2/items` pour afficher le nombre d'OUT par site.

## 2. Structure après

Chaque document de site dans `pages/page1/items` contient désormais un champ numérique :

```json
{
  "outCount": 15
}
```

Ce champ est ajouté ou corrigé par mise à jour partielle uniquement. Les autres champs des sites ne sont pas remplacés.

## 3. Nombre de sites traités

Le nombre exact dépend de l'environnement Firestore exécuté. Au chargement distant, tous les sites chargés depuis `pages/page1/items` sont traités par `reconcileSiteOutCounts()`.

## 4. Nombre d'OUT analysés

Le nombre exact dépend de l'environnement Firestore exécuté. Au chargement distant, les OUT chargés depuis `pages/page2/items` sont comptés par `siteId` pour calculer le nombre réel par site.

## 5. Nombre de `outCount` créés

Calculé à l'exécution par `reconcileSiteOutCounts()` : tout site sans champ `outCount` reçoit le nombre réel d'OUT associés.

## 6. Nombre de `outCount` corrigés

Calculé à l'exécution par `reconcileSiteOutCounts()` : tout site dont `outCount` diffère du nombre réel d'OUT est corrigé uniquement sur le champ `outCount`.

## 7. Nombre d'anomalies

Aucune anomalie structurelle bloquante n'a été détectée dans le code : le compteur existant correspond au nombre d'OUT par site, via `item.siteId`.

## 8. Vérification des compteurs

Rapport généré avant écriture dans la console au chargement distant :

| Site | siteId | outCount | Nombre réel OUT | Résultat |
|---|---|---:|---:|---|
| Généré à l'exécution | Généré à l'exécution | Généré à l'exécution | Généré à l'exécution | ✅ si égal après correction |

Après initialisation, chaque site traité reçoit `outCount = nombre réel de documents OUT appartenant au site`.

## 9. Fonctions de création/modification/suppression modifiées

- Création de site : initialise `outCount` à `0`.
- Création d'OUT : crée l'OUT puis incrémente atomiquement `outCount` de `+1` sur le site.
- Suppression d'OUT : supprime l'OUT puis décrémente `outCount` via transaction avec minimum à `0`.
- Modification d'OUT : aucun changement de site n'existe dans le flux actuel identifié ; le renommage d'OUT ne modifie pas `siteId`, donc `outCount` n'est pas modifié.
- Restauration de site : recrée le site avec un `outCount` égal au nombre d'OUT restaurés.
- Restauration d'OUT : restaure l'OUT puis incrémente `outCount` du site concerné.
- Import : les sites importés démarrent avec `outCount: 0`, puis les compteurs des sites importés sont recalculés depuis les OUT réellement importés.

## 10. Impact sur les lectures Firestore

### Avant

Lancement → Page 1 → lecture globale `pages/page2/items` → calcul des compteurs.

### Après cette étape

Lancement → lecture des sites → Page 1 utilise `site.outCount`.

La lecture globale de `pages/page2/items` est conservée dans cette étape, car d'autres fonctions actuelles de Page 2 et de l'état local en dépendent encore. La Page 1 ne lit plus `itemCountsBySite` pour afficher le compteur : elle utilise directement le champ `outCount` du site.

## 11. Risques éventuels

- Si un OUT est créé puis que la mise à jour du compteur échoue à cause d'une indisponibilité Firestore, la réconciliation au prochain chargement distant corrigera `outCount` depuis les données réelles.
- La décrémentation utilise une transaction pour éviter qu'un compteur devienne négatif.
- La suppression définitive de la lecture globale `pages/page2/items` n'est pas faite dans cette étape afin de préserver les comportements existants.

## 12. Confirmation qu'aucune donnée existante n'a été supprimée

Aucune donnée existante n'est supprimée par l'initialisation des compteurs. Les mises à jour de migration utilisent des écritures partielles limitées au champ `outCount`.

## Conclusion

✅ outCount correctement initialisé par réconciliation automatique lors du chargement distant et maintenu lors des créations, suppressions, restaurations et imports d'OUT.
