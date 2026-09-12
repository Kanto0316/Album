// Compatibilité de chargement uniquement. Les écritures offline sont interdites :
// StorageService écrit directement dans Firestore et ne confie plus d'action à cet adaptateur.
const INTERNET_REQUIRED_MESSAGE = 'Connexion Internet requise pour enregistrer cette modification.';

function init(firebaseDb) {
  if (!firebaseDb) {
    throw new TypeError('Une instance Firestore est requise.');
  }
  return window.OfflineAdapter;
}

async function rejectOfflineWrite(action) {
  console.warn('[OfflineAdapter] Écriture offline refusée.', action?.id);
  return {
    ok: false,
    actionId: action?.id,
    error: INTERNET_REQUIRED_MESSAGE,
  };
}

window.OfflineAdapter = Object.freeze({
  init,
  processAction: rejectOfflineWrite,
  syncActions: async (actions) => ({
    total: Array.isArray(actions) ? actions.length : 0,
    success: 0,
    failed: Array.isArray(actions) ? actions.length : 0,
    errors: (Array.isArray(actions) ? actions : []).map((action) => ({
      actionId: action?.id,
      error: INTERNET_REQUIRED_MESSAGE,
    })),
  }),
});
