import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { firebaseAuth } from './firebase-core.js';

const EVENT_KEY = 'suiviMateriel.authDebug.event.v1';
const ERRORS_KEY = 'suiviMateriel.authDebug.errors.v1';
const RESULT_KEY = 'suiviMateriel.authDebug.result.v1';
const card = document.getElementById('authDebugCard');

function readErrors() {
  try {
    return JSON.parse(sessionStorage.getItem(ERRORS_KEY) || '[]');
  } catch (_error) {
    return [];
  }
}

function renderErrors() {
  const list = card?.querySelector('[data-auth-debug-errors]');
  if (!list) return;
  const errors = readErrors();
  list.replaceChildren();
  (errors.length ? errors : ['Aucune erreur']).forEach((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    list.append(item);
  });
}

function setEvent(message) {
  sessionStorage.setItem(EVENT_KEY, String(message));
  const output = card?.querySelector('[data-auth-debug-event]');
  if (output) output.textContent = message;
}

function addError(error, type = 'Erreur JavaScript') {
  const detail = error?.message || String(error || 'Erreur inconnue');
  const errors = readErrors();
  errors.push(`${type} : ${detail}`);
  sessionStorage.setItem(ERRORS_KEY, JSON.stringify(errors));
  renderErrors();
}

function renderUser(user) {
  if (!card) return;
  const status = card.querySelector('[data-auth-debug-status]');
  status.textContent = user ? 'CONNECTÉ' : 'NON CONNECTÉ';
  status.style.color = user ? '#2e7d32' : '#c62828';
  card.querySelector('[data-auth-debug-uid]').textContent = user?.uid || '—';
  card.querySelector('[data-auth-debug-email]').textContent = user?.email || '—';
  card.querySelector('[data-auth-debug-name]').textContent = user?.displayName || '—';
}

window.AuthDebug = { setEvent, addError, renderUser };
window.onerror = function (message, source, line, col, error) {
  addError(`${message} ${source || ''} ${line || ''}`, 'Erreur JavaScript');
};
window.addEventListener('unhandledrejection', (event) => addError(event.reason, 'Erreur JavaScript'));

setEvent(sessionStorage.getItem(EVENT_KEY) || 'Initialisation...');
const resultOutput = card?.querySelector('[data-auth-debug-result]');
if (resultOutput) resultOutput.textContent = sessionStorage.getItem(RESULT_KEY) || '—';
renderErrors();
renderUser(firebaseAuth.currentUser);

onAuthStateChanged(firebaseAuth, (user) => {
  console.log('AUTH CHANGE', user);
  renderUser(user);
  setEvent(user ? 'AUTH CHANGE : utilisateur détecté' : 'AUTH CHANGE : null');
}, (error) => addError(error, 'Erreur Firebase'));
