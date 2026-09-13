# Audit — blocage des écritures hors connexion

## Objectif et périmètre

L'application conserve sa stratégie de lecture existante (Firestore serveur en
priorité, puis cache local en secours), mais n'accepte plus la création, la
modification ou la suppression des sites, OUT et articles quand le navigateur
signale une absence de réseau.

## Implémentation

### État réseau global

`js/connectivity.js` initialise `window.isOnline` avec `navigator.onLine`, puis
le recalcule sur les événements `online` et `offline`. Chaque changement émet
`app:connectivity-changed`, consommé par l'interface.

### Interface

Les FAB suivants restent affichés mais reçoivent automatiquement `disabled` et
`aria-disabled="true"` hors connexion :

- Page 1 : `openCreateSite` ;
- Page 2 : `openCreateItem` ;
- Page 3 : `openDetailFormButton`.

Le style désactivé réduit l'opacité, supprime l'animation et affiche un curseur
interdit. Une tentative d'action affiche uniquement : **« Vérifiez votre
connexion internet »**. Le passage à nouveau en ligne réactive les boutons sans
rechargement.

La consultation du cache offline reste silencieuse : l'ancien message « Mode
hors connexion — données du cache local » a été retiré.

### Service

`StorageService` appelle la barrière `blockOfflineWrite()` avant les créations,
modifications, retours et suppressions principales. En mode hors connexion, le
service retourne l'erreur contrôlée :

```js
{ ok: false, reason: 'OFFLINE_WRITE_BLOCKED', error: 'OFFLINE_WRITE_BLOCKED' }
```

La branche qui créait un article local et ajoutait une action à la file de
synchronisation a été supprimée. Aucune mutation du cache ni demande Firestore
n'est donc réalisée après ce blocage.

## Scénarios vérifiés

1. **Internet disponible** : les FAB sont actifs et les créations suivent le
   chemin Firestore habituel.
2. **Internet coupé** : les FAB deviennent désactivés ; une tentative affiche
   « Vérifiez votre connexion internet » ; `StorageService` retourne
   `OFFLINE_WRITE_BLOCKED` avant toute écriture.
3. **Internet réactivé** : l'événement `online` met à jour l'état global et les
   FAB redeviennent actifs automatiquement.

## Non-régression lecture

Les abonnements, les lectures serveur prioritaires, la restauration depuis le
cache et le rafraîchissement au retour du réseau ne sont pas modifiés.
