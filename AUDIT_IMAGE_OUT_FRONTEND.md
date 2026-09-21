# Audit — image associée à un OUT

## Périmètre analysé

- **Page 2** : `page2.html` porte la modale « Nouveau numéro OUT ». Son comportement est centralisé dans `initSiteDetailPage` dans `js/app.js`.
- **Page 3** : `page3.html` porte le détail d’un OUT. Son comportement est centralisé dans `initItemDetailPage` dans `js/app.js`.
- **Rôles** : le profil courant provient de `users/{uid}` via `StorageService.getCurrentUserProfile()`. `buildPermissions` transforme ce profil en permissions UI. Historiquement, `isAdmin` inclut également les rôles standard/adjoint ; la fonctionnalité image emploie donc une permission séparée, `isOutImageAdmin`, limitée au rôle `admin` (et au compte administrateur historique).
- **OUT Firestore** : les OUT sont stockés dans `pages/page2/items/{outId}` par `StorageService.createItem`. Les lignes d’article de page 3 sont séparées dans `pages/page3/items` et référencent `siteId` et `itemId`.
- **Images existantes** : les achats matériels utilisent déjà Cloudinary (cloud `dskw13nem`, preset `Suivi_matériel`) et un endpoint serveur pour la suppression.

## Risques constatés avant modification

1. Aucun champ image n’était enregistré sur le document OUT.
2. Aucun contrôle de type/taille ni prévisualisation n’existait dans le formulaire OUT.
3. La notion générale `permissions.isAdmin` est volontairement plus large que le rôle ADMIN strict ; elle ne convient pas à cette fonctionnalité.
4. Un simple masquage DOM serait insuffisant : un utilisateur pourrait tenter de déclencher l’action depuis la console.
5. Une URL Cloudinary brute ne garantit pas une livraison optimisée.

## Solution appliquée

- Sélecteur et prévisualisation réservés à `isOutImageAdmin`, avec liste MIME JPG/PNG/WEBP et limite de 5 Mo.
- Nouvelle vérification du document `users/{uid}` directement depuis le serveur Firestore avant chaque upload et chaque suppression. En cas d’échec de lecture ou de rôle révoqué, l’action est refusée (fail closed).
- Enregistrement atomique des métadonnées avec la création du document OUT : `imageUrl`, `imagePublicId`, `imageCreatedBy`, `imageCreatedAt`.
- Affichage page 3 seulement après vérification ADMIN et seulement si une image existe. L’URL Cloudinary reçoit les transformations `f_auto,q_auto,w_1600,c_limit`.
- Suppression ADMIN avec suppression Cloudinary préalable, puis nettoyage des quatre champs Firestore.

## Limite de sécurité / déploiement

Le frontend vérifie le rôle avant les actions, mais **les règles Firestore et l’endpoint Cloudinary restent l’autorité de sécurité**. Les règles déployées doivent interdire à tout non-ADMIN l’écriture des champs `image*` de `pages/page2/items`, et l’endpoint de suppression doit valider un jeton Firebase puis le rôle ADMIN côté serveur. Un preset Cloudinary non signé ne constitue pas, à lui seul, une frontière de sécurité.
