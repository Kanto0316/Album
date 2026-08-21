# Audit final de `outCount` avant séparation Page 1 / Page 2

> Portée : audit statique du code présent dans le dépôt. Aucune écriture Firestore, aucune suppression de document et aucune séparation Page 1 / Page 2 n'ont été effectuées.

## 1. Structure des documents Page 1

Les documents Page 1 sont lus depuis `pages/page1/items` via `readPageItems('page1')` et normalisés en ajoutant l'identifiant Firestore dans le champ local `id`.

### Champs Page 1 identifiés

| Donnée | Champ document / état local | Utilisation constatée |
|---|---|---|
| Nom du site | `nom` | Création, recherche, tri, affichage de la card, titre Page 2/Page 3, historique. |
| Identifiant du document site | `id` local, issu de l'ID Firestore | Navigation Page 1 → Page 2, `siteId` des OUT, restauration, suppression, compteurs. |
| Date de création | `dateCreation` | Affichage card Page 1, export/import. |
| Date de modification | `dateModification` | Tri d'état interne et mises à jour de nom/verrouillage/inactivité. |
| Identifiant du créateur | `createdBy`, avec compatibilité `ownerId` | Permissions, affichage créateur, changement créateur, suppression site. |
| Nom du créateur | `createdByName` | Affichage card Page 1 avec résolution par `resolveActorLabel`. |
| Email du créateur | `createdByEmail` | Présent lors d'un changement de créateur via `updateSiteCreator`; absent à la création initiale actuelle. |
| Statut / verrouillage | `isLocked`, `passwordHash`, `lockedAt`, `lockedBy`, `lockedByName`, `unlockedBy`, `unlockedByName`, `unlockAttemptsRemaining`, `unlockBlockedUntil` | Affichage/verrouillage/déverrouillage du site. |
| Inactivité | `inactiveSince`, `inactivityDecisionPending`, `inactivityDecisionPendingAt` | Détection et restauration des sites inactifs. |
| Import | `importedAt` | Peut exister sur les sites importés depuis l'ancien format. |
| Compteur auxiliaire OUT | `outCount` | Nouveau champ Page 1 pour le nombre d'OUT. |

### Vérification de non-remplacement

- La création d'un site ajoute `outCount: 0` au payload existant sans supprimer les champs `nom`, `ownerId`, `createdBy`, `createdByName`, `dateCreation` et `dateModification`.
- Les mises à jour de nom, créateur, verrouillage, inactivité et compteur utilisent `setDoc(..., { merge: true })` ou des champs ciblés, ce qui limite les écritures aux champs concernés.
- La fonction `setSiteOutCount()` écrit uniquement `{ outCount: normalizedCount }` avec merge.
- La fonction `incrementSiteOutCount()` écrit uniquement `outCount`, par `increment()` pour les ajouts ou par transaction `set(..., { merge: true })` pour les décréments.

**Conclusion obligatoire : les données existantes du document site sont intactes dans le code audité.** L'ajout de `outCount` est traité comme un champ auxiliaire et ne remplace pas `nom`, `dateCreation`, `createdBy`, `createdByName`, `createdByEmail`, `ownerId` ni les champs de statut/verrouillage/inactivité.

## 2. Vérification de `outCount`

Le nombre réel d'OUT est calculé en mémoire depuis `state.itemsBySite`, lui-même alimenté par les documents `pages/page2/items` possédant un `siteId` non vide. La fonction de migration compare `site.outCount` au nombre réel obtenu par `getActualOutCountForSite(site.id)`.

### Tableau de comparaison demandé

| Site | siteId | outCount | Nombre réel d'OUT | Écart | Résultat |
|---|---|---:|---:|---:|---|
| Non déterminable statiquement | Non déterminable statiquement | Non déterminable statiquement | Non déterminable statiquement | Non déterminable statiquement | ⚠️ Données Firestore réelles non lues dans cet audit statique |

Le dépôt ne contient pas d'export Firestore complet des collections `pages/page1/items` et `pages/page2/items`. Sans exécuter une lecture authentifiée de l'instance Firestore réelle, il est impossible d'établir la liste de chaque site existant, son `outCount` enregistré et le nombre réel de documents OUT associés.

Constat code : au chargement distant non-cache, `init()` lit Page 1, Page 2 et `materialCodes`, applique l'état, puis lance `reconcileSiteOutCounts(null, { logReport: true })`. Cette réconciliation écrit les corrections dans Firestore ; elle n'a donc volontairement pas été exécutée pendant cet audit, car la consigne interdit toute modification de données Firestore.

## 3. Création d'un OUT

La création d'un OUT est assurée par `createItem(siteId, numberValue, options = {})`.

Vérifications :

1. L'OUT est créé dans `pages/page2/items` avec `addDoc(makePageItemsCollection('page2'), itemPayload)`.
2. Le payload contient bien `siteId`, `numero`, `magasin`, `ownerId`, `createdBy`, `createdByName`, `dateCreation` et `dateModification`.
3. Après création du document OUT, `incrementSiteOutCount(siteId, 1)` incrémente le compteur du site.
4. L'incrément positif utilise `updateDoc(siteDocRef(siteId), { outCount: increment(delta) })`, donc il ne remplace pas les autres champs du site.
5. L'opération n'est pas atomique entre la création OUT et l'incrément `outCount` : ce sont deux écritures séparées, sans batch ni transaction englobant les deux. L'incrément lui-même est atomique côté Firestore grâce à `increment()`, mais un échec entre `addDoc` et `updateDoc` peut créer une désynchronisation temporaire ou durable jusqu'à réconciliation.

## 4. Suppression d'un OUT

La suppression d'un OUT est assurée par `removeItem(siteId, itemId)`.

Vérifications :

1. Le bon OUT est recherché dans `state.itemsBySite.get(siteId)` par `item.id === itemId`.
2. Le bon site est identifié par le paramètre `siteId` et par la clé locale utilisée pour accéder aux OUT.
3. Le document OUT est supprimé de `pages/page2/items`, puis `incrementSiteOutCount(siteId, -1)` décrémente le compteur.
4. Le décrément est protégé contre les valeurs négatives : la transaction lit le compteur courant et écrit `Math.max(0, currentCount + delta)`.
5. La mise à jour du compteur utilise `transaction.set(ref, { outCount: ... }, { merge: true })`, donc aucune autre donnée du site n'est supprimée.
6. Comme pour la création, la suppression du document OUT et le décrément du compteur ne sont pas dans une transaction ou un batch unique. Si `deleteDoc` réussit puis que la transaction de compteur échoue, `outCount` peut rester trop élevé jusqu'à réconciliation.

## 5. Modification d'un OUT

Le flux identifié de modification d'OUT est `updateItemName(siteId, itemId, nextValue)`. Il modifie uniquement `numero` et `dateModification` sur le document `pages/page2/items/{itemId}` avec merge.

- Aucun code audité ne permet de changer le `siteId` d'un OUT existant.
- Si le site ne change pas, `outCount` ne doit pas changer : c'est bien le cas pour `updateItemName()`.
- Si une future fonctionnalité permettait de changer `siteId`, elle devrait décrémenter l'ancien site et incrémenter le nouveau site. Cette logique n'existe pas actuellement car le changement de site n'existe pas dans le flux identifié.

## 6. Import / restauration / duplication / créations multiples / suppressions multiples

### Import

- `normalizeImportPayload()` accepte soit un format moderne `payload.pages`, soit un ancien format `payload.data`.
- Pour les sites importés, `importData()` force `sitePayload.outCount = 0` au moment de créer les documents Page 1.
- Les OUT importés sont ensuite créés dans `pages/page2/items` avec le `siteId` remappé.
- Après insertion en mémoire des sites et OUT importés, `importData()` appelle `reconcileSiteOutCounts()` sur les sites ajoutés et les sites des OUT ajoutés. Le compteur final est donc recalculé depuis les OUT réellement importés.

Risques import :

- Les écritures ne sont pas atomiques globalement. Une erreur pendant l'import peut laisser des documents partiellement créés.
- `outCount` n'est pas incrémenté OUT par OUT pendant l'import ; il est corrigé à la fin. Si l'import est interrompu avant la réconciliation, compteur incorrect possible.
- Si des OUT importés ciblent un `siteId` existant non importé, la réconciliation inclut aussi `addedItems.map(item.siteId)`, ce qui limite le risque de compteur non mis à jour.

### Restauration de site

- `restoreSite(snapshot)` recrée un nouveau document Page 1 avec `outCount` égal au nombre d'items restaurés.
- Chaque OUT restauré reçoit `siteId: nextSite.id`, donc le nouveau site et ses OUT restaurés sont cohérents.
- Risque : restauration non atomique entre site, OUT et détails. Une erreur intermédiaire peut produire une restauration partielle ; le `catch` retourne `false` mais ne rollback pas les documents déjà créés.

### Restauration d'OUT

- `restoreItem(snapshot)` recrée l'OUT dans Page 2, puis incrémente `outCount` du `itemPayload.siteId`.
- Risque : non atomique entre recréation OUT, incrément compteur et détails restaurés.

### Duplication

Aucune fonction de duplication explicite d'un site ou d'un OUT n'a été identifiée dans `StorageService`. Les opérations proches de la duplication sont la restauration et l'import.

### Création multiple

Aucune création multiple d'OUT dédiée n'a été identifiée. Les créations multiples possibles passent par import/restauration.

### Suppression multiple

La suppression d'un site supprime en parallèle les détails Page 3, les OUT Page 2 et le site Page 1. Comme le site est supprimé, `outCount` n'a pas à être décrémenté OUT par OUT dans ce flux. Les suppressions multiples d'OUT indépendants ne sont pas identifiées hors suppression de site.

## 7. Page 1

Page 1 affiche le compteur depuis `site.outCount`. Dans `renderSites()`, le compteur est normalisé depuis `site.outCount` puis rendu dans la card.

Fonctionnalités Page 1 auditées :

| Fonction | Constats |
|---|---|
| Recherche | Filtre sur `site.nom`; pas besoin de Page 2. |
| Filtres | Aucun filtre Page 1 dépendant directement des OUT n'a été identifié dans le rendu principal. |
| Tri | Tri UI par `compareSitesByName`; tri d'état interne par `dateModification`. |
| Affichage | Utilise `nom`, `outCount`, `dateCreation`, `createdBy`/`createdByName`, verrouillage et badge d'inactivité. |
| Date de création | Affichée via `buildDateAndTimeLabel(site.dateCreation)`. |
| Créateur | Affiché via `resolveActorLabel(site.createdBy, userNamesById, site.createdByName)`. |
| Navigation | `data-site-open` navigue vers `page2.html?siteId=...`. |
| Modification site | `updateSiteName()` modifie seulement `nom` et `dateModification` avec merge. |
| Suppression site | `removeSite()` supprime site, OUT et détails associés, après sauvegarde éventuelle en corbeille. |

Réponse précise : **Oui, Page 1 peut afficher correctement le nombre d'OUT uniquement avec les documents de Page 1 + `outCount`, sous condition que `outCount` soit déjà synchronisé avec Page 2.** Le rendu Page 1 ne dépend plus du calcul `items.length` pour afficher le compteur.

## 8. Page 2

Page 2 utilise actuellement l'état `currentItems`, alimenté par `StorageService.subscribeItems(siteId, ...)`. Cette souscription ne déclenche pas une requête Firestore ciblée ; elle lit l'état en mémoire `state.itemsBySite`, qui provient actuellement de la lecture globale `readPageItems('page2')` au lancement.

### Structure OUT identifiée

| Champ OUT | Rôle |
|---|---|
| `id` | Identifiant local issu de l'ID document Firestore. |
| `siteId` | Lien vers le document site Page 1. |
| `numero` | Numéro OUT affiché et modifiable. |
| `magasin` | Magasin associé. |
| `ownerId`, `createdBy`, `createdByName` | Propriétaire/créateur et affichage. |
| `dateCreation`, `dateModification` | Dates affichées, tri et historique. |
| `importedAt` | Peut exister pour les imports. |

Fonctions Page 2 :

| Fonction | Source / dépendances |
|---|---|
| Collection OUT | `pages/page2/items`. |
| Recherche | `getFilteredOutItems(query)` travaille sur `currentItems` et sur désignations/détails associés. |
| Filtres | Filtres de statut/curseur basés sur compteurs et lignes de détails Page 3 chargées par site. |
| Tri / groupement | Rendu basé sur `filteredItems` et labels de période. |
| Création | `StorageService.createItem(siteId, value, { magasin })`. |
| Modification | `StorageService.updateItemName(siteId, itemId, value)` pour OUT ; achats matériels séparés sous `sites/{siteId}/achatsMateriels`. |
| Suppression | `StorageService.removeItem(siteId, itemId)`. |
| Compteurs | Compteur d'OUT Page 2 = `filteredItems.length`; compteurs d'articles via détails Page 3. |
| Historique | `appendHistoryEntry()` vers `historiques`. |
| Détails | `subscribeDetailCounts`, `subscribeDetailDesignations`, `subscribeDetailRows` chargent Page 3 par `siteId`. |

Le champ `siteId` existe réellement dans les OUT créés/importés/restaurés. Techniquement, Page 2 peut donc être chargée avec une requête ciblée `where('siteId', '==', siteId)` sur `pages/page2/items`, sous réserve d'adapter `readPageItems`/`subscribeItems` et l'état local sans modifier Page 3 dans cette étape.

## 9. Dépendances Page 1 → Page 2

| Fonction Page 1 | Donnée nécessaire | Source actuelle | Peut utiliser outCount ? | Risque |
|---|---|---|---|---|
| Affichage compteur OUT dans la card | Nombre d'OUT du site | `site.outCount` dans le rendu actuel ; ancien état Page 2 encore chargé globalement | Oui | Si `outCount` est désynchronisé, affichage faux. |
| Inactivité / décision créateur | Savoir si un site a 0 OUT | `getSiteOutCount()` lit `site.outCount` avec fallback `itemsBySite` | Oui | Si `outCount` est faux et Page 2 n'est plus chargée globalement, décision d'inactivité fausse. |
| Suppression site | Liste des OUT et détails à supprimer/sauvegarder | `state.itemsBySite` et `state.detailsByItem` | Non, `outCount` ne remplace pas la liste des OUT | Après séparation, suppression site devra charger les OUT/détails ciblés avant suppression ou utiliser un backend/batch adapté. |
| Corbeille / restauration site | Snapshot complet site + OUT + détails | Page 2 et Page 3 en mémoire | Non | Risque de snapshot incomplet si Page 2 n'est plus préchargée. |
| Navigation Page 1 → Page 2 | `site.id` | Document Page 1 | Non nécessaire | Aucun risque lié à `outCount`. |

Réponse : **Page 1 n'a plus besoin de `page2/items` uniquement pour calculer les compteurs d'affichage.** `outCount` permet de supprimer cette dépendance pour l'affichage et probablement pour l'inactivité, à condition d'avoir un compteur fiable. En revanche, certaines actions Page 1 comme suppression/restauration complète d'un site dépendent encore des données Page 2/Page 3 pour disposer des éléments à supprimer ou sauvegarder.

## 10. Lectures Firestore au démarrage

| Collection | Fonction | Global/Ciblée | Déclencheur | Raison |
|---|---|---|---|---|
| `pages/page1/items` | `readPageItems('page1')` | Globale | `StorageService.init()` si cache absent/expiré | Charger les sites. |
| `pages/page2/items` | `readPageItems('page2')` | Globale | `StorageService.init()` si cache absent/expiré | Alimenter `itemsBySite`, calcul/réconciliation compteurs, Page 2 actuelle. |
| `materialCodes` | `readMaterialCodes()` | Globale | `StorageService.init()` si cache absent/expiré | Typeahead codes matériaux. |
| `pages/page3/items` | `bootstrapMaterialCodesFromDetails()` | Globale conditionnelle | Seulement si `materialCodes` est vide au chargement | Amorcer le catalogue de codes depuis les détails. |
| `pages/page3/items` | `ensureSiteDetailsLoaded(siteId)` | Ciblée `where('siteId', '==', siteId)` | Page 2 via compteurs/désignations/lignes détails | Compteurs articles et filtres Page 2. |
| `pages/page3/items` | `ensurePairDetailsLoaded(siteId, itemId)` | Ciblée `where('siteId', '==', siteId)`, `where('itemId', '==', itemId)` | Page 3 | Détails d'un OUT. |
| `historiques` | `listHistoriques()` / `subscribeHistoriques()` | Globale ordonnée | Page historiques | Afficher l'historique. |
| `trash` | `subscribeTrashEntries()` | Globale ordonnée | Page corbeille / réglages corbeille | Afficher/restaurer la corbeille. |
| `trash/settings` | `subscribeTrashSettings()` / `isTrashEnabled()` | Document ciblé | Init corbeille ou suppression | Savoir si la corbeille est active. |
| `users` | Fonctions profils/permissions | Selon fonctions | Authentification, affichages créateurs, permissions | Profils utilisateurs. |
| `sites/{siteId}/achatsMateriels` | Fonctions achats matériels Page 2 | Ciblée par site | Onglet achats matériels Page 2 | Achats matériels. |

Avant séparation :

- Page 1 → dépend du chargement global `page1/items` et bénéficie encore du chargement global `page2/items` dans l'état initial, même si son compteur affiché vient de `site.outCount`.
- Page 2 → dépend du chargement global `page2/items`, puis consomme localement les OUT filtrés par `siteId`; charge aussi Page 3 de façon ciblée par site pour les compteurs/filtres articles.
- Page 3 → utilise `siteId + itemId` et charge les détails ciblés par paire si nécessaire.

## 11. Risque pour les données du site

La future séparation Page 1/Page 2 ne devrait pas nécessiter de déplacer :

- le nom du site (`nom`) ;
- la date de création (`dateCreation`) ;
- le nom du créateur (`createdByName`) ;
- l'email du créateur (`createdByEmail`, lorsqu'il existe) ;
- les identifiants créateur (`createdBy`, `ownerId`) ;
- l'identifiant du site (`id` côté document Page 1, référencé par `siteId` côté OUT) ;
- les champs de verrouillage/inactivité/statut.

`outCount` est uniquement un nouveau champ auxiliaire du document site. Il ne doit pas remplacer les données existantes et le code audité ne le fait pas.

## 12. Préparation de la séparation

Architecture cible proposée, sans modification effectuée :

```text
LANCEMENT
↓
Page 1
↓
lecture des documents sites pages/page1/items
↓
utilisation de site.outCount
↓
UTILISATEUR CLIQUE SUR UN SITE
↓
siteId
↓
Page 2
↓
lecture ciblée des OUT du site : pages/page2/items where("siteId", "==", siteId)
↓
UTILISATEUR CLIQUE SUR UN OUT
↓
Page 3
↓
siteId + itemId
↓
lecture ciblée des détails : pages/page3/items where("siteId", "==", siteId) + where("itemId", "==", itemId)
```

Points à prévoir lors de la future séparation :

1. Remplacer la lecture globale Page 2 au lancement par un chargement ciblé déclenché par Page 2.
2. Garantir que les actions Page 1 nécessitant la liste des OUT/détails d'un site chargent ces données à la demande avant suppression/restauration.
3. Conserver `materialCodes` et le typeahead inchangés si ce n'est pas dans la portée.
4. Ne pas modifier Page 3 si la prochaine étape l'exclut ; elle possède déjà des chargements ciblés.
5. Ajouter un mécanisme d'audit/réconciliation non destructif ou explicitement déclenché pour vérifier `outCount` sans corriger automatiquement lors d'un simple audit.

## 13. Conditions pour autoriser la séparation

| Condition | Statut audit | Commentaire |
|---|---|---|
| `outCount` existe pour les sites concernés. | ⚠️ À vérifier sur données réelles | Code crée/migre le champ, mais la présence effective par site n'a pas été lue. |
| `outCount` correspond au nombre réel d'OUT. | ⚠️ À vérifier sur données réelles | Le code sait comparer/corriger, mais le tableau réel n'est pas déterminable statiquement. |
| Page 1 peut utiliser `outCount`. | ✅ Rempli | Le rendu lit `site.outCount`. |
| Nom du site intact. | ✅ Rempli côté code | `nom` conservé, écrit séparément avec merge. |
| Date de création intacte. | ✅ Rempli côté code | `dateCreation` créée/conservée ; non remplacée par `outCount`. |
| Nom du créateur intact. | ✅ Rempli côté code | `createdByName` conservé et affiché. |
| Les autres champs du site sont intacts. | ✅ Rempli côté code | Écritures `outCount` ciblées/merge. |
| Création OUT maintient correctement `outCount`. | ⚠️ Partiellement | Incrément après création, mais pas atomique avec `addDoc`. |
| Suppression OUT maintient correctement `outCount`. | ⚠️ Partiellement | Décrément non négatif en transaction, mais pas atomique avec `deleteDoc`. |
| Modification OUT est correctement gérée. | ✅ Rempli pour renommage | Aucun changement de site identifié. |
| Import/restauration est analysé. | ✅ Rempli | Risques non atomiques identifiés. |
| Page 2 possède un `siteId` exploitable. | ✅ Rempli côté code | Création/import/restauration OUT renseignent `siteId`. |
| Les fonctions Page 2 ont été identifiées. | ✅ Rempli | Voir section 8. |
| Les dépendances Page 1 → Page 2 sont connues. | ✅ Rempli | Voir section 9. |
| Aucun risque critique non résolu n'est identifié. | ⚠️ Non totalement rempli | Données réelles non vérifiées et opérations compteur non atomiques avec création/suppression OUT. |

## 14. VERDICT AVANT SÉPARATION

⚠️ PRÊT AVEC CONDITIONS

Conditions exactes avant de continuer :

1. Produire un audit réel en lecture seule des collections Firestore `pages/page1/items` et `pages/page2/items` pour remplir le tableau site par site demandé (`siteId`, `outCount`, nombre réel d'OUT, écart).
2. Confirmer que chaque document OUT existant possède un `siteId` non vide et correspondant à un site Page 1 existant, ou lister les anomalies.
3. Décider si le risque non atomique création/suppression OUT ↔ compteur est acceptable avec réconciliation, ou s'il faut prévoir une future correction par batch/transaction/fonction backend.
4. Avant suppression de la lecture globale `page2/items`, adapter les actions Page 1 qui nécessitent la liste complète des OUT/détails d'un site, notamment suppression site, corbeille et restauration.
5. Ne pas lancer la séparation tant que le tableau réel `outCount` vs nombre d'OUT n'a pas confirmé l'absence d'écarts bloquants.
