// Network status only. Offline mutation queues and deferred replay are disabled.
const LEGACY_DATABASE_NAME = 'suiviMaterielOffline';
const INTERNET_REQUIRED_MESSAGE = 'Connexion Internet obligatoire pour enregistrer cette modification.';

function deleteLegacyQueue() {
  if (!('indexedDB' in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const request = window.indexedDB.deleteDatabase(LEGACY_DATABASE_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function init() {
  // Old queued mutations are discarded, never replayed after an upgrade.
  await deleteLegacyQueue();
  return window.OfflineSync;
}

async function addPendingAction() {
  throw new Error(INTERNET_REQUIRED_MESSAGE);
}

async function getPendingActions() { return []; }
async function getPendingCount() { return 0; }
async function removePendingAction() { return false; }
async function clearPendingActions() { await deleteLegacyQueue(); return true; }
async function syncPendingActions() { return { ready: false, reason: 'disabled', actions: [] }; }
function isOnline() { return window.navigator.onLine; }

function dispatchConnectionStatus() {
  window.dispatchEvent(new CustomEvent('offlineStatusChanged', {
    detail: { online: isOnline() },
  }));
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
