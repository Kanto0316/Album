# Audit — Phase 2 OCR : extraction des articles

## Fonctionnement

La fonctionnalité reste affichée uniquement aux administrateurs authentifiés sur la page de détail OUT. Après sélection d'une image JPG, PNG ou WEBP, Tesseract réalise l'OCR dans le navigateur. Le service OCR analyse ensuite chaque ligne, recherche une référence alphanumérique contenant au moins une lettre et un chiffre, puis lui associe la désignation située sur la même ligne ou sur la ligne utile suivante.

Les titres, entêtes et informations usuelles de document (société, chauffeur, client, adresse, date et page) sont écartés. Le texte brut n'est plus présenté comme résultat principal. Une table **Code / Désignation** est affichée; le bouton **Corriger** rend ses champs modifiables.

Aucune écriture n'est déclenchée par la sélection, l'OCR ou la correction. Les créations commencent exclusivement après le clic sur **Ajouter les articles**. **Annuler** ferme l'aperçu sans enregistrer.

## Fichiers modifiés

- `js/ocr.service.js` : extraction pure et contrat documentant les futurs champs.
- `js/app.js` : orchestration admin, aperçu, correction et validation explicite.
- `page3.html` : table structurée et boutons de validation.
- `css/style.css` : présentation responsive de l'aperçu.
- `tests/ocr-prototype.test.mjs` : tests du parseur et de l'interface attendue.

## Limites OCR

- La qualité dépend de la netteté, du cadrage, du contraste et de l'orientation de l'image.
- Une confusion de caractères (`0/O`, `1/I`, ponctuation) peut nécessiter une correction manuelle.
- Une référence doit contenir lettres et chiffres et compter au moins six caractères; les formats métier très différents peuvent ne pas être détectés.
- Les tableaux complexes, désignations sur plusieurs lignes et colonnes fortement désalignées peuvent produire des associations incomplètes.
- Quantité, unité et statut sont réservés dans le contrat d'extraction pour une phase future, mais ne sont pas extraits maintenant.

## Firestore et architecture existante

`StorageService.createDetail()` n'a pas été modifié. Les mécanismes `articleCount`, `OfflineSync` et la synchronisation Firestore restent inchangés. Après validation explicite, l'interface appelle la méthode existante pour chaque article; le service OCR demeure une couche d'analyse pure et n'accède pas à Firestore.
