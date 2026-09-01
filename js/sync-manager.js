// Couche de coordination entre la file IndexedDB et l’adaptateur Firestore.
(function createSyncManager(window) {
  'use strict';

  let currentStatus = 'idle';
  let synchronizing = false;
  let started = false;
  let initialized = false;
  let synchronizationPromise = null;

  function setStatus(status) {
    currentStatus = status;
    window.dispatchEvent(
      new CustomEvent('syncStatusChanged', {
        detail: { status },
      }),
    );
  }

  function requireDependencies() {
    if (!window.OfflineSync || !window.OfflineAdapter) {
      throw new Error('OfflineSync et OfflineAdapter doivent être chargés avant SyncManager.');
    }
  }

  async function init({ firebaseDb } = {}) {
    try {
      requireDependencies();
      await window.OfflineSync.init();
      window.OfflineAdapter.init(firebaseDb);
      initialized = true;
      setStatus(window.OfflineSync.isOnline() ? 'idle' : 'offline');
      start();
      console.info('[SyncManager] Gestionnaire initialisé');
      return window.SyncManager;
    } catch (error) {
      initialized = false;
      setStatus('error');
      console.error('[SyncManager] Échec de l’initialisation :', error);
      throw error;
    }
  }

  function handleConnectionStatus(event) {
    const online = event?.detail?.online === true;

    if (!online) {
      setStatus('offline');
      console.info('[SyncManager] Connexion hors ligne');
      return;
    }

    console.info('[SyncManager] Connexion rétablie');
    sync();
  }

  function start() {
    if (!started) {
      window.addEventListener('offlineStatusChanged', handleConnectionStatus);
      started = true;
      console.info('[SyncManager] Écoute réseau démarrée');
    }

    return window.SyncManager;
  }

  function stop() {
    if (started) {
      window.removeEventListener('offlineStatusChanged', handleConnectionStatus);
      started = false;
      console.info('[SyncManager] Écoute réseau arrêtée');
    }

    return window.SyncManager;
  }

  function failedActionIds(report) {
    return new Set(
      Array.isArray(report?.errors)
        ? report.errors.map((failure) => failure?.actionId)
        : [],
    );
  }

  async function runSynchronization() {
    try {
      requireDependencies();

      if (!initialized) {
        throw new Error('SyncManager doit être initialisé avant la synchronisation.');
      }

      if (!window.OfflineSync.isOnline()) {
        setStatus('offline');
        console.info('[SyncManager] Synchronisation ignorée : connexion hors ligne');
        return { status: 'offline' };
      }

      const actions = await window.OfflineSync.getPendingActions();
      console.info(`[SyncManager] ${actions.length} actions trouvées`);

      if (actions.length === 0) {
        setStatus('completed');
        return { status: 'nothing_to_sync' };
      }

      setStatus('syncing');
      console.info('[SyncManager] Synchronisation démarrée');

      const adapterReport = await window.OfflineAdapter.syncActions(actions);
      const failedIds = failedActionIds(adapterReport);
      const successfulActions = actions.filter((action) => !failedIds.has(action.id));

      // Une action ne quitte la file qu’après confirmation de sa réussite par l’adaptateur.
      await Promise.all(
        successfulActions.map((action) => window.OfflineSync.removePendingAction(action.id)),
      );

      const report = {
        status: adapterReport.failed > 0 ? 'error' : 'completed',
        total: adapterReport.total,
        success: adapterReport.success,
        failed: adapterReport.failed,
      };

      setStatus(report.status);
      console.info('[SyncManager] Synchronisation terminée');
      return report;
    } catch (error) {
      setStatus('error');
      console.error('[SyncManager] Erreur de synchronisation :', error);
      return { status: 'error', total: 0, success: 0, failed: 0 };
    } finally {
      synchronizing = false;
      synchronizationPromise = null;
    }
  }

  function sync() {
    if (synchronizing) {
      console.info('[SyncManager] Synchronisation déjà en cours');
      return synchronizationPromise;
    }

    synchronizing = true;
    synchronizationPromise = runSynchronization();
    return synchronizationPromise;
  }

  function getStatus() {
    return currentStatus;
  }

  function isSynchronizing() {
    return synchronizing;
  }

  window.SyncManager = Object.freeze({
    init,
    start,
    stop,
    sync,
    getStatus,
    isSynchronizing,
  });
}(window));
