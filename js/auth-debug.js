(function installAuthDebug() {
  const statusLabels = Object.freeze({
    INITIALIZATION: 'Initialisation',
    START_GOOGLE_SIGNIN: 'Bouton Google cliqué',
    GOOGLE_ACCOUNT_PENDING: 'En attente compte Google',
    GOOGLE_ACCOUNT_RECEIVED: 'Compte Google reçu',
    ID_TOKEN_RECEIVED: 'ID Token reçu',
    FIREBASE_ANDROID_SUCCESS: 'Connexion Firebase Android OK',
    WEBVIEW_TOKEN_SEND: 'Envoi vers WebView',
    FIREBASE_WEB_SUCCESS: 'Firebase Web connecté',
    FIREBASE_ANDROID_ERROR: 'Erreur',
    FIREBASE_WEB_ERROR: 'Erreur',
    ERROR: 'Erreur',
  });

  window.updateAuthDebug = function updateAuthDebug(status, message) {
    const normalizedStatus = String(status || 'INITIALIZATION').toUpperCase();
    const safeMessage = message == null || message === '' ? normalizedStatus : String(message);
    const statusElement = document.getElementById('authDebugStatus');
    const eventElement = document.getElementById('authDebugEvent');
    const errorElement = document.getElementById('authDebugError');

    if (!statusElement || !eventElement || !errorElement) return;

    statusElement.textContent = statusLabels[normalizedStatus] || normalizedStatus;
    statusElement.dataset.authDebugStatus = normalizedStatus;
    eventElement.textContent = safeMessage;

    if (normalizedStatus === 'ERROR' || normalizedStatus.endsWith('_ERROR')) {
      errorElement.textContent = safeMessage;
    }
  };

  // Ce listener n'agit que sur l'affichage. Le gestionnaire d'authentification reste dans login.js.
  document.getElementById('googleLoginButton')?.addEventListener('click', () => {
    window.updateAuthDebug('START_GOOGLE_SIGNIN', 'Démarrage de Google Sign-In');
  });
}());
