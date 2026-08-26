# AUDIT — Page 3 : quantité des retours modifiable

## Fichiers et fonctions modifiés

- `js/storage.js` : `addDetailReturn`, nouvelle validation partagée `validateDetailReturnQuantity`, et nouvelle mise à jour transactionnelle `updateDetailReturnQuantity`.
- `js/app.js` : rendu de l'historique, édition inline `beginInlineReturnQuantityEdit` et délégation des événements du modal.
- `css/style.css` : styles ciblés du nombre éditable et de son petit champ temporaire.

## Firestore et persistance

- La structure existante est conservée : chaque détail est `pages/page3/items/{detailId}` et les retours sont stockés dans son tableau `returns[]`.
- Chaque entrée utilise son `id` existant pour identifier le retour. La transaction lit puis écrit le même document via `runTransaction` et `transaction.update`.
- Pour un retour normal, seule la propriété `quantity` de l'entrée dont l'`id` correspond est remplacée. La date, la remarque, l'identifiant, les métadonnées éventuelles et toutes les autres entrées sont conservés.
- Le fallback historique sans `returns[]` conserve sa forme : seuls `qteRetour`, `dateRetour` et `dateModification` sont mis à jour.
- L'état local est mis à jour, puis `emitAll()` rafraîchit le tableau Page 3. Aucun rechargement de collection n'est déclenché ; la lecture transactionnelle du document concerné est nécessaire pour une validation cohérente face aux écritures concurrentes.

## Validation et calculs

- La même fonction `validateDetailReturnQuantity` sert à l'ajout et à la modification : entier strictement positif, puis plafond de quantité existant.
- Pour une modification, la disponibilité est calculée avec `totalRetours - ancienneQuantiteDuRetour`; le nouveau total est donc `totalRetours - ancienneQuantite + nouvelleQuantite`.
- Une quantité dépassant `qteSortie - qtePosee - qteRebus` est refusée, sans écriture et en conservant l'ancienne valeur. Le message existant de quantité invalide ou de disponibilité est réutilisé.
- `qteRetour` est recalculé, ainsi que `dateRetour` et `dateModification`. Le tableau recalcule l'écart avec sa règle existante (`qteSortie - qtePosee - qteRetour - qteRebus`).

## Interface et fonctionnalités conservées

- En état normal, la quantité est un texte dans `N unité(s)` ; aucun input permanent n'est rendu.
- Un clic/tap, Entrée ou Espace sur le nombre remplace seulement ce nombre par un petit champ inline. Il reçoit le focus et sa valeur est sélectionnée. Entrée ou la perte de focus valide ; Échap annule.
- Une valeur invalide restaure l'ancien texte. La suppression existante (bouton poubelle, confirmation et `removeDetailReturn`) n'est pas modifiée et conserve son recalcul de total/écart.
- L'export Excel utilise déjà `getTotalReturnQuantity(detail)` : il récupère donc automatiquement la quantité persistée mise à jour.
- Aucune lecture Firestore de collection supplémentaire n'a été ajoutée. La seule lecture supplémentaire est celle, ciblée, de la transaction d'édition du document concerné.
