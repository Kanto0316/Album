# Audit — Phase 1 OCR (test administrateur)

## Périmètre et fichiers modifiés

- `index.html` : bouton temporaire **📷 Tester OCR**, dialogue de résultat et chargement de Tesseract.js.
- `css/style.css` : styles isolés du bouton et du dialogue OCR.
- `js/app.js` : branchement du prototype sur la page d’accueil et contrôle d’accès.
- `js/image-import.service.js` : sélection, validation et préparation locale de l’image.
- `js/ocr.service.js` : appel du moteur OCR et normalisation du texte, de la confiance et de la durée.
- `tests/ocr-prototype.test.mjs` : tests unitaires de validation et du traitement OCR.

Aucun appel à `StorageService.createDetail()`, aucune écriture Firestore et aucune modification de `StorageService`, `OfflineSync`, `articleCount` ou du formulaire d’ajout n’ont été ajoutés.

## Contrôle d’accès utilisé

Le prototype réutilise `permissions.isAdmin`, produit par le mécanisme existant `buildPermissions()`. Le bouton est caché par défaut dans le HTML, puis affiché uniquement lorsque l’utilisateur est authentifié **et** que `currentPermissions.isAdmin` vaut `true`. La même condition est revérifiée à l’ouverture, avant l’analyse et après la sélection du fichier. Une déconnexion masque le bouton et ferme le dialogue éventuellement ouvert.

Cette phase ne crée donc aucun rôle, aucune permission et aucun système d’autorisation parallèle.

## Bibliothèque OCR

Le prototype utilise **Tesseract.js 5.1.1**, chargé depuis jsDelivr, avec les langues `fra+eng`. Le traitement est réalisé dans le navigateur ; seul le résultat brut est présenté. La confiance globale est affichée lorsqu’elle est fournie par le moteur.

## Résultat des tests

- Administrateur connecté : condition `isAuthenticated && permissions.isAdmin`, bouton visible.
- Utilisateur non administrateur : bouton conservé avec l’attribut `hidden`.
- Déconnexion : rappel de la mise à jour d’accès, bouton masqué et dialogue fermé.
- Image JPG, PNG ou WebP valide (10 Mo maximum) : préparation puis appel du moteur OCR.
- Type non autorisé, fichier vide ou trop volumineux : erreur explicite affichée dans le dialogue.
- Moteur indisponible ou en erreur : message OCR explicite, sans mutation des données métier.

Les tests automatisés couvrent une image valide, un format invalide, la préparation de l’aperçu, un résultat OCR et une erreur moteur. Le contrôle DOM d’accès est également vérifiable par inspection statique et doit être validé avec des comptes Firebase réels lors de la recette intégrée.

## Limites connues

- La précision dépend de la netteté, de l’orientation, du contraste et de la langue de l’image.
- Le premier traitement peut être plus long, car le navigateur télécharge le moteur et les données linguistiques.
- Une connexion réseau est nécessaire au premier chargement des ressources Tesseract.js ; aucune mise en cache applicative dédiée n’est ajoutée dans cette phase.
- La confiance est globale et peut ne pas être disponible selon la réponse du moteur.
- Le prototype n’effectue volontairement ni structuration en articles, ni correction, ni sauvegarde, ni synchronisation.
