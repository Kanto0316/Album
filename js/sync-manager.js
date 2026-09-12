// Gestion de l'état réseau uniquement. La synchronisation différée a été désactivée :
// une reconnexion ne doit jamais rejouer d'anciennes écritures locales.
(function createSyncManager(window) {
  'use strict';

  let currentStatus = 'idle';
  let started = false;

  function setStatus(status) {
    currentStatus = status;
    window.dispatchEvent(new CustomEvent('syncStatusChanged', { detail: { status } }));
  }

  function handleConnectionStatus(event) {
    setStatus(event?.detail?.online === false ? 'offline' : 'idle');
  }

  async function init({ firebaseDb } = {}) {
    if (!firebaseDb) throw new TypeError('Une instance Firestore est requise.');
    window.OfflineAdapter?.init?.(firebaseDb);
    start();
    setStatus(window.navigator.onLine ? 'idle' : 'offline');
    return window.SyncManager;
  }

  function start() {
    if (!started) {
      window.addEventListener('offlineStatusChanged', handleConnectionStatus);
      started = true;
    }
    return window.SyncManager;
  }

  function stop() {
    if (started) window.removeEventListener('offlineStatusChanged', handleConnectionStatus);
    started = false;
    return window.SyncManager;
  }

  async function sync() {
    // Compatibilité API : aucune file n'est lue et aucune action n'est rejouée.
    return { status: 'disabled', total: 0, success: 0, failed: 0 };
  }

  window.SyncManager = Object.freeze({
    init,
    start,
    stop,
    sync,
    getStatus: () => currentStatus,
    isSynchronizing: () => false,
  });
}(window));
