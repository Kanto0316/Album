# AUDIT — Page 3 : couleur des quantités dans l'historique des retours

## Fichiers modifiés

- `js/app.js` : le total de l'historique rend désormais sa valeur dans le span ciblé `return-history__total-value`.
- `css/style.css` : les valeurs de quantité de l'historique, le total, et le champ temporaire d'édition inline utilisent la couleur existante `var(--text)`.

## Couleur existante réutilisée

- La couleur est la variable CSS globale existante `--text`, définie à `#1f2a37`.
- Cette variable est déjà la couleur de texte de Page 3 : le `body` l'applique à toute la page, y compris aux valeurs affichées dans le tableau des quantités (`Qté Sortie`, `Qté posée`, `Qté Rebus` et `Qté Retour`).
- Aucune nouvelle couleur, valeur hexadécimale, variable de palette ou palette supplémentaire n'a été créée.

## Éléments concernés

- Chaque nombre de retour dans l'historique (`5` dans `5 unité(s)`, par exemple) conserve le texte `unité(s)` inchangé et applique `var(--text)` seulement au nombre.
- La valeur numérique de `Total retourné : 7` applique la même variable ; le libellé `Total retourné :` conserve son style.
- Le champ d'édition inline temporaire utilise également `var(--text)`. Après validation, le rendu de l'historique réapplique la classe de quantité, donc la nouvelle valeur garde la même couleur.

## Régressions et Firestore

- Aucun autre élément du modal « Ajouter un retour » n'a été modifié.
- La logique d'ajout, de modification inline, de suppression et de recalcul du total est inchangée.
- Aucune logique Firestore n'a été modifiée.
- Aucune lecture Firestore supplémentaire n'a été ajoutée.
