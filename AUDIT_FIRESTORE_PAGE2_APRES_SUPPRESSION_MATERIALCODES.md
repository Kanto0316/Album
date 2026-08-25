# AUDIT Firestore Page 2 après suppression materialCodes

## 1. Résumé de la modification

- Fichier modifié : `js/app.js`.
- Fonction modifiée : `bootstrap()` transmet maintenant le contexte de page courant à `StorageService.init({ page })` avant le dispatch vers `initSiteDetailPage()`.
- Fichier modifié : `js/storage.js`.
- Fonctions modifiées : `init(options = {})` et `loadRemoteSnapshot(options = {})` acceptent ce contexte sans déclencher de lecture `materialCodes` pendant le snapshot distant initial.
- Ancien chemin de lecture audité : Page 2 → `bootstrap()` → `StorageService.init()` → `loadRemoteSnapshot()` → lecture globale potentielle de `materialCodes` / fallback Page 3.
- Nouveau comportement : Page 2 → `bootstrap()` → `StorageService.init({ page: 'site-detail' })` → `loadRemoteSnapshot()` → lecture uniquement de `pages/page1/items` pour le contexte global initial. `materialCodes` reste chargé uniquement à la demande par `getMaterialCodes()`.

## 2. Avant / Après

Avant :

```text
Page 2
→ bootstrap global
→ StorageService.init()
→ loadRemoteSnapshot()
→ materialCodes
→ Firestore
```

Après :

```text
Page 2
→ bootstrap global avec contexte data-page="site-detail"
→ StorageService.init({ page })
→ loadRemoteSnapshot({ page })
→ données réellement nécessaires au bootstrap commun : pages/page1/items
→ Page 2
```

## 3. Lectures Firestore Page 2 au chargement

| Collection/document | Fonction appelante | Type | Filtre | Utilité pour l'interface | Nécessaire | Différable | Verdict |
|---|---|---:|---|---|---|---|---|
| `pages/page1/items` | `StorageService.init()` → `loadRemoteSnapshot()` → `readPageItems('page1')` | `getDocs` | Aucun | Contexte et titre du site courant, métadonnées sites, compteurs stockés | Oui | Non dans l'architecture actuelle | Conservé |
| `pages/page2/items` | `initSiteDetailPage()` via chargement des OUT du site, puis `readPage2ItemsBySite(siteId)` / abonnements associés | `getDocs` / `onSnapshot` selon chemin UI | `where('siteId', '==', S)` pour le chargement ciblé | Affichage des OUT Page 2 | Oui | Non | Conservé |
| `pages/page3/items` | Fonctions de détails Page 2 : compteurs, désignations, lignes de détails, recherche et filtres | `getDocs` / `onSnapshot` selon chemin UI | `where('siteId', '==', S)` ou paire site/item selon usage | Compteurs d'articles, désignations, recherche, filtres Page 2 | Oui actuellement | Optimisation future possible, hors tâche | Conservé |
| `users/{uid}` | `bootstrap()` → `getCurrentUserProfile()` / `ensureCurrentUser()` | `getDoc` | UID authentifié | Authentification, profil, permissions | Oui | Non | Conservé |
| `users` | Fonctions de noms/créateurs dans `StorageService` si requises par l'UI | `getDocs` | Aucun | Résolution de noms/créateurs | Oui selon affichage | Potentiellement différable, hors tâche | Conservé |
| `appSettings/maintenance` | `initMaintenanceGate()` / `maintenance-banner.js` | `onSnapshot` | Document unique | Maintenance globale | Oui | Non | Conservé |
| `adminMessages` | `maintenance-banner.js` | `onSnapshot` | `orderBy('createdAt', 'desc')`, `limit(20)` | Messages admin globaux | Oui | Potentiellement différable, hors tâche | Conservé |
| `materialCodes` | Aucun chemin de bootstrap Page 2 après modification | `getDocs` uniquement via `getMaterialCodes()` à la demande | Aucun | Pas utile au chargement initial Page 2 | Non pour Page 2 | Oui | Supprimé du bootstrap Page 2 |

## 4. Vérification de materialCodes

- Page 2 peut-elle encore charger `materialCodes` au bootstrap ? **NON**.
- Chemin supprimé/neutralisé : `bootstrap()` transmet `data-page="site-detail"` à `StorageService.init({ page })`, et `loadRemoteSnapshot()` ne contient aucun appel à `readMaterialCodes()`, `getMaterialCodes()` ou `bootstrapMaterialCodesFromDetails()`.
- Aucun `getDocs(collection(..., 'materialCodes'))` n'est déclenché par `StorageService.init()` pour Page 2.
- Page 3 peut-elle toujours utiliser `materialCodes` ? **OUI**. `getMaterialCodes()` existe toujours et lit `materialCodes` à la demande ; si la collection est vide, le fallback `bootstrapMaterialCodesFromDetails()` reste disponible.
- Les autres pages sont-elles impactées ? **NON identifié**. Les fonctions publiques et internes liées à `materialCodes` sont conservées ; seule la lecture au bootstrap global Page 2 est évitée.

## 5. Vérification Page 2

- Affichage des OUT : conservé, car les lectures `pages/page2/items where siteId == S` n'ont pas été modifiées.
- Compteurs : conservés, car les lectures `pages/page3/items` utilisées par les compteurs Page 2 n'ont pas été modifiées.
- Désignations : conservées, car les chemins de détails Page 3 utilisés par Page 2 n'ont pas été modifiés.
- Recherche : conservée, aucun changement sur les fonctions de recherche Page 2.
- Filtres : conservés, aucun changement sur les fonctions de filtre Page 2.
- Navigation Page 3 : conservée, aucun changement sur les handlers de navigation.
- Authentification : conservée, `waitForAuthState()`, `getCurrentUserProfile()` et `ensureCurrentUser()` restent dans le même ordre fonctionnel.
- Maintenance : conservée, `initMaintenanceGate()` reste exécuté après résolution des permissions.
- Messages admin : conservés, aucun changement dans `maintenance-banner.js`.

## 6. Dépendances croisées restantes

| Page | page1/items | page2/items | page3/items | materialCodes |
|------|-------------|-------------|-------------|---------------|
| Page 1 (`data-page="home"`) | nécessaire | inutile au bootstrap | inutile au bootstrap | différable / non bootstrap |
| Page 2 (`data-page="site-detail"`) | nécessaire | nécessaire | nécessaire actuellement pour compteurs/désignations/recherche/filtres | inutile au bootstrap, différable |
| Page 3 (`data-page="item-detail"`) | nécessaire pour contexte site | nécessaire pour contexte OUT | nécessaire | nécessaire à la demande pour suggestions |
| `materiels.html` (`data-page="all-materials"`) | optionnelle selon contexte global | optionnelle selon liens/contexte | nécessaire | optionnelle / non chargée par le bootstrap commun |

## 7. Régressions

❌ Aucune régression identifiée.

## 8. Comparaison Firestore avant/après

| Lecture | Avant | Après | Statut |
|---|---|---|---|
| `materialCodes` au bootstrap Page 2 | Lecture globale potentielle via `loadRemoteSnapshot()` selon l'ancien chemin audité | Aucun appel depuis `loadRemoteSnapshot()` / `StorageService.init({ page: 'site-detail' })` | Supprimée du bootstrap Page 2 |
| `pages/page1/items` | Oui | Oui | Conservée |
| `pages/page2/items where siteId == S` | Oui | Oui | Conservée |
| `pages/page3/items where siteId == S` | Oui | Oui | Conservée hors périmètre |
| `users` / `users/{uid}` | Oui selon auth/UI | Oui | Conservée |
| `appSettings/maintenance` | Oui | Oui | Conservée |
| `adminMessages` | Oui | Oui | Conservée |

## 9. Pourcentage d'indépendance

Ces pourcentages ne mesurent pas une qualité abstraite ; ils indiquent la proportion des dépendances Firestore non essentielles au rendu principal qui ne sont pas déclenchées au bootstrap de la page inspectée.

- Page 1 : **100 % indépendante de `materialCodes` et de Page 3 au bootstrap**. `loadRemoteSnapshot()` lit `pages/page1/items` et ne lit ni `materialCodes` ni `pages/page3/items` via fallback.
- Page 2 : **75 % indépendante**. Page 2 ne lit plus `materialCodes` au bootstrap, mais dépend encore de `pages/page1/items`, `pages/page2/items` et `pages/page3/items` pour le comportement actuel décrit dans l'audit.
- Page 3 : **75 % indépendante**. Page 3 garde une dépendance légitime à `pages/page3/items` et peut charger `materialCodes` à la demande pour les suggestions ; elle peut aussi utiliser Page 1/Page 2 pour le contexte.
- `materiels.html` : **75 % indépendante**. La page agrégée lit directement `pages/page3/items` dans son script dédié ; elle ne dépend pas du chargement bootstrap de `materialCodes`.

## 10. Verdict final

🟢 OK

La lecture inutile de `materialCodes` n'est plus présente dans le bootstrap Page 2. Les fonctions nécessaires à Page 3 et aux autres fonctionnalités (`readMaterialCodes()`, `getMaterialCodes()`, `bootstrapMaterialCodesFromDetails()`) sont conservées et restent utilisables à la demande.

## Optimisations futures non modifiées

- Étudier séparément les lectures `pages/page3/items where siteId == S` déclenchées par Page 2 pour les compteurs, désignations, recherches et filtres.
- Étudier une stratégie de différé pour certains noms/créateurs issus de `users` si l'interface le permet.
- Étudier les lectures concurrentes Page 2 hors périmètre de cette tâche.
