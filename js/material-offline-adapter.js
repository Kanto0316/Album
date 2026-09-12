// API conservée pour les pages historiques qui chargent encore ce script.
// Aucune mutation métier n'est désormais rejouée depuis un stockage local.
(function createMaterialOfflineAdapter(window) {
  'use strict';

  const INTERNET_REQUIRED_MESSAGE = 'Connexion Internet requise pour enregistrer cette modification.';

  async function init() {
    return window.MaterialOfflineAdapter;
  }

  async function syncAction(action) {
    return { ok: false, actionId: action?.id, error: INTERNET_REQUIRED_MESSAGE };
  }

  async function syncActions(actions) {
    const queuedActions = Array.isArray(actions) ? actions : [];
    return {
      total: queuedActions.length,
      success: 0,
      failed: queuedActions.length,
      errors: queuedActions.map((action) => ({ actionId: action?.id, error: INTERNET_REQUIRED_MESSAGE })),
    };
  }

  window.MaterialOfflineAdapter = Object.freeze({ init, syncAction, syncActions });
}(window));
