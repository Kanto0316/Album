import {
  addDoc,
  arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// Couche métier entre les actions hors connexion et l'adaptateur Firestore générique.
(function createMaterialOfflineAdapter(window) {
  'use strict';

  const COLLECTIONS = Object.freeze({
    site: 'page1',
    item: 'page2',
    detail: 'page3',
  });

  const ACTION_PRIORITIES = Object.freeze({
    createSite: 0,
    createItem: 1,
    createDetail: 2,
    updateDetail: 3,
    addReturn: 3,
    deleteDetail: 4,
  });

  let initialized = false;

  function getErrorMessage(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error || 'Erreur de synchronisation inconnue.');
  }

  function requireDependencies() {
    if (!window.OfflineAdapter || !window.OfflineIdMapper) {
      throw new Error('OfflineAdapter et OfflineIdMapper doivent être chargés avant MaterialOfflineAdapter.');
    }
  }

  function requireObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${name} doit être un objet.`);
    }

    return value;
  }

  function requireId(value, name) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id) {
      throw new TypeError(`${name} est requis.`);
    }

    return id;
  }

  async function init() {
    try {
      requireDependencies();
      await window.OfflineIdMapper.init();
      initialized = true;
      console.info('[MaterialOfflineAdapter] Adaptateur métier initialisé');
      return window.MaterialOfflineAdapter;
    } catch (error) {
      initialized = false;
      console.error('[MaterialOfflineAdapter] Échec de l’initialisation :', error);
      throw error;
    }
  }

  async function ensureInitialized() {
    if (!initialized) {
      await init();
    }
  }

  async function resolveFirestoreId(localId, fieldName) {
    const normalizedLocalId = requireId(localId, fieldName);
    const firestoreId = await window.OfflineIdMapper.getFirestoreId(normalizedLocalId);

    if (!firestoreId) {
      throw new Error(`Aucun identifiant Firestore trouvé pour ${fieldName} "${normalizedLocalId}".`);
    }

    return firestoreId;
  }

  async function createEntity(action, entityType, successLabel, transformPayload) {
    const localId = requireId(action.localId, 'localId');
    const sourcePayload = requireObject(action.payload, 'payload');
    const payload = transformPayload ? await transformPayload({ ...sourcePayload }) : { ...sourcePayload };
    const collectionReference = window.OfflineAdapter.getCollectionReference(COLLECTIONS[entityType]);

    // addDoc est utilisé ici car OfflineAdapter.processAction ne restitue pas encore
    // l'identifiant généré, indispensable à la résolution des relations métier.
    const documentReference = await addDoc(collectionReference, payload);
    const firestoreId = requireId(documentReference?.id, 'firestoreId');

    await window.OfflineIdMapper.saveMapping({ localId, firestoreId, entityType });
    console.info(`[MaterialOfflineAdapter] ${successLabel} synchronisé`, firestoreId);
    return { ok: true, localId, firestoreId };
  }

  async function createSite(action) {
    return createEntity(action, 'site', 'Site');
  }

  async function createItem(action) {
    return createEntity(action, 'item', 'OUT', async (payload) => ({
      ...payload,
      siteId: await resolveFirestoreId(payload.siteId, 'siteId'),
    }));
  }

  async function createDetail(action) {
    return createEntity(action, 'detail', 'Article', async (payload) => ({
      ...payload,
      siteId: await resolveFirestoreId(payload.siteId, 'siteId'),
      itemId: await resolveFirestoreId(payload.itemId, 'itemId'),
    }));
  }

  function getDetailLocalId(action) {
    return requireId(
      action.localId || action.detailId || action.payload?.detailId,
      'localId du détail',
    );
  }

  async function processDetailMutation(action, operation) {
    const localId = getDetailLocalId(action);
    const firestoreId = await resolveFirestoreId(localId, 'detailId');
    const adapterAction = {
      id: action.id,
      action: operation,
      collection: COLLECTIONS.detail,
      documentId: firestoreId,
    };

    if (operation === 'update') {
      const payload = { ...requireObject(action.payload, 'payload') };
      delete payload.detailId;
      adapterAction.payload = payload;
    }

    const result = await window.OfflineAdapter.processAction(adapterAction);
    if (!result?.ok) {
      throw new Error(result?.error || 'La mutation du détail a échoué.');
    }

    return { ok: true, localId, firestoreId };
  }

  async function updateDetail(action) {
    const result = await processDetailMutation(action, 'update');
    console.info('[MaterialOfflineAdapter] Article modifié', result.firestoreId);
    return result;
  }

  async function deleteDetail(action) {
    const result = await processDetailMutation(action, 'delete');
    console.info('[MaterialOfflineAdapter] Article supprimé', result.firestoreId);
    return result;
  }

  async function addReturn(action) {
    const localId = getDetailLocalId(action);
    const firestoreId = await resolveFirestoreId(localId, 'detailId');
    const payload = { ...requireObject(action.payload, 'payload') };
    delete payload.detailId;

    // Chaque retour est ajouté au tableau au lieu de remplacer les précédents.
    const returnEntry = payload.return && typeof payload.return === 'object'
      ? { ...payload.return }
      : payload;
    const result = await window.OfflineAdapter.processAction({
      id: action.id,
      action: 'update',
      collection: COLLECTIONS.detail,
      documentId: firestoreId,
      payload: { returns: arrayUnion(returnEntry) },
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'L’ajout du retour a échoué.');
    }

    console.info('[MaterialOfflineAdapter] Retour matériel synchronisé', firestoreId);
    return { ok: true, localId, firestoreId };
  }

  async function syncAction(action) {
    try {
      await ensureInitialized();
      requireObject(action, 'action');

      switch (action.type) {
        case 'createSite':
          return await createSite(action);
        case 'createItem':
          return await createItem(action);
        case 'createDetail':
          return await createDetail(action);
        case 'updateDetail':
          return await updateDetail(action);
        case 'deleteDetail':
          return await deleteDetail(action);
        case 'addReturn':
          return await addReturn(action);
        default:
          throw new Error(`Action métier non prise en charge : ${String(action.type || '')}`);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('[MaterialOfflineAdapter] Erreur de synchronisation :', error);
      return { ok: false, error: message };
    }
  }

  function orderActions(actions) {
    return actions
      .map((action, index) => ({ action, index }))
      .sort((first, second) => {
        const priorityDifference = (ACTION_PRIORITIES[first.action?.type] ?? 99)
          - (ACTION_PRIORITIES[second.action?.type] ?? 99);
        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        const dateDifference = String(first.action?.createdAt || '')
          .localeCompare(String(second.action?.createdAt || ''));
        return dateDifference || first.index - second.index;
      })
      .map(({ action }) => action);
  }

  async function syncActions(actions) {
    const orderedActions = Array.isArray(actions) ? orderActions(actions) : [];
    const report = {
      total: orderedActions.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    // Le traitement séquentiel garantit que les mappings parents existent.
    for (const action of orderedActions) {
      const result = await syncAction(action);
      if (result.ok) {
        report.success += 1;
      } else {
        report.failed += 1;
        report.errors.push({
          actionId: action?.id,
          type: action?.type,
          localId: action?.localId,
          error: result.error,
        });
      }
    }

    return report;
  }

  window.MaterialOfflineAdapter = Object.freeze({
    init,
    syncAction,
    syncActions,
  });
}(window));
