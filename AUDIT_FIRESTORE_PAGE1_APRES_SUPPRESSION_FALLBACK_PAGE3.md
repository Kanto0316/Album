# Audit Firestore Page 1 après suppression du fallback Page 3

Date de l'audit : 2026-08-25.

## 1. Résumé de la modification

Le bootstrap global `StorageService.init()` appelait `loadRemoteSnapshot()`. Avant modification, `loadRemoteSnapshot()` lisait en parallèle `pages/page1/items` et `materialCodes`, puis appelait `bootstrapMaterialCodesFromDetails()` lorsque `materialCodes` était vide. Ce fallback exécutait une lecture complète de `pages/page3/items` via `readPageItems('page3')`.

Après modification, `loadRemoteSnapshot()` ne charge plus que `pages/page1/items` et retourne un snapshot minimal `{ page1, page3: [] }`. La lecture Firestore supprimée du bootstrap est donc le chemin indirect :

`StorageService.init()` → `loadRemoteSnapshot()` → `readMaterialCodes()` → `bootstrapMaterialCodesFromDetails()` → `readPageItems('page3')` → `getDocs(collection(firebaseDb, 'pages', 'page3', 'items'))`.

Pages concernées :

- Page 1 (`index.html`) : suppression de la dépendance de bootstrap vers Page 3.
- Page 3 (`page3.html`) : les suggestions de codes restent chargées à la demande par `getMaterialCodes()` dans l'initialisation Page 3.
- Page 2, `materiels.html` et autres pages : pas de modification fonctionnelle volontaire.

## 2. Vérification Page 1

Lectures Firestore pouvant être exécutées au chargement de Page 1 après modification :

| Lecture | Fichier | Fonction appelante | Fonction Firestore | Collection/document | Query | Filtre | Déclencheur | Moment d'exécution | Utilité Page 1 | Nécessaire | Différable | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Profil utilisateur courant | `js/storage.js` | `StorageService.getCurrentUserProfile()` via `bootstrap()` | `getDoc` | `users/{uid}` | Aucune | UID utilisateur courant | Bootstrap commun | Après auth, avant init page | Permissions, rôle, accès maintenance | Oui | Non | Nécessaire |
| Création/normalisation utilisateur | `js/storage.js` | `StorageService.ensureCurrentUser()` via `bootstrap()` si connecté | `getDoc` puis éventuellement `setDoc`/`updateDoc` | `users/{uid}` | Aucune | UID utilisateur courant | Bootstrap commun utilisateur connecté | Avant rendu page | Profil et droits cohérents | Oui | Partiellement, mais métier existant | Conservé |
| Snapshot initial Page 1 | `js/storage.js` | `StorageService.init()` → `loadRemoteSnapshot()` | `getDocs` | `pages/page1/items` | Aucune | Aucun | Cache absent ou expiré | Initialisation globale | Liste des sites Page 1 | Oui | Non, nécessaire au rendu initial | Nécessaire |
| Abonnement sites en mémoire | `js/app.js` | `initHomePage()` → `StorageService.subscribeSites()` | Aucune lecture Firestore directe | État local `state.sites` alimenté par `pages/page1/items` | Aucune | Visibilité utilisateur en mémoire | Initialisation Page 1 | Rendu des cartes | Afficher les sites | Oui | Non | Nécessaire |
| Compteurs OUT | `js/app.js` | `initHomePage()` → `StorageService.subscribeItemCounts()` | Aucune lecture Firestore directe | État local `state.sites[*].outCount` | Aucune | Aucun | Initialisation Page 1 | Rendu compteurs | Afficher compteur par site | Oui | Non | Nécessaire |
| Maintenance globale | `js/app.js` / `js/maintenance-banner.js` | `initMaintenanceGate()` et bannière maintenance | `onSnapshot` | `appSettings/maintenance` | Aucune | Document unique | Bootstrap commun / script maintenance | Au chargement | Bloquer/afficher maintenance | Oui | Non | Nécessaire |
| Messages admin récents | `js/maintenance-banner.js` | Bannière/messages globaux | `onSnapshot` | `adminMessages` | `orderBy('createdAt','desc')`, `limit(20)` | Filtrage destinataire côté client selon utilisateur | Script commun | Au chargement | Notifications utilisateur/admin | Oui pour fonctionnalité globale | Potentiellement différable, mais hors périmètre | Conservé |

Lecture explicitement supprimée du chargement Page 1 :

| Lecture supprimée | Ancien fichier | Ancienne fonction appelante | Fonction Firestore | Collection/document | Déclencheur avant | Utilité Page 1 | Verdict après modification |
|---|---|---|---|---|---|---|---|
| Fallback catalogue codes depuis détails | `js/storage.js` | `loadRemoteSnapshot()` → `bootstrapMaterialCodesFromDetails()` | `getDocs` | `pages/page3/items` | `materialCodes` vide pendant `StorageService.init()` | Aucune utilisation directe sur Page 1 | Supprimée du bootstrap Page 1 |

## 3. Vérification spécifique Page 3

Recherche effectuée dans le code après modification sur : `pages/page3/items`, `getDocs`, `getDoc`, `onSnapshot`, `query`, `collection`, `bootstrapMaterialCodesFromDetails`, `readMaterialCodes`, `loadRemoteSnapshot`, `StorageService.init`.

Résultat :

- `pages/page3/items` est encore utilisé par les fonctions métier Page 3/détails : lecture filtrée par site ou couple site+OUT, mises à jour, suppressions, et audit `materiels.html`.
- `bootstrapMaterialCodesFromDetails()` existe encore pour préserver la génération du catalogue de suggestions lorsque `getMaterialCodes()` est appelé par Page 3 et que `materialCodes` est vide.
- `loadRemoteSnapshot()` n'appelle plus `readMaterialCodes()` et n'appelle plus `bootstrapMaterialCodesFromDetails()`.
- `StorageService.init()` appelle toujours `loadRemoteSnapshot()`, mais ce snapshot ne contient plus de lecture `materialCodes` ni de fallback Page 3.
- `initHomePage()` n'appelle pas `getMaterialCodes()`.

Détermination :

**Page 1 → pages/page3/items : ❌ NON**

Page 1 ne peut plus provoquer `pages/page3/items` via le fallback `materialCodes` au bootstrap. Les lectures Page 3 restantes sont déclenchées par Page 2/Page 3 ou `materiels.html`, pas par `initHomePage()`.

## 4. Vérification des dépendances croisées

| Page | pages/page1/items | pages/page2/items | pages/page3/items | materialCodes |
|------|-------------------|-------------------|-------------------|---------------|
| Page 1 (`index.html`) | Nécessaire : liste des sites | Inutile au chargement Page 1 | Inutile et supprimé du bootstrap | Inutile au chargement Page 1 |
| Page 2 (`page2.html`) | Nécessaire indirectement pour titre/site courant | Nécessaire : OUT du site, filtrés par `siteId` | Nécessaire/croisée : compteurs, désignations et filtres d'articles du site | Inutile |
| Page 3 (`page3.html`) | Nécessaire indirectement pour titre/site courant | Nécessaire : OUT courant du site | Nécessaire : lignes de détail du couple site/OUT | Nécessaire pour suggestions, différable jusqu'à Page 3 |
| `materiels.html` | Inutile | Inutile | Nécessaire : inventaire global des matériels | Inutile |

## 5. Vérification des régressions Page 1

- Page 1 affiche toujours ses sites : oui, `loadRemoteSnapshot()` lit toujours `pages/page1/items`, puis `subscribeSites()` expose `state.sites` à `initHomePage()`.
- Cartes Page 1 : oui, elles dépendent de `currentSites`, des permissions et de l'état local, inchangés.
- Compteurs : oui, `subscribeItemCounts()` lit les `outCount` déjà stockés sur les sites et ne dépend pas de `materialCodes`.
- Filtres/recherche : oui, ils s'appliquent aux sites déjà chargés en mémoire.
- Navigation : oui, les liens Page 1 vers Page 2 ne sont pas modifiés.
- Authentification : oui, le flux `waitForAuthState()`, `getCurrentUserProfile()` et `ensureCurrentUser()` n'est pas modifié.
- Maintenance : oui, `initMaintenanceGate()` et `js/maintenance-banner.js` ne sont pas modifiés.
- Messages admin : oui, `js/maintenance-banner.js` n'est pas modifié.
- Firestore Page 1 : aucune fonctionnalité Page 1 n'utilisait directement `materialCodes`; le fallback supprimé était donc inutile pour l'interface Page 1.

## 6. Vérification des autres pages

- `page2.html` : pas de changement direct. Les lectures `pages/page2/items` et `pages/page3/items` filtrées pour compteurs/détails restent présentes.
- `page3.html` : pas de changement direct. `refreshCodeSuggestionSource()` appelle encore `StorageService.getMaterialCodes()`, qui lit `materialCodes` puis peut amorcer depuis Page 3 si le catalogue est vide.
- `materiels.html` : pas de changement direct. Sa lecture globale `pages/page3/items` reste propre à la page matériels.
- `historiques.html` : pas de changement direct. Les lectures historiques restent inchangées.
- `parametres.html` : pas de changement direct.
- `corbeille.html` : pas de changement direct. Les abonnements corbeille restent inchangés.
- `users.html` : pas de changement direct. La gestion utilisateurs/maintenance/messages admin reste inchangée.

## 7. Comparaison AVANT / APRÈS

| Élément | Avant | Après |
|---------|-------|-------|
| Page 1 → page1/items | Oui, lecture nécessaire par `loadRemoteSnapshot()` | Oui, inchangé et nécessaire |
| Page 1 → materialCodes | Oui, lecture globale au bootstrap | Non via `loadRemoteSnapshot()` |
| Page 1 → page3/items | Oui si `materialCodes` vide, via fallback | Non via bootstrap Page 1 |
| Fallback Page 3 | Déclenché pendant `StorageService.init()` si `materialCodes` vide | Déclenchable seulement à la demande par `getMaterialCodes()` |
| Dépendance Page 1 → Page 3 | Présente, indirecte et inutile | Supprimée pour le bootstrap Page 1 |

## 8. Pourcentage d'indépendance après modification

Méthode : pourcentage estimé à partir des chemins de lecture au chargement et des dépendances métier restantes après modification. Une page est considérée plus indépendante lorsqu'elle ne charge pas de collections d'autres pages au bootstrap, ou seulement des lectures croisées nécessaires et filtrées.

- Page 1 : **100 % indépendante de Page 3 au bootstrap**. Elle lit `pages/page1/items` et ne déclenche plus `materialCodes`/`pages/page3/items` via `loadRemoteSnapshot()`.
- Page 2 : **70 % indépendante**. Elle dépend de `pages/page2/items`, mais lit aussi `pages/page3/items` filtré par `siteId` pour des compteurs/filtres d'articles métier.
- Page 3 : **75 % indépendante**. Elle dépend naturellement de `pages/page3/items`, mais doit aussi lire Page 1/Page 2 en mémoire pour contexte site/OUT et peut lire `materialCodes` pour suggestions.
- `materiels.html` : **85 % indépendante**. Elle assume une lecture globale `pages/page3/items` correspondant à son objectif d'inventaire global, sans dépendre du bootstrap Page 1.

## 9. Conclusion

- La Page 1 est maintenant indépendante de Page 3 au niveau du bootstrap : **oui**.
- Page 1 peut-elle encore déclencher une lecture `pages/page3/items` à cause du fallback `materialCodes` : **non**.
- Y a-t-il encore des lectures inutiles au chargement de Page 1 : **aucune lecture Page 3 identifiée**. Les lectures globales restantes concernent l'authentification, les permissions, la maintenance et les messages admin, qui sont des fonctionnalités transverses existantes.
- Autres optimisations prioritaires : Page 2 lit encore `pages/page3/items` filtré par site pour ses compteurs/filtres d'articles. Une optimisation future pourrait maintenir des compteurs et agrégats sur Page 2 pour éviter certaines lectures Page 3, mais ce point est hors périmètre de cette tâche.

## 10. Fichiers modifiés

### Fichiers modifiés
- `js/storage.js`

### Fichiers ajoutés
- `AUDIT_FIRESTORE_PAGE1_APRES_SUPPRESSION_FALLBACK_PAGE3.md`
