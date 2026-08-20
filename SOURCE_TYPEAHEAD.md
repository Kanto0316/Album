# Source du typeahead du champ « Code »

## Résumé

Le typeahead du champ **Code** du formulaire **Ajouter une donnée** n'utilise pas un fichier statique de codes. Sa source est construite côté navigateur à partir des détails déjà enregistrés dans la page 3 de l'application, c'est-à-dire les documents Firestore de la collection `pages/page3/items`, avec un repli possible sur le cache local `localStorage` lorsque le cache hors ligne est frais ou lorsque le chargement distant échoue.

Aucune nouvelle logique n'est nécessaire pour alimenter les suggestions : ajouter, modifier ou supprimer une ligne de détail existante met à jour la source parce que les données sont relues depuis l'état applicatif `state.detailsByItem`.

## Emplacement de l'interface

- Fichier HTML : `page3.html`
- Formulaire : `detailForm`, dans la modale `detailFormModal`
- Bouton d'ouverture : `openDetailFormButton`, libellé d'accessibilité `Ajouter une donnée`
- Champ concerné : `input#codeInput`
- Conteneur des suggestions : `div#codeSuggestions`

Le balisage du champ est :

```html
<div class="typeahead" id="codeTypeahead">
  <input id="codeInput" name="code" type="text" maxlength="40" aria-label="Code" autocomplete="off" />
  <div id="codeSuggestions" class="typeahead__menu" role="listbox" aria-label="Suggestions de code" hidden></div>
</div>
```

## Origine exacte des données

La source fonctionnelle du typeahead est le tableau JavaScript `codeSuggestionSource`, défini dans `initItemDetailPage()` dans `js/app.js`.

Ce tableau est rempli par `refreshCodeSuggestionSource()` :

1. `refreshCodeSuggestionSource()` appelle `StorageService.getAllDetails()`.
2. `StorageService.getAllDetails()` parcourt `state.detailsByItem` dans `js/storage.js` et renvoie une copie de tous les détails connus.
3. `refreshCodeSuggestionSource()` transmet ces détails à `buildCodeSuggestionSource(details)`.
4. `buildCodeSuggestionSource(details)` extrait les champs `code` et `designation`, déduplique par code insensible à la casse, puis trie par code.

La provenance persistante de `state.detailsByItem` est :

- distante : Firestore, collection `pages/page3/items`, chargée via `readPageItems('page3')` dans `loadRemoteSnapshot()` ;
- locale : `localStorage`, clé `suiviMateriel.offlineCache.v1`, champ `pages.page3`, utilisée par `parseOfflineState()` puis `applySnapshot()`.

## Fichiers source et chemins

| Rôle | Chemin | Élément |
| --- | --- | --- |
| Structure HTML du typeahead | `page3.html` | `#codeTypeahead`, `#codeInput`, `#codeSuggestions` |
| Logique UI du typeahead | `js/app.js` | `initItemDetailPage()` |
| Construction de la source | `js/app.js` | `buildCodeSuggestionSource(details)` |
| Filtrage des suggestions | `js/app.js` | `getCodeMatches(query)` |
| Affichage des suggestions | `js/app.js` | `renderCodeSuggestions(query)` |
| Application d'une suggestion | `js/app.js` | `applyCodeSuggestion(entry)` |
| Chargement des détails pour la source | `js/app.js` | `refreshCodeSuggestionSource()` |
| Accès à tous les détails | `js/storage.js` | `getAllDetails()` |
| Chargement Firestore | `js/storage.js` | `readPageItems('page3')`, `loadRemoteSnapshot()` |
| Création/modification/suppression de détails | `js/storage.js` | `createDetail()`, `updateDetail()`, `removeDetail()` |

## Fonction/composant qui charge les données

La fonction de page est `initItemDetailPage(permissions)` dans `js/app.js`. Elle initialise la page de détail, récupère les éléments `codeInput` et `codeSuggestions`, déclare `codeSuggestionSource`, puis appelle `refreshCodeSuggestionSource()` lors de l'initialisation de la page.

`refreshCodeSuggestionSource()` est la fonction directement responsable du chargement des suggestions côté UI :

```js
async function refreshCodeSuggestionSource() {
  const details = await StorageService.getAllDetails();
  codeSuggestionSource = buildCodeSuggestionSource(details);
  if (document.activeElement === codeInput && String(codeInput.value || '').trim()) {
    renderCodeSuggestions(codeInput.value);
  }
}
```

Elle ne charge pas un dictionnaire externe : elle lit tous les détails disponibles dans `StorageService`.

## Fonction qui construit la source

`buildCodeSuggestionSource(details)` construit la liste utilisable par le typeahead.

Fonctionnement exact :

1. Crée une `Map` nommée `suggestionsByCode`.
2. Pour chaque `detail` :
   - lit `detail.code`, le convertit en chaîne et applique `trim()` ;
   - ignore le détail si le code est vide ;
   - lit `detail.designation`, le convertit en chaîne et applique `trim()` ;
   - utilise `code.toLowerCase()` comme clé de déduplication ;
   - conserve la première occurrence d'un code ;
   - si une occurrence existante n'a pas de désignation et qu'une occurrence suivante en a une, complète la désignation.
3. Retourne les valeurs de la `Map`, triées par `code` avec `localeCompare(..., 'fr', { sensitivity: 'base' })`.

La structure produite est donc un tableau d'objets :

```js
[
  { code: '...', designation: '...' }
]
```

## Fonction qui effectue le filtrage

`getCodeMatches(query)` filtre `codeSuggestionSource`.

Règles exactes :

1. La saisie est normalisée avec `String(query || '').trim().toLowerCase()`.
2. Si la saisie normalisée est vide, la fonction renvoie `[]`.
3. Chaque entrée est comparée uniquement sur `entry.code.toLowerCase()`.
4. Une entrée est retenue si `codeLower.indexOf(normalizedQuery) !== -1`.
5. Le tri des résultats privilégie :
   - d'abord les codes qui commencent par la requête ;
   - ensuite l'index d'apparition de la requête dans le code ;
   - ensuite l'ordre alphabétique du code en français, insensible à la casse.
6. Le résultat est limité à 8 suggestions avec `.slice(0, 8)`.

Important : la désignation est affichée, mais elle ne sert pas au filtrage du typeahead du champ Code.

## Fonctionnement de l'autocomplétion

- Au focus sur `#codeInput`, si le champ contient déjà du texte, `renderCodeSuggestions(codeInput.value)` est appelé.
- À chaque événement `input`, le compteur de caractères est mis à jour, les erreurs du champ Code sont effacées et `renderCodeSuggestions(codeInput.value)` recalcule l'affichage.
- Au collage (`paste`), la longueur maximale est appliquée puis `renderCodeSuggestions(codeInput.value)` est appelé.
- `renderCodeSuggestions(query)` :
  - masque le menu si la requête est vide ;
  - appelle `getCodeMatches(query)` ;
  - masque le menu si aucun résultat n'existe ;
  - affiche le menu sinon ;
  - rend chaque suggestion sous forme de bouton `.typeahead__option` contenant le code et la désignation ;
  - met en évidence la partie correspondante avec `<mark>` via `buildHighlightedText(text, query)`.
- Navigation clavier :
  - `ArrowDown` et `ArrowUp` déplacent l'élément actif avec `setActiveSuggestion(index)` ;
  - `Enter` applique la suggestion active avec `applyCodeSuggestion(...)` ;
  - `Escape` masque les suggestions.
- Souris :
  - `mousedown` empêche la perte de focus avant le clic ;
  - `click` sur un bouton de suggestion applique l'entrée correspondante.
- À la perte de focus (`blur`), le menu est masqué après 140 ms.

Quand une suggestion est appliquée, `applyCodeSuggestion(entry)` :

1. renseigne `codeInput.value` avec `entry.code` ;
2. renseigne `designationInput.value` avec `entry.designation` ou une chaîne vide ;
3. met à jour les compteurs ;
4. recalcule l'unité automatique avec `getAutomaticUnit(designationInput.value)` ;
5. masque le menu.

## Structure des données

Les détails enregistrés dans la source persistante contiennent notamment les champs suivants lors d'une création par `createDetail()` :

| Champ | Description |
| --- | --- |
| `siteId` | Identifiant du site associé |
| `itemId` | Identifiant du N° OUT / item associé |
| `champ` | Rang numérique dans les détails de l'item |
| `code` | Code saisi dans le champ Code |
| `designation` | Désignation saisie ou remplie par suggestion |
| `qteSortie` | Quantité sortie |
| `unite` | Unité, calculée à partir de la désignation si nécessaire |
| `qteHorsBtrs` | Quantité hors BTRS |
| `qteRetour` | Quantité retour |
| `dateRetour` | Date de retour |
| `qtePosee` | Quantité posée |
| `qteRebus` | Quantité rebut |
| `observation` | Observation |
| `statut` | Statut du détail |
| `ownerId` | Utilisateur propriétaire |
| `createdBy` | Utilisateur créateur |
| `dateCreation` | Date de création |
| `dateModification` | Date de modification |

Le typeahead n'utilise que `code` et `designation` pour construire ses entrées `{ code, designation }`.

## Flux complet des données

1. Au démarrage, `StorageService.init()` initialise l'état applicatif.
2. Si le cache `localStorage` `suiviMateriel.offlineCache.v1` existe et est frais, `parseOfflineState()` puis `applySnapshot()` alimentent `state.detailsByItem` avec `pages.page3`.
3. Si le cache n'est pas frais, `loadRemoteSnapshot()` lit Firestore avec `readPageItems('page3')` dans la collection `pages/page3/items`, puis `applySnapshot()` alimente `state.detailsByItem`.
4. Sur la page `page3.html`, `initItemDetailPage()` initialise le formulaire **Ajouter une donnée**.
5. `refreshCodeSuggestionSource()` appelle `StorageService.getAllDetails()`.
6. `getAllDetails()` retourne tous les détails actuellement présents dans `state.detailsByItem`.
7. `buildCodeSuggestionSource(details)` transforme ces détails en liste dédupliquée et triée de `{ code, designation }`.
8. L'utilisateur tape dans `#codeInput`.
9. `renderCodeSuggestions(query)` appelle `getCodeMatches(query)`.
10. `getCodeMatches(query)` filtre uniquement les codes, trie les correspondances et limite la liste à 8 résultats.
11. `renderCodeSuggestions(query)` affiche les boutons dans `#codeSuggestions`.
12. L'utilisateur clique sur une suggestion ou la sélectionne au clavier.
13. `applyCodeSuggestion(entry)` remplit le champ Code, le champ Désignation et l'unité automatique.

## Exemple avec `010cbl`

Avec la requête `010cbl`, la normalisation utilisée par `getCodeMatches()` donne `010cbl`.

Les suggestions affichées sont exactement les entrées de `codeSuggestionSource` dont `entry.code.toLowerCase()` contient `010cbl`, dans cet ordre :

1. les codes qui commencent par `010cbl` ;
2. puis les codes où `010cbl` apparaît plus loin ;
3. puis, en cas d'égalité, l'ordre alphabétique français insensible à la casse ;
4. au maximum 8 suggestions.

Le repository ne contient pas de fichier statique où une ligne `010cbl` est définie. Les suggestions concrètes affichées pour `010cbl` dépendent donc des documents actuellement présents dans Firestore `pages/page3/items` ou dans le cache local `suiviMateriel.offlineCache.v1`. Si aucun détail enregistré n'a un `code` contenant `010cbl` après conversion en minuscules, aucune suggestion n'est affichée.

Pour une entrée source existante comme :

```js
{ code: '010cbl', designation: 'Exemple de désignation' }
```

la suggestion rendue affiche le code avec la partie saisie surlignée et la désignation à côté :

```text
010cbl — Exemple de désignation
```

## Comment ajouter, modifier ou supprimer un code dans la source

Comme la source du typeahead est constituée des détails enregistrés, il faut agir sur les détails de la page 3, pas sur un fichier de dictionnaire.

### Ajouter un code

1. Ouvrir la modale **Ajouter une donnée**.
2. Saisir le nouveau `code` et la `designation`.
3. Valider le formulaire.
4. `StorageService.createDetail()` écrit le détail dans Firestore `pages/page3/items`, l'ajoute à `state.detailsByItem`, persiste le cache local et déclenche `emitAll()`.
5. Au prochain rafraîchissement de source, ce code peut apparaître dans le typeahead.

### Modifier un code

1. Modifier le champ `code` d'une ligne de détail existante dans le tableau.
2. `StorageService.updateDetail()` écrit la modification dans Firestore `pages/page3/items`, met à jour l'objet en mémoire, persiste le cache local et déclenche `emitAll()`.
3. La valeur modifiée devient la source pour les suggestions futures.

### Supprimer un code

1. Supprimer la ligne de détail concernée.
2. `StorageService.removeDetail()` supprime le document Firestore `pages/page3/items/{detailId}`, retire l'entrée de `state.detailsByItem`, persiste le cache local et déclenche `emitAll()`.
3. Si plus aucun détail ne contient ce code, il disparaît de la source de suggestions.

### Cas des doublons

Si plusieurs détails ont le même code avec une casse différente, `buildCodeSuggestionSource(details)` ne garde qu'une seule suggestion, car la clé de déduplication est `code.toLowerCase()`. La première occurrence est conservée ; sa désignation est complétée par une occurrence suivante seulement si la première désignation est vide.
