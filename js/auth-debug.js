// Compatibilité temporaire : le diagnostic Firebase est désormais alimenté uniquement
// par l’observateur Auth central de app.js et rendu par updateFirebaseDiagnostic.
function updateDiagnostic(data) {
  window.updateFirebaseDiagnostic?.(data);
}

window.AuthDebug = {
  setEvent(event) {
    updateDiagnostic({ event });
  },
  addError(error) {
    updateDiagnostic({ error: error?.message || String(error || 'Erreur inconnue') });
  },
  renderUser(user) {
    updateDiagnostic(user ? {
      status: true,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      event: 'AUTH_STATE_CHANGED',
    } : {
      status: false,
      event: 'SIGNED_OUT',
    });
  },
};
