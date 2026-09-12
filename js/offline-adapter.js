// Legacy compatibility facade. Offline writes and action replay are disabled.
const INTERNET_REQUIRED_MESSAGE = 'Connexion Internet obligatoire pour enregistrer cette modification.';

function init() {
  return window.OfflineAdapter;
}

async function processAction(action) {
  return { ok: false, actionId: action?.id, error: INTERNET_REQUIRED_MESSAGE };
}

async function syncActions(actions) {
  const total = Array.isArray(actions) ? actions.length : 0;
  return { total, success: 0, failed: total, errors: [] };
}

function getCollectionReference() {
  throw new Error(INTERNET_REQUIRED_MESSAGE);
}

window.OfflineAdapter = Object.freeze({ init, processAction, syncActions, getCollectionReference });
