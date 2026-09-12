const READ_CACHE_PREFIX = 'suiviMateriel.readCache.v1.';

export function readLocalFallback(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(`${READ_CACHE_PREFIX}${key}`);
    return value === null ? fallback : JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

export function updateLocalFallback(key, value) {
  try {
    window.localStorage.setItem(`${READ_CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch (_error) {
    // Un cache refusé par le navigateur ne doit jamais faire échouer la lecture serveur.
  }
}

export function reportReadMode(mode) {
  window.dispatchEvent(new CustomEvent('firestoreReadModeChanged', { detail: { mode } }));
}

function installOfflineIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'offlineReadIndicator';
  indicator.className = 'offline-read-indicator';
  indicator.textContent = 'Mode hors connexion — données du cache local';
  indicator.hidden = true;
  indicator.setAttribute('role', 'status');
  document.body.appendChild(indicator);

  window.addEventListener('firestoreReadModeChanged', (event) => {
    indicator.hidden = event?.detail?.mode !== 'offline';
  });
  window.addEventListener('offline', () => reportReadMode('offline'));
  if (!window.navigator.onLine) indicator.hidden = false;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installOfflineIndicator, { once: true });
} else {
  installOfflineIndicator();
}
