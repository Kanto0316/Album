// Construit les actions métier sans les enregistrer ni les synchroniser.
(function createOfflineActionBuilder(window) {
  'use strict';

  const LOG_PREFIX = '[OfflineActionBuilder]';

  function requirePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('payload est obligatoire et doit être un objet.');
    }

    return payload;
  }

  function requireText(value, name) {
    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    if (!normalizedValue) {
      throw new TypeError(`${name} est obligatoire.`);
    }

    return normalizedValue;
  }

  function createLocalId(entityType) {
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).slice(2, 7).padEnd(5, '0');
    return `${entityType}_local_${timestamp}_${randomPart}`;
  }

  function normalizeLocalId(localId, entityType) {
    if (typeof localId === 'string' && localId.trim()) {
      return localId.trim();
    }

    return createLocalId(entityType);
  }

  function createDetailAction(options = {}) {
    try {
      const payload = requirePayload(options.payload);
      const siteId = requireText(options.siteId, 'siteId');
      const itemId = requireText(options.itemId, 'itemId');
      const designation = requireText(payload.designation, 'designation');
      const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
      const timestamp = new Date().toISOString();

      // Cette liste reflète volontairement les champs créés par createDetail().
      const detailPayload = {
        siteId,
        itemId,
        champ: payload.champ,
        code: payload.code,
        designation,
        qteSortie: payload.qteSortie,
        unite: payload.unite,
        qteHorsBtrs: payload.qteHorsBtrs ?? '',
        qteRetour: payload.qteRetour ?? 0,
        dateRetour: payload.dateRetour ?? '',
        returns: Array.isArray(payload.returns) ? payload.returns : [],
        qtePosee: payload.qtePosee ?? 0,
        qteRebus: payload.qteRebus ?? 0,
        observation: payload.observation ?? '',
        statut: payload.statut,
        ownerId: userId || payload.ownerId,
        createdBy: userId || payload.createdBy,
        dateCreation: payload.dateCreation || timestamp,
        dateModification: payload.dateModification || timestamp,
      };

      const action = {
        type: 'createDetail',
        localId: normalizeLocalId(options.localId, 'detail'),
        collection: 'page3',
        action: 'add',
        payload: detailPayload,
        articleCountDelta: 1,
        createdAt: timestamp,
        status: 'pending',
      };

      console.info(`${LOG_PREFIX} Action détail créée`, action);
      return action;
    } catch (error) {
      console.error(`${LOG_PREFIX} Impossible de créer l’action détail :`, error);
      throw error;
    }
  }

  function createEntityAction(type, entityType, options) {
    const normalizedOptions = options || {};
    const payload = requirePayload(normalizedOptions.payload);
    return {
      type,
      localId: normalizeLocalId(normalizedOptions.localId, entityType),
      payload: { ...payload },
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
  }

  function createSiteAction(options = {}) {
    try {
      const action = createEntityAction('createSite', 'site', options);
      console.info(`${LOG_PREFIX} Action site créée`, action);
      return action;
    } catch (error) {
      console.error(`${LOG_PREFIX} Impossible de créer l’action site :`, error);
      throw error;
    }
  }

  function createItemAction(options = {}) {
    try {
      const action = createEntityAction('createItem', 'item', options);
      console.info(`${LOG_PREFIX} Action OUT créée`, action);
      return action;
    } catch (error) {
      console.error(`${LOG_PREFIX} Impossible de créer l’action OUT :`, error);
      throw error;
    }
  }

  window.OfflineActionBuilder = Object.freeze({
    createDetailAction,
    createSiteAction,
    createItemAction,
  });
}(window));
