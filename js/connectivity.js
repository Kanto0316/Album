/**
 * État réseau unique de l'application.
 *
 * `navigator.onLine` ne garantit pas que Firestore répondra, mais son état
 * `false` est une indication fiable qu'aucune écriture ne doit être tentée.
 */
export const OFFLINE_WRITE_BLOCKED = 'OFFLINE_WRITE_BLOCKED';

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function publishConnectivity() {
  const online = isOnline();
  window.isOnline = online;
  window.dispatchEvent(new CustomEvent('app:connectivity-changed', { detail: { isOnline: online } }));
}

if (typeof window !== 'undefined') {
  window.isOnline = isOnline();
  window.addEventListener('online', publishConnectivity);
  window.addEventListener('offline', publishConnectivity);
}

