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

// Le mode cache est silencieux : consulter des données hors connexion n'est
// pas une erreur et ne doit donc plus déclencher de message utilisateur.
