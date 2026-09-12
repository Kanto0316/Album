// Fondation indépendante pour la future synchronisation hors connexion.
const DATABASE_NAME = 'suiviMaterielOffline';
const DATABASE_VERSION = 1;
const PENDING_ACTIONS_STORE = 'pendingActions';
const METADATA_STORE = 'metadata';

let databasePromise = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB n’est pas disponible dans ce navigateur.'));
      return;
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PENDING_ACTIONS_STORE)) {
        const store = database.createObjectStore(PENDING_ACTIONS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('Impossible d’ouvrir IndexedDB.'));
    request.onblocked = () => reject(new Error('La mise à jour IndexedDB est bloquée.'));
  });
}

async function init() {
  try {
    if (!databasePromise) {
      databasePromise = openDatabase();
    }
    return await databasePromise;
  } catch (error) {
    databasePromise = null;
    console.error('[OfflineSync] Échec de l’initialisation :', error);
    throw error;
  }
}

async function useStore(mode, operation) {
  const database = await init();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PENDING_ACTIONS_STORE, mode);
    const store = transaction.objectStore(PENDING_ACTIONS_STORE);
    let result;

    try {
      result = operation(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error || new Error('Transaction IndexedDB échouée.'));
    transaction.onabort = () => reject(transaction.error || new Error('Transaction IndexedDB annulée.'));
  });
}

async function addPendingAction(action) {
  try {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new TypeError('Une action valide est requise.');
    }

    const pendingAction = {
      ...action,
      createdAt: action.createdAt || new Date().toISOString(),
      status: action.status || 'pending',
    };
    delete pendingAction.id;

    return await useStore('readwrite', (store) => store.add(pendingAction));
  } catch (error) {
    console.error('[OfflineSync] Impossible d’ajouter l’action :', error);
    throw error;
  }
}

async function getPendingActions() {
  try {
    const actions = await useStore('readonly', (store) => store.getAll());
    return (actions || []).sort((first, second) =>
      String(first.createdAt).localeCompare(String(second.createdAt)),
    );
  } catch (error) {
    console.error('[OfflineSync] Impossible de lire les actions :', error);
    throw error;
  }
}

async function removePendingAction(id) {
  try {
    await useStore('readwrite', (store) => store.delete(id));
    return true;
  } catch (error) {
    console.error('[OfflineSync] Impossible de supprimer l’action :', error);
    throw error;
  }
}

async function clearPendingActions() {
  try {
    await useStore('readwrite', (store) => store.clear());
    return true;
  } catch (error) {
    console.error('[OfflineSync] Impossible de vider la file :', error);
    throw error;
  }
}

async function getPendingCount() {
  try {
    return await useStore('readonly', (store) => store.count());
  } catch (error) {
    console.error('[OfflineSync] Impossible de compter les actions :', error);
    throw error;
  }
}

function isOnline() {
  return window.navigator.onLine;
}

async function syncPendingActions() {
  try {
    if (!isOnline()) {
      return { ready: false, reason: 'offline', actions: [] };
    }

    const actions = await getPendingActions();

    // Hook temporaire : le futur adaptateur Firebase traitera les actions puis
    // appellera removePendingAction uniquement après confirmation de Firestore.
    window.dispatchEvent(
      new CustomEvent('offlineSyncRequested', {
        detail: { actions },
      }),
    );

    return { ready: true, reason: 'firebase-adapter-required', actions };
  } catch (error) {
    console.error('[OfflineSync] Préparation de la synchronisation impossible :', error);
    throw error;
  }
}

function dispatchConnectionStatus() {
  try {
    window.dispatchEvent(
      new CustomEvent('offlineStatusChanged', {
        detail: { online: isOnline() },
      }),
    );
  } catch (error) {
    console.error('[OfflineSync] Impossible de signaler l’état réseau :', error);
  }
}

window.addEventListener('online', dispatchConnectionStatus);
window.addEventListener('offline', dispatchConnectionStatus);

window.OfflineSync = Object.freeze({
  init,
  addPendingAction,
  getPendingActions,
  removePendingAction,
  clearPendingActions,
  getPendingCount,
  syncPendingActions,
  isOnline,
});
