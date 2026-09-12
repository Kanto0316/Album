// Tracks connectivity only. Deferred synchronization and automatic replay are disabled.
(function createSyncManager(window) {
  'use strict';

  let currentStatus = 'idle';
  let started = false;

  function setStatus(status) {
    currentStatus = status;
    window.dispatchEvent(new CustomEvent('syncStatusChanged', { detail: { status } }));
  }

  function handleConnectionStatus(event) {
    setStatus(event?.detail?.online === true ? 'idle' : 'offline');
  }

  function start() {
    if (!started) {
      window.addEventListener('offlineStatusChanged', handleConnectionStatus);
      started = true;
    }
    return window.SyncManager;
  }

  function stop() {
    if (started) {
      window.removeEventListener('offlineStatusChanged', handleConnectionStatus);
      started = false;
    }
    return window.SyncManager;
  }

  async function init() {
    await window.OfflineSync?.init?.();
    setStatus(window.OfflineSync?.isOnline?.() === false ? 'offline' : 'idle');
    start();
    return window.SyncManager;
  }

  async function sync() {
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
