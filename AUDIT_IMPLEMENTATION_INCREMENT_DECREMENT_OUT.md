# Audit — implémentation incrément/décrément du compteur OUT

## Périmètre et fichiers modifiés

- `js/storage.js` : branchement de `createItem()` et `removeItem()` sur les nouvelles opérations atomiques, puis synchronisation de l'état local après validation Firestore.
- `js/out-counter-transaction.js` : opérations transactionnelles dédiées à la création et à la suppression d'un OUT avec mise à jour de `outCount`.
- `tests/out-counter-transaction.test.mjs` : tests comportementaux du compteur et de l'atomicité.
- `tests/page2-deletion.test.mjs` : adaptation des contrôles du flux de suppression à la transaction.
- `AUDIT_IMPLEMENTATION_INCREMENT_DECREMENT_OUT.md` : présent rapport.

## Fonctions modifiées ou ajoutées

- `createItem(siteId, numberValue, options)` prépare désormais une référence de document OUT, exécute la création et l'incrément dans une seule transaction, puis utilise le compteur retourné pour actualiser l'état local.
- `removeItem(siteId, itemId)` conserve les vérifications d'autorisation, de quota et la logique de corbeille existantes, mais regroupe la suppression et le décrément dans une seule transaction. L'historique et le quota restent des traitements secondaires inchangés dans leur finalité.
- `createOutAndIncrementCounter(...)` vérifie l'existence du site, considère un compteur absent ou invalide comme zéro, crée l'OUT et écrit le compteur augmenté.
- `deleteOutAndDecrementCounter(...)` vérifie l'existence de l'OUT et du site ainsi que leur rattachement, supprime l'OUT et écrit un compteur décrémenté avec un plancher à zéro.

## Stratégie transactionnelle

Firestore impose toutes les lectures avant les écritures d'une transaction. La création lit donc d'abord le site, puis programme dans la même transaction la création du document sous `pages/page2/items/{itemId}` et l'écriture de `outCount + 1` sous `pages/page1/items/{siteId}`. L'identifiant OUT est alloué localement par `doc(collection)` avant la transaction, sans créer le document prématurément.

La suppression lit d'abord l'OUT puis le site, valide leur existence et le `siteId` porté par l'OUT, puis programme dans la même transaction la suppression et l'écriture de `max(0, outCount - 1)`. Une contention provoque le rejeu transactionnel natif de Firestore à partir de la dernière valeur du compteur. Une erreur empêche l'application de toutes les écritures de la transaction.

Après validation, `state.itemsBySite` et le `outCount` du site local sont mis à jour, le cache local est persisté et `emitAll()` recalcule les affichages abonnés. La stratégie de lecture, son cache et le secours hors ligne n'ont pas été modifiés.

## Tests réalisés

La suite Node couvre notamment les scénarios obligatoires :

1. création avec passage de 10 à 11 ;
2. suppression avec passage de 11 à 10 ;
3. échec de validation à la création sans document ni changement de compteur ;
4. échec de validation à la suppression avec document conservé et compteur inchangé ;
5. deux créations concurrentes sur un site, aboutissant à deux documents et au compteur 12 ;
6. compteur absent traité comme zéro et protection contre les valeurs négatives ;
7. mutation de l'état local uniquement après le succès de la transaction de suppression.

Commande exécutée : `node --test tests/*.test.mjs` — 47 tests réussis.

## Risques restants

- Les entrées de corbeille sont toujours créées avant la suppression, conformément au fonctionnement existant demandé. Une transaction de suppression refusée après cette étape peut donc laisser une entrée de corbeille anticipée, comme auparavant.
- L'historique, la remise à zéro des marqueurs d'inactivité et le quota de suppression restent hors de la transaction OUT/compteur afin de ne pas modifier leurs logiques existantes.
- Les compteurs historiques potentiellement erronés ne sont ni recalculés ni corrigés automatiquement. La nouvelle règle s'applique uniquement aux créations et suppressions effectuées après ce changement.
