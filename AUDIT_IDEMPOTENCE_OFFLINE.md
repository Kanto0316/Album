# Audit de l’idempotence des créations offline

## Périmètre

Cette correction reste limitée au chemin de création existant :
`OfflineActionBuilder` → `OfflineSync` → `SyncManager` →
`MaterialOfflineAdapter` → `OfflineAdapter` → Firestore.

## Fichiers modifiés

- `js/offline-adapter.js` : écriture déterministe des créations avec `setDoc`.
- `js/material-offline-adapter.js` : transmission du `localId` à l’adaptateur Firestore.
- `tests/offline-architecture.test.mjs` : couverture de la création, du rejeu et
  d’une relance après un échec de mapping.
- `AUDIT_IDEMPOTENCE_OFFLINE.md` : présent rapport.

## Ancien flux

Une création offline arrivait dans `OfflineAdapter` sans identifiant de document.
L’appel à `addDoc` demandait alors à Firestore de générer un nouvel identifiant.
Si l’écriture réussissait mais qu’une étape ultérieure, telle que la sauvegarde du
mapping, échouait, le rejeu de l’action appelait de nouveau `addDoc` et pouvait
créer un second document.

## Nouveau flux

`MaterialOfflineAdapter` transmet désormais le `localId` de l’action de création.
`OfflineAdapter` le valide, l’utilise comme identifiant Firestore et exécute
`setDoc(doc(collectionReference, localId), payload)`. Le résultat conserve le
contrat `{ ok: true, actionId, firestoreId }`, avec `firestoreId` égal au
`localId` utilisé.

Ainsi, `detail_local_xxx` est écrit dans
`pages/page3/items/detail_local_xxx`, et son mapping est
`detail_local_xxx` → `detail_local_xxx`.

## Risques corrigés

- Le rejeu d’une même création cible le même chemin Firestore.
- Une erreur survenant après l’écriture Firestore ne provoque plus la génération
  d’un nouvel identifiant lors de la relance.
- Le mapping local/Firestore reçoit toujours l’identifiant attendu par
  `MaterialOfflineAdapter`.

## Tests effectués

Les tests automatisés couvrent :

1. une création offline normale et son chemin Firestore déterministe ;
2. deux exécutions de la même action avec un seul document final ;
3. un premier `setDoc` réussi suivi d’un échec de mapping, puis une relance sans
   doublon ;
4. les comportements existants de résolution des identifiants parents.

Commande : `node --test tests/offline-architecture.test.mjs`.

## Risques restants

- `setDoc` remplace les champs du document ciblé lors d’un rejeu : cette
  correction garantit l’unicité, pas une fusion avec d’éventuelles modifications
  concurrentes.
- Les règles de sécurité Firestore doivent autoriser un identifiant fourni par le
  client.
- L’ordre, les priorités, les mises à jour, les suppressions, `articleCount`,
  l’historique et `materialCodes` n’ont pas été modifiés ni réévalués.

Cette phase corrige uniquement l’idempotence des créations offline. Elle ne
constitue pas une déclaration d’aptitude à la production.
