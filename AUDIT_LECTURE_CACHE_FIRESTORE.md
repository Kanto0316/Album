# Audit de la stratégie de lecture cache / Firestore

## Objectif et périmètre

Audit réalisé sur les lectures du catalogue, des sites, des OUT, des détails, des
utilisateurs, de l'historique et des achats. Les écritures Firestore et la logique
métier n'ont pas été modifiées.

## Constat initial

| Zone | Risque constaté |
| --- | --- |
| Initialisation / sites | Un cache local récent était appliqué immédiatement et empêchait la lecture distante pendant 3 minutes. |
| `subscribeItems()` / `subscribeDetails()` | Le contenu mémoire, souvent issu du cache, était envoyé avant la requête Firestore. |
| `getMaterialCodes()` | Une liste déjà en mémoire empêchait toute nouvelle lecture Firestore. |
| Catalogue | La lecture générique `getDocs()` pouvait être satisfaite par le cache persistant du SDK. |
| Utilisateurs / historique | Les lectures initiales n'imposaient pas explicitement la source serveur. |
| Achats et détail achat | `getDocs()` / `getDoc()` n'imposaient pas explicitement la source serveur et aucun cache applicatif de secours n'était prévu. |

## Stratégie corrigée

1. Toute lecture initiale concernée utilise `getDocsFromServer()` ou
   `getDocFromServer()` et attend sa réponse avant le premier affichage.
2. Une réponse serveur réussie est affichée puis enregistrée dans le cache local.
3. Une erreur serveur déclenche seulement alors la restitution du dernier cache
   disponible et l'événement `firestoreReadModeChanged` avec le mode `offline`.
4. L'interface affiche « Mode hors connexion — données du cache local » pendant
   ce secours.
5. Au retour de l'événement navigateur `online`, les abonnements actifs (sites,
   OUT et détails) ainsi que la liste des achats active relancent une lecture
   serveur. Les abonnements utilisateurs/historique reprennent naturellement leur
   flux Firestore, en ignorant les snapshots signalés `fromCache`.

## Cache par domaine

- Sites, OUT, détails et codes matériel : cache existant
  `suiviMateriel.offlineCache.v1`, désormais lu uniquement après échec serveur.
- Utilisateurs : `suiviMateriel.readCache.v1.users`.
- Historique : `suiviMateriel.readCache.v1.historiques`.
- Catalogue : `suiviMateriel.readCache.v1.catalogue.details`.
- Achats : une clé par site et une clé par détail d'achat.

## Scénarios de validation

### 1. Internet disponible

- Vider ou conserver le cache local.
- Ouvrir chaque page auditée.
- Vérifier dans le panneau Réseau que les lectures atteignent Firestore.
- Vérifier que l'indicateur hors connexion reste masqué et que les données
  correspondent au serveur, même si le cache contenait une ancienne valeur.

### 2. Internet coupé

- Visiter d'abord les pages en ligne afin d'alimenter le cache de secours.
- Couper le réseau puis recharger.
- Vérifier que les dernières données enregistrées sont affichées.
- Vérifier que l'indicateur « Mode hors connexion — données du cache local » est
  visible.

### 3. Retour réseau

- Modifier une donnée depuis un autre client pendant que le premier est hors
  ligne.
- Rétablir le réseau sur le premier client.
- Vérifier que les listes actives se rafraîchissent avec la valeur Firestore et
  que l'indicateur disparaît après une lecture serveur réussie.

## Limites volontaires

L'audit ne change ni les files d'écritures hors connexion, ni les validations,
ni les règles d'autorisation, ni les opérations de création, modification ou
suppression. Les caches d'interface sans rapport avec les données Firestore
(préférences de recherche, onglet actif et panier matériel) restent inchangés.
