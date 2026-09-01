// Couche indépendante de correspondance entre les identifiants locaux et Firestore.
(function createOfflineIdMapper(window) {
  'use strict';

  // Une base dédiée évite de modifier la version de la base utilisée par OfflineSync.
  const DATABASE_NAME = 'suiviMaterielOfflineIdMapper';
  const DATABASE_VERSION = 1;
  const MAPPINGS_STORE = 'idMappings';
  const ENTITY_TYPES = new Set(['site', 'item', 'detail']);

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

        if (!database.objectStoreNames.contains(MAPPINGS_STORE)) {
          const store = database.createObjectStore(MAPPINGS_STORE, { keyPath: 'id' });
          store.createIndex('localId', 'localId', { unique: true });
          store.createIndex('firestoreId', 'firestoreId', { unique: true });
          store.createIndex('entityType', 'entityType', { unique: false });
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

      const database = await databasePromise;
      console.info('[OfflineIdMapper] Stockage initialisé');
      return database;
    } catch (error) {
      databasePromise = null;
      console.error('[OfflineIdMapper] Échec de l’initialisation :', error);
      throw error;
    }
  }

  async function useStore(mode, operation) {
    const database = await init();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(MAPPINGS_STORE, mode);
      const store = transaction.objectStore(MAPPINGS_STORE);
      let request;

      try {
        request = operation(store);
      } catch (error) {
        reject(error);
        return;
      }

      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(
        transaction.error || request?.error || new Error('Transaction IndexedDB échouée.'),
      );
      transaction.onabort = () => reject(
        transaction.error || request?.error || new Error('Transaction IndexedDB annulée.'),
      );
    });
  }

  function normalizeId(value, name) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id) {
      throw new TypeError(`${name} est requis.`);
    }
    return id;
  }

  async function saveMapping({ localId, firestoreId, entityType } = {}) {
    try {
      const normalizedLocalId = normalizeId(localId, 'localId');
      const normalizedFirestoreId = normalizeId(firestoreId, 'firestoreId');

      if (!ENTITY_TYPES.has(entityType)) {
        throw new TypeError('entityType doit être "site", "item" ou "detail".');
      }

      const mapping = {
        id: normalizedLocalId,
        localId: normalizedLocalId,
        firestoreId: normalizedFirestoreId,
        entityType,
        createdAt: new Date().toISOString(),
      };

      await useStore('readwrite', (store) => store.put(mapping));
      console.info('[OfflineIdMapper] Mapping enregistré', mapping);
      return mapping;
    } catch (error) {
      console.error('[OfflineIdMapper] Impossible d’enregistrer le mapping :', error);
      throw error;
    }
  }

  async function getFirestoreId(localId) {
    try {
      const normalizedLocalId = normalizeId(localId, 'localId');
      const mapping = await useStore('readonly', (store) => store.get(normalizedLocalId));

      if (mapping) {
        console.info('[OfflineIdMapper] Mapping trouvé', mapping);
      }

      return mapping?.firestoreId || null;
    } catch (error) {
      console.error('[OfflineIdMapper] Impossible de rechercher le mapping local :', error);
      throw error;
    }
  }

  async function getLocalId(firestoreId) {
    try {
      const normalizedFirestoreId = normalizeId(firestoreId, 'firestoreId');
      const mapping = await useStore('readonly', (store) =>
        store.index('firestoreId').get(normalizedFirestoreId));

      if (mapping) {
        console.info('[OfflineIdMapper] Mapping trouvé', mapping);
      }

      return mapping?.localId || null;
    } catch (error) {
      console.error('[OfflineIdMapper] Impossible de rechercher le mapping Firestore :', error);
      throw error;
    }
  }

  async function removeMapping(localId) {
    try {
      const normalizedLocalId = normalizeId(localId, 'localId');
      await useStore('readwrite', (store) => store.delete(normalizedLocalId));
      console.info('[OfflineIdMapper] Mapping supprimé', normalizedLocalId);
      return true;
    } catch (error) {
      console.error('[OfflineIdMapper] Impossible de supprimer le mapping :', error);
      throw error;
    }
  }

  async function getMappings() {
    try {
      return (await useStore('readonly', (store) => store.getAll())) || [];
    } catch (error) {
      console.error('[OfflineIdMapper] Impossible de lire les mappings :', error);
      throw error;
    }
  }

  async function clearMappings() {
    try {
      await useStore('readwrite', (store) => store.clear());
      console.info('[OfflineIdMapper] Mappings supprimés');
      return true;
    } catch (error) {
      console.error('[OfflineIdMapper] Impossible de vider les mappings :', error);
      throw error;
    }
  }

  window.OfflineIdMapper = Object.freeze({
    init,
    saveMapping,
    getFirestoreId,
    getLocalId,
    removeMapping,
    getMappings,
    clearMappings,
  });
}(window));
