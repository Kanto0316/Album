# Audit — statistiques globales de Gestion Admin

## Périmètre et conclusion exécutive

Cet audit porte sur l'ajout futur de deux indicateurs dans **Gestion Admin** : le nombre total d'OUT et le nombre total d'articles. Aucun code, aucune interface, aucune donnée Firestore et aucune règle de sécurité ne sont modifiés par ce document.

### Recommandation

La meilleure intégration, avec l'architecture actuelle, consiste à faire remonter les deux valeurs par `StorageService` à partir de l'abonnement global à `pages/page2/items` qui existe déjà pour calculer les points de création des utilisateurs :

- **total OUT** : `snapshot.size` de `pages/page2/items`, qui compte les documents OUT réels ;
- **total articles** : somme des champs dénormalisés `articleCount` des mêmes documents OUT ;
- **sans nouvel abonnement Firestore** : enrichir/consolider le flux actuellement utilisé par `subscribeOutCreationPoints()` plutôt que créer une quatrième lecture parallèle de la même collection.

Cette option est la plus rapide et la moins coûteuse dans **cette page précise**, car Gestion Admin lit déjà toute la collection Page 2 pour les points. Elle évite de charger `pages/page3/items` et évite aussi une seconde source globale fondée sur la somme des `outCount` des sites. Elle suppose toutefois que la migration et la réconciliation de `articleCount` ont été menées sur tout le parc ; un compteur absent doit être signalé comme donnée incomplète et ne doit pas être silencieusement assimilé à zéro.

---

## 1. Analyse de la page Gestion Admin

### 1.1 Fichiers responsables

| Fichier | Responsabilité actuelle |
| --- | --- |
| `users.html` | Structure de la page, carte maintenance, tableau, recherche, modale de message, scripts chargés et un important module JavaScript inline. |
| `js/app.js` | Bootstrap commun, construction des permissions et contrôleur principal `initUsersPage(permissions)`. |
| `js/storage.js` | Accès aux utilisateurs, points, maintenance et données Page 1/2/3. Expose l'API globale `window.StorageService`. |
| `css/style.css` | Styles partagés et règles spécifiques à `body[data-page="users-management"]`. |
| `js/ui.js` | Navigation, toasts et utilitaires d'interface employés par la page. |
| `js/firebase-core.js` | Initialisation et export de `firebaseAuth` et `firebaseDb`. |
| `js/maintenance-banner.js` | Bannière/écoute de l'état global de maintenance, chargée sur la page. |
| `js/message-variables.js` | Variables et substitution pour les messages administrateur. |

La page est sélectionnée par `<body data-page="users-management">`. Le bootstrap commun de `js/app.js` détecte cette valeur, attend Firebase Auth, initialise `StorageService`, construit les permissions, initialise la barrière de maintenance, puis appelle `initUsersPage()`.

### 1.2 Structure HTML, JavaScript et CSS

La structure visible de `users.html` est la suivante :

1. en-tête avec bouton retour et titre **Gestion Admin** ;
2. carte `surface-card details-card` contenant le commutateur de maintenance ;
3. bouton flottant et modale d'envoi de message aux utilisateurs ;
4. carte `surface-card table-card` contenant :
   - les compteurs « En ligne » et « Tous les utilisateurs » ;
   - le champ de recherche ;
   - un tableau à huit colonnes (`Point`, `Photo`, `Nom`, `Dernière activité`, `Email`, `Rôle`, accès maintenance, actions) ;
5. zone de toast.

Le CSS est principalement centralisé dans `css/style.css`. Les règles propres à la page commencent avec le sélecteur `body[data-page="users-management"]` et organisent le contenu en grille à deux lignes : maintenance puis tableau. `users.html` contient en plus une petite règle inline qui réserve de l'espace sous le tableau.

Le JavaScript est actuellement réparti entre :

- le contrôleur commun `initUsersPage()` dans `js/app.js` ;
- un second module inline dans `users.html`, qui réimplémente une partie de la gestion des utilisateurs et gère surtout la modale de message.

Ce chevauchement est un point d'architecture important : les utilisateurs et les OUT sont chacun abonnés une fois par `StorageService` dans `js/app.js`, puis une nouvelle fois directement avec `onSnapshot()` dans `users.html`. Ajouter naïvement un troisième mécanisme de statistiques accentuerait la duplication.

### 1.3 Composants existants

- **Carte maintenance** avec `maintenanceToggle` et `maintenanceStatusText`.
- **Carte utilisateurs** avec `usersCardHeader`, recherche et tableau.
- **Compteurs utilisateurs** total/en ligne dans le titre de la carte.
- **Sélecteur de rôle** pour chaque utilisateur non principal.
- **Case d'autorisation pendant la maintenance**.
- **Suppression utilisateur** avec confirmation.
- **Points** correspondant au nombre d'OUT créés par utilisateur.
- **Avatar ou initiales**, nom, email et dernière activité.
- **Message administrateur** avec destinataires, modèles de variables et écriture dans `adminMessages`.
- **Toasts**, navigation retour et bannière de maintenance partagés.

### 1.4 Chargement et affichage des utilisateurs

Dans `js/app.js`, le chargement initial lance en parallèle :

- `StorageService.listUsers()` ;
- `StorageService.listOutCreationPoints()`.

Puis deux abonnements temps réel sont ouverts :

- `StorageService.subscribeUsers()` sur la collection `users` ;
- `StorageService.subscribeOutCreationPoints()` sur `pages/page2/items`.

Le module inline de `users.html` ouvre également ses propres `onSnapshot()` directs sur ces deux collections. Il appelle `syncDefaults()` pour compléter certains documents utilisateur anciens et alimente aussi les destinataires de messages.

Les utilisateurs sont triés par nombre de points décroissant, puis par nom. Une recherche locale filtre nom, prénom, nom affiché et email. Chaque ligne est construite par chaîne HTML, avec avatar, informations de présence, rôle éditable, autorisation maintenance et suppression.

### 1.5 Calcul du nombre d'utilisateurs

`currentUsers` contient la liste complète reçue de Firestore. `updateUsersCardHeader(currentUsers)` calcule :

- le total avec `users.length` ;
- les utilisateurs en ligne avec `users.filter(isUserOnline).length`.

Le statut « en ligne » est vrai si un drapeau `online`, `presence` ou `status` l'indique, ou si `lastSeen`/`lastActivity` date de moins de cinq minutes. Le rendu est rafraîchi toutes les 60 secondes pour faire évoluer l'affichage temporel même sans nouveau snapshot.

Le filtre de recherche ne change pas le total du titre : `updateUsersCardHeader()` reçoit `currentUsers` avant que `renderUsers()` reçoive la liste filtrée.

### 1.6 Gestion de la maintenance

L'état global est stocké dans le document `appSettings/maintenance`, champ booléen `enabled`. `StorageService.subscribeMaintenanceState()` utilise `onSnapshot()` ; le commutateur est donc synchronisé en temps réel. Une modification appelle `StorageService.setMaintenanceState(enabled)`, qui fait un `setDoc(..., { merge: true })` avec `updatedAt` et `updatedBy`, puis enregistre l'activité de l'opérateur. En cas d'échec, l'interface remet le commutateur à son état précédent.

L'autorisation individuelle utilise les champs compatibles `maintenanceAuthorized` et `maintenanceAccess` du document `users/{userId}`. Leur mise à jour passe par `StorageService.updateUserMaintenanceAccess()`.

### 1.7 Services utilisés

- `StorageService` : utilisateurs, rôles, maintenance, suppression, points OUT et état applicatif.
- `UiService` : navigation, toast, état prêt et fermetures de dialogues.
- Firebase Auth : identité connectée.
- Firebase Firestore : `users`, `appSettings/maintenance`, `adminMessages` et pages métier.
- `MESSAGE_VARIABLES` / `replaceVariables` : personnalisation des messages.
- Services offline chargés globalement (`offline-sync`, adaptateurs, mapper, builder et `sync-manager`) ; ils ne constituent pas la source directe du tableau utilisateurs mais font partie du bootstrap de la page.

---

## 2. Analyse des données OUT

### 2.1 Collection et modèle exacts

Les OUT sont des documents de la collection :

```text
pages/page2/items/{itemId}
```

Chaque OUT contient notamment `siteId`, `numero`, les informations de créateur et le compteur `articleCount`. Les sites sont stockés séparément dans :

```text
pages/page1/items/{siteId}
```

Chaque document site possède le compteur dénormalisé `outCount`.

### 2.2 Fonctions de chargement et compteurs existants

Fonctions pertinentes de `js/storage.js` :

- `makePageItemsCollection('page2')` construit la référence de collection ;
- `readPage2ItemsBySite(siteId)` charge les OUT d'un site avec `where('siteId', '==', siteId)` ;
- `ensureSiteItemsLoaded(siteId)` les place dans `state.itemsBySite` ;
- `subscribeItems(siteId, ...)` expose les OUT d'un site ;
- `listOutCreationPoints()` et `subscribeOutCreationPoints()` lisent **tous** les OUT afin de les grouper par créateur pour Gestion Admin ;
- `getActualOutCountForSite(siteId)` compte le tableau local des OUT chargés ;
- `setSiteOutCount()`, `incrementSiteOutCount()` et `reconcileSiteOutCounts()` maintiennent/corrigent `pages/page1/items/{siteId}.outCount` ;
- `subscribeItemCounts()` publie une table `{ siteId: outCount }` à partir des sites en mémoire.

`outCount` est initialisé à zéro à la création d'un site, incrémenté lors de la création/restauration d'un OUT, décrémenté lors de sa suppression, recalculé lors des imports/restaurations et protégé contre les valeurs négatives lors des décréments. La Page 1 affiche ce champ sur chaque carte site.

### 2.3 Fiabilité du compteur existant

`outCount` constitue un compteur matérialisé utile et peu coûteux, mais il reste une donnée dérivée :

- les anciennes données peuvent ne pas posséder le champ ; dans ce cas le service place temporairement `0` et marque l'objet avec `__outCountWasMissing` ;
- `reconcileSiteOutCounts()` peut le comparer au nombre réel d'OUT chargés et le corriger ;
- la création/suppression de l'OUT et la modification du compteur sont deux opérations successives, pas une écriture atomique unique multi-documents ; une erreur intermédiaire peut donc créer un écart ;
- la réconciliation ne peut être exacte que pour les sites dont les OUT ont effectivement été chargés.

Il existe donc un compteur conçu et activement maintenu, mais sa fiabilité globale dépend de la migration/réconciliation complète et de l'absence d'échecs partiels.

### 2.4 Meilleure méthode pour Gestion Admin

**Recommandation : compter les documents du snapshot global Page 2 déjà utilisé par les points, avec `snapshot.size`, et exposer cette donnée via le service existant.**

Justification :

1. Gestion Admin ouvre déjà un abonnement sur `pages/page2/items` pour calculer les points par utilisateur ; le total OUT peut être dérivé du même snapshot sans aucune lecture documentaire supplémentaire.
2. `snapshot.size` mesure les documents OUT réellement présents, sans dépendre de `outCount` manquant ou désynchronisé.
3. Cela évite de charger Page 1 seulement pour sommer ses compteurs et évite les questions de visibilité/filtrage des sites dans `subscribeSites()`.
4. Le calcul se met à jour avec le même flux temps réel que les points.

Alternative acceptable si la lecture globale Page 2 destinée aux points est supprimée à l'avenir : sommer les `outCount` de tous les documents Page 1 après validation complète de leur migration. Ce serait alors moins volumineux si le nombre de sites est nettement inférieur au nombre d'OUT, mais moins robuste face à un compteur absent ou incohérent.

Il ne faut pas additionner les longueurs de `state.itemsBySite` à l'ouverture de Gestion Admin : les OUT ne sont chargés par site qu'à la demande et le résultat serait partiel.

---

## 3. Analyse des données Articles

### 3.1 Source exacte

Les articles sont les documents de :

```text
pages/page3/items/{detailId}
```

Chaque document porte `siteId` et `itemId`; `itemId` référence son OUT dans `pages/page2/items`.

Un compteur matérialisé existe sur chaque OUT :

```text
pages/page2/items/{itemId}.articleCount
```

Il n'existe dans le code ni champ global `totalArticles`, ni document global de statistiques, ni collection d'agrégats dédiée.

### 3.2 Fonctions de récupération et méthode des autres pages

Les articles sont récupérés par `readDetailsByQuery()` :

- par `siteId` dans `ensureSiteDetailsLoaded(siteId)` pour les besoins de Page 2 ;
- par couple `siteId` + `itemId` dans `ensurePairDetailsLoaded()` pour la Page 3 d'un OUT ;
- exposés via `subscribeDetails()`, `subscribeDetailCounts()`, `subscribeDetailDesignations()` et `subscribeDetailRows()`.

Pour le compteur simple des cartes OUT de Page 2, `renderItems()` préfère désormais `item.articleCount` quand aucun filtre/recherche n'est actif et que le compteur n'est pas marqué comme absent. Les lignes Page 3 restent nécessaires aux filtres, recherches, désignations et autres calculs détaillés.

Fonctions de maintenance de `articleCount` :

- `setItemArticleCount()` ;
- `incrementItemArticleCount()` ;
- `reconcileItemArticleCounts()` ;
- initialisation à zéro dans `createItem()` ;
- incrément dans `createDetail()` et `restoreDetail()` ;
- décrément dans `removeDetail()` ;
- recalcul pendant imports et restaurations.

Les incréments positifs utilisent `increment()` Firestore. Les décréments utilisent une transaction et bornent le résultat à zéro. Le flux offline ajuste aussi le compteur local et la synchronisation possède une couverture de tests d'idempotence.

### 3.3 Fiabilité et nécessité d'un calcul dynamique

`articleCount` est la meilleure source performante disponible, mais reste dénormalisé :

- un ancien OUT peut ne pas contenir le champ ; le service le marque `__articleCountWasMissing` et lui donne provisoirement la valeur locale zéro ;
- `reconcileItemArticleCounts()` corrige le compteur à partir des documents Page 3 chargés ;
- des articles orphelins sans `siteId` ou `itemId` ne peuvent pas être attribués ;
- une erreur entre l'écriture de l'article et celle du compteur peut produire un écart, même si les chemins normaux, import, restauration, suppression et offline sont explicitement pris en charge.

Il n'est pas nécessaire de recalculer dynamiquement tous les articles à chaque ouverture de Gestion Admin **si** la migration globale des compteurs a été validée. En revanche, l'interface future devrait pouvoir distinguer « compteur absent/incomplet » de la valeur réelle zéro, et une réconciliation d'administration ponctuelle doit rester possible hors du rendu courant.

### 3.4 Meilleure méthode pour le total articles

**Recommandation : sommer les `articleCount` de chaque document du snapshot `pages/page2/items` déjà reçu pour les points et le total OUT.**

Cette méthode :

- n'ajoute aucune lecture si elle partage réellement l'abonnement existant ;
- évite le téléchargement de tous les documents Page 3 ;
- suit exactement la source que Page 2 utilise pour ses compteurs simples ;
- se met à jour en temps réel lorsque les documents OUT sont mis à jour.

Précondition de mise en production : contrôler que chaque document OUT possède un `articleCount` numérique. Si au moins un compteur est absent/invalide, le total doit être considéré incomplet ; il vaut mieux afficher un état indisponible et lancer/planifier une réconciliation contrôlée que publier un total sous-estimé.

---

## 4. Analyse des performances

### 4.1 Comparaison

| Critère | Solution A — compter les documents réels | Solution B — utiliser les compteurs existants |
| --- | --- | --- |
| Total OUT | Lire `pages/page2/items`, puis `snapshot.size`. Exact pour les documents visibles au snapshot. | Sommer `outCount` de Page 1. Moins de documents si peu de sites, mais compteur dérivé. |
| Total articles | Lire tous les documents `pages/page3/items`, puis compter. Exact au snapshot sous réserve des droits et documents valides. | Lire les OUT Page 2 et sommer `articleCount`. |
| Coût Firestore | Proportionnel au nombre de documents lus. Très défavorable pour les articles ; un abonnement temps réel ajoute les changements ultérieurs. | Proportionnel au nombre de sites (OUT via `outCount`) ou d'OUT (articles via `articleCount`), généralement très inférieur au nombre d'articles. |
| Rapidité | Temps réseau, désérialisation et mémoire augmentent avec le volume total ; charger Page 3 peut ralentir sensiblement Gestion Admin. | Somme locale de nombres déjà chargés, donc rapide. |
| Cohérence | Très forte au moment du snapshot : les documents réels sont la source de vérité. | Risque d'écart en cas de champ absent, ancien, invalide ou d'écriture partielle ; nécessite migration et réconciliation. |
| Plusieurs utilisateurs | Le résultat reflète le snapshot ; `onSnapshot()` reçoit les changements, mais beaucoup de clients lisent chacun le grand ensemble. | Les incréments Firestore limitent les écrasements concurrents ; les décréments transactionnels sont sûrs. Chaque client lit beaucoup moins de données. Une écriture métier et son compteur ne sont toutefois pas atomiques ensemble. |
| Compatibilité offline | Un cache peut fournir un état ancien/partiel, à signaler. | Les compteurs sont adaptés au cache, mais une action offline en attente peut rendre la valeur locale temporairement différente du serveur. |

### 4.2 Application au contexte réel de Gestion Admin

Le choix n'est pas purement théorique : la page lit déjà tous les documents Page 2, deux fois côté temps réel (service et module inline), après une lecture initiale `getDocs()` dans `listOutCreationPoints()`. Ainsi :

- obtenir `snapshot.size` pour le total OUT sur **l'un des snapshots existants** n'ajoute pas de coût de lecture ;
- sommer `articleCount` sur ce même snapshot n'ajoute pas de lecture ;
- charger Page 3 pour le total articles serait une nouvelle charge potentiellement importante ;
- ajouter un nouvel abonnement Page 2 serait inutile et augmenterait la duplication.

Le premier gain recommandé est donc la **consolidation** : un seul abonnement de service Page 2 doit produire les points et les deux statistiques. Le module inline ne devrait pas ouvrir une lecture parallèle uniquement pour la statistique.

Une requête d'agrégation Firestore `count()` côté serveur pourrait réduire les données transférées pour un contrôle ponctuel, mais elle n'est ni importée ni encapsulée dans l'architecture actuelle, ne résout pas à elle seule le total des articles sans lire/agréger Page 3, et ne doit pas remplacer le partage du snapshot déjà payé tant que celui-ci reste nécessaire aux points.

---

## 5. Analyse de sécurité

### 5.1 Protection de Gestion Admin

Un contrôle d'accès **côté client** existe : `initUsersPage(permissions)` renvoie vers `index.html` lorsque l'utilisateur n'est ni `isAdmin` ni `isStandard`.

Cependant, `buildPermissions()` traite les rôles `standard`, `adjoint` et `adjoint admin` comme adjoints administrateurs, puis met `isAdmin: true` et `isStandard: false` dans le retour de la branche administrateur. En pratique, ces rôles passent donc le contrôle et ont les capacités administrateur du client. Le compte principal est aussi promu via l'email configuré, et un profil dont le nom est exactement `Admin` est traité comme admin.

La navigation masque le bouton Gestion Admin aux rôles non autorisés, mais cela ne constitue pas une frontière de sécurité : une URL peut être saisie directement, puis la redirection dépend du JavaScript et du profil reçu.

### 5.2 Règles Firestore

Aucun fichier de règles Firestore (`firestore.rules`) ni configuration de déploiement correspondante n'est présent dans le dépôt audité. Il est donc **impossible de confirmer depuis ce code** que Firestore refuse côté serveur :

- la lecture globale de `users` ;
- la lecture de toutes les Pages 1/2/3 ;
- la modification des rôles et autorisations de maintenance ;
- l'écriture de l'état de maintenance ou des messages administrateur.

Le module inline utilise d'ailleurs directement `firebaseDb` et `onSnapshot()` sans passer par un garde de service. La sécurité réelle doit obligatoirement être vérifiée dans les règles effectivement déployées, mais celles-ci ne doivent pas être modifiées dans le cadre de l'ajout demandé.

### 5.3 Visibilité recommandée

Les statistiques globales doivent rester dans Gestion Admin et hériter exactement du même garde que cette page. Elles ne doivent pas être exposées dans une page publique ni chargées avant validation des permissions.

Décision fonctionnelle à clarifier avant implémentation : le terme « admin » inclut-il les rôles `Adjoint Admin` ? Le comportement actuel répond **oui** pour l'accès à Gestion Admin. Si l'intention est « administrateur principal uniquement », le garde actuel ne suffit pas ; ce point dépasse toutefois le périmètre de cet audit.

---

## 6. Proposition d'intégration sans code

### 6.1 Architecture cible

```text
Gestion Admin (`users.html` / `initUsersPage`)
        ↓
`StorageService` — flux global Page 2 consolidé
        ↓
Firestore `pages/page2/items`
        ├── nombre de documents = total OUT
        └── somme `articleCount` = total articles
```

Le flux peut également continuer à produire les points par `createdBy`/`ownerId`, de sorte qu'un seul snapshot serve trois usages.

### 6.2 Emplacement idéal du bloc

Placer une nouvelle carte statistique autonome dans `main.page-content`, immédiatement **sous la carte maintenance et au-dessus de la carte utilisateurs**. Cet emplacement :

- respecte la hiérarchie « état global → statistiques globales → gestion détaillée » ;
- évite de mélanger statistiques métier et compteur des utilisateurs dans `usersCardHeader` ;
- conserve la modale et le bouton flottant indépendants ;
- nécessitera d'adapter la grille CSS actuellement limitée à deux lignes.

Le bloc devrait présenter deux valeurs sœurs : « Total OUT » et « Total articles », avec états de chargement, erreur et donnée incomplète. Le présent audit ne modifie pas l'interface.

### 6.3 Fichiers qui seraient à modifier

| Fichier | Modification future proposée |
| --- | --- |
| `users.html` | Ajouter la structure sémantique du bloc et ses valeurs/états. |
| `css/style.css` | Ajouter les styles responsive et faire évoluer la grille de Gestion Admin de deux à trois rangées. |
| `js/storage.js` | Exposer un flux consolidé de statistiques + points à partir d'un unique snapshot Page 2, avec validation des `articleCount`. |
| `js/app.js` | Consommer le flux dans `initUsersPage()`, rendre chargement/erreur/valeurs et nettoyer l'abonnement au départ de page. |
| `users.html` (module inline) | Supprimer ou réorganiser le futur doublon de lecture Page 2 ; ne pas y ajouter un troisième abonnement direct. |

Les règles Firestore, les collections et les documents métier ne devraient pas être modifiés pour cet affichage.

### 6.4 Fonctions à réutiliser ou faire évoluer

- Réutiliser le principe de `normalizeOutCreationPointsSnapshot(snapshot)` pour effectuer une seule réduction du snapshot.
- Faire évoluer/consolider `listOutCreationPoints()` et `subscribeOutCreationPoints()` ou créer une API de service clairement nommée, par exemple un flux de synthèse administrative, qui renvoie : points, `totalOut`, `totalArticles`, nombre de compteurs manquants et état de complétude.
- Réutiliser la normalisation stricte de `normalizeArticleCount()` mais ne pas perdre l'information « champ absent ».
- Réutiliser la gestion d'erreur et les toasts de `initUsersPage()` ; prévoir cependant un état visible dans la carte plutôt qu'un toast seul.
- Conserver `reconcileItemArticleCounts()` comme outil de contrôle/migration séparé, jamais comme effet automatique de chaque rendu de Gestion Admin.

### 6.5 Risques

1. **Sous-comptage silencieux** si un `articleCount` absent est normalisé en zéro.
2. **Lectures dupliquées** à cause de `getDocs()`, de l'abonnement du service et du module inline actuels.
3. **Données momentanément divergentes** pendant une création/suppression, car document métier et compteur ne sont pas écrits dans la même transaction atomique.
4. **Offline/cache** : une statistique issue du cache peut être ancienne ; l'état de synchronisation doit être explicite.
5. **Droits insuffisants** : un rôle admis par l'UI peut ne pas disposer des lectures globales selon les règles déployées.
6. **Sémantique “article”** : le code considère chaque document Page 3 comme un article, indépendamment de `qteSortie`; le total demandé est donc un nombre de lignes/documents, pas une somme de quantités.
7. **Articles orphelins** : sommer `articleCount` ne fait pas apparaître un document Page 3 qui ne référence aucun OUT valide.
8. **Sites/OUT supprimés et corbeille** : les totaux proposés comptent seulement les documents actifs des collections Page 2/Page 3, pas les snapshots de `trash`, ce qui correspond aux compteurs courants des pages actives.
9. **Cycle de vie des abonnements** : les abonnements actuels ne sont pas tous explicitement désabonnés au `pagehide`; la consolidation doit retourner et appeler les fonctions d'unsubscribe.

---

## 7. Tests à prévoir

### 7.1 Tests unitaires du service

- Snapshot Page 2 vide : `totalOut = 0`, `totalArticles = 0`.
- Plusieurs OUT/sites : `totalOut` égale le nombre total de documents, sans double comptage par site.
- Somme de plusieurs `articleCount`, y compris zéro.
- `articleCount` absent, `null`, chaîne, négatif ou non fini : état incomplet détecté ; aucune sous-estimation présentée comme certaine.
- Les points par créateur restent inchangés après consolidation du flux.
- Un événement snapshot d'ajout/suppression/modification met à jour les bons totaux une seule fois.

### 7.2 Tests d'intégration fonctionnelle

- **Affichage OUT correct** : comparer la valeur Gestion Admin au nombre de documents actifs `pages/page2/items` et au total affiché sur l'ensemble des sites Page 1.
- **Affichage articles correct** : comparer la somme Gestion Admin au nombre de documents actifs `pages/page3/items` et à la somme des compteurs simples de tous les OUT.
- **Cohérence Page OUT** : créer, supprimer puis restaurer un OUT ; vérifier Page 1, Page 2 et Gestion Admin après chaque étape.
- **Cohérence Page Articles** : créer, supprimer puis restaurer un article ; vérifier Page 2, Page 3 et Gestion Admin après chaque étape.
- Importer puis restaurer un jeu contenant plusieurs sites, OUT et articles ; contrôler les deux agrégats.
- Tester une création/suppression offline, puis avant et après synchronisation.
- Tester un ancien OUT sans `articleCount` : le bloc ne doit pas afficher un total faussement complet.
- Tester les états chargement, erreur Firestore, perte réseau, retour réseau et snapshot depuis cache.

### 7.3 Tests de sécurité

- Utilisateur non authentifié : redirection/blocage et absence de lecture de statistiques.
- Rôle `limite` et rôle `lecture` : page bloquée, aucun bloc visible et aucune lecture globale initiée.
- Rôle `admin` : accès et statistiques visibles.
- Rôles `standard` / `Adjoint Admin` : confirmer le comportement métier attendu, actuellement autorisé.
- Tester directement les règles Firestore déployées avec l'émulateur ou les tests de règles : un client non admin ne doit pas pouvoir contourner l'UI pour lire les agrégats/sources globales.

### 7.4 Tests de performance et non-régression

- Vérifier dans l'outil réseau/émulateur qu'un seul listener `pages/page2/items` sert points et statistiques.
- Vérifier que Gestion Admin ne lit pas `pages/page3/items` pour afficher les statistiques.
- Mesurer temps d'affichage et volume de lectures avec 0, 100, 1 000 et davantage d'OUT.
- Ouvrir plusieurs sessions administrateur et vérifier la mise à jour temps réel sans perte d'incrément.
- Vérifier qu'une recherche utilisateur ne recalcule pas les statistiques sur la liste filtrée.
- Vérifier que maintenance, rôles, messages, suppression, points et rafraîchissement de présence restent fonctionnels.
- Vérifier la mise en page desktop/mobile et l'absence de débordement après ajout futur de la troisième rangée.

---

## Verdict final

L'architecture possède déjà les données nécessaires et il n'est pas justifié de créer une collection ou un compteur global supplémentaire. Le chemin optimal est :

1. consolider l'unique lecture globale Page 2 déjà requise par les points ;
2. en tirer le nombre réel d'OUT avec la taille du snapshot ;
3. sommer les `articleCount` validés pour les articles ;
4. exposer le résultat par `StorageService` à `initUsersPage()` ;
5. refuser un total articles présenté comme fiable si des compteurs sont absents, jusqu'à réconciliation ;
6. conserver les statistiques dans la zone protégée Gestion Admin et vérifier séparément les règles Firestore déployées.

Cette proposition respecte l'architecture attendue **Gestion Admin → service de données existant → Firestore/compteurs existants**, tout en minimisant les lectures et sans toucher au modèle Firestore.
