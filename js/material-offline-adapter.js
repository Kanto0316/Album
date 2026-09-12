// Legacy compatibility facade. Material mutations must use StorageService/Firestore directly.
(function createMaterialOfflineAdapter(window) {
  'use strict';

  const MESSAGE = 'Connexion Internet obligatoire pour enregistrer cette modification.';

  async function init() { return window.MaterialOfflineAdapter; }
  async function syncAction(action) { return { ok: false, actionId: action?.id, error: MESSAGE }; }
  async function syncActions(actions) {
    const total = Array.isArray(actions) ? actions.length : 0;
    return { total, success: 0, failed: total, errors: [] };
  }

  window.MaterialOfflineAdapter = Object.freeze({ init, syncAction, syncActions });
}(window));
