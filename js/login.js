import {
  GoogleAuthProvider,
  fetchSignInMethodsForEmail,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { firebaseAuth } from './firebase-core.js';

const STORAGE_KEY = 'suiviMateriel.loginMemo.v1';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('loginEmail');
const passwordInput = document.getElementById('loginPassword');
const togglePasswordButton = document.getElementById('togglePasswordButton');
const togglePasswordIcon = document.getElementById('togglePasswordIcon');
const emailError = document.getElementById('emailError');
const passwordError = document.getElementById('passwordError');
const globalError = document.getElementById('globalError');
const emailLoginButton = document.getElementById('emailLoginButton');
const googleLoginButton = document.getElementById('googleLoginButton');

let lastEmailCheckId = 0;
let isAuthInProgress = false;

function logAuthError(error) {
  console.log('CODE:', error?.code || 'unknown');
  console.log('MESSAGE:', error?.message || 'Aucun message Firebase');
  alert(error?.code || 'auth/unknown');
}


function redirectToHome() {
  window.location.href = 'index.html';
}

onAuthStateChanged(firebaseAuth, (user) => {
  if (!user) {
    return;
  }

  const authPayload = {
    uid: user.uid || '',
    displayName: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
  };
  localStorage.setItem('suiviMateriel.authUser.v1', JSON.stringify(authPayload));
  redirectToHome();
});

function mapGoogleAuthError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');

  console.log('CODE:', code || 'unknown');
  console.log('MESSAGE:', message || 'Aucun message Firebase');

  if (code.includes('auth/popup-blocked')) {
    return 'La popup Google a été bloquée par le navigateur. Autorisez les popups puis réessayez.';
  }
  if (code.includes('auth/unauthorized-domain')) {
    return `Domaine non autorisé dans Firebase : "${window.location.hostname}". Ajoutez ce domaine dans Authentication > Settings > Authorized domains.`;
  }
  if (code.includes('auth/operation-not-allowed')) {
    return 'Google Auth n’est pas activé dans Firebase (Authentication > Sign-in method > Google).';
  }
  if (code.includes('auth/popup-closed-by-user')) {
    return 'Connexion Google annulée : la popup a été fermée avant la validation.';
  }
  if (code.includes('auth/cancelled-popup-request')) {
    return 'Une autre tentative de connexion popup est déjà en cours.';
  }
  if (code.includes('auth/network-request-failed')) {
    return 'Connexion réseau impossible. Vérifiez Internet puis réessayez.';
  }

  return 'Connexion Google impossible pour le moment. Réessayez.';
}

getRedirectResult(firebaseAuth).catch((error) => {
  logAuthError(error);
  globalError.textContent = mapGoogleAuthError(error);
  isAuthInProgress = false;
  setLoading(false, googleLoginButton);
});

function setLoading(isLoading, sourceButton = emailLoginButton) {
  emailLoginButton.disabled = isLoading;
  googleLoginButton.disabled = isLoading;
  emailLoginButton.setAttribute('aria-busy', String(isLoading));
  googleLoginButton.setAttribute('aria-busy', String(isLoading));
  sourceButton?.classList.toggle('is-loading', isLoading);
}

function isMobileDevice() {
  if (navigator.userAgentData?.mobile) {
    return true;
  }

  const touchDevice = window.matchMedia('(pointer: coarse)').matches;
  const smallViewport = window.matchMedia('(max-width: 900px)').matches;
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileUserAgent = /android|iphone|ipad|ipod|mobile/.test(userAgent);

  return isMobileUserAgent || (touchDevice && smallViewport);
}

async function startGoogleSignIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  if (isMobileDevice()) {
    await signInWithRedirect(firebaseAuth, provider);
    return 'redirect';
  }

  try {
    await signInWithPopup(firebaseAuth, provider);
    return 'popup';
  } catch (error) {
    logAuthError(error);
    const code = String(error?.code || '');
    if (code.includes('popup-blocked') || code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
      await signInWithRedirect(firebaseAuth, provider);
      return 'redirect';
    }
    throw error;
  }
}

function encodeMemo(email, password) {
  return btoa(unescape(encodeURIComponent(JSON.stringify({ email, password }))));
}

function decodeMemo(raw) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch (_error) {
    return null;
  }
}

function saveCredentials(email, password) {
  localStorage.setItem(STORAGE_KEY, encodeMemo(email, password));
}

function applyMemoIfAny() {
  const memo = decodeMemo(localStorage.getItem(STORAGE_KEY));
  if (!memo) {
    return;
  }
  if (!emailInput.value) {
    emailInput.value = memo.email || '';
  }
  if (!passwordInput.value) {
    passwordInput.value = memo.password || '';
  }
}

function isEmailFormatValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function validateEmailRealtime() {
  const email = emailInput.value.trim();
  emailError.textContent = '';

  if (!email) {
    emailError.textContent = 'Email vide.';
    return false;
  }
  if (!isEmailFormatValid(email)) {
    emailError.textContent = 'Format email invalide.';
    return false;
  }

  const requestId = ++lastEmailCheckId;
  try {
    const methods = await fetchSignInMethodsForEmail(firebaseAuth, email);
    if (requestId !== lastEmailCheckId) {
      return false;
    }
    if (!methods.length) {
      emailError.textContent = 'Email inexistant.';
      return false;
    }
  } catch (error) {
    logAuthError(error);
    emailError.textContent = 'Vérification email indisponible.';
    return false;
  }
  return true;
}

function validatePasswordRealtime() {
  const password = passwordInput.value;
  passwordError.textContent = '';
  if (!password) {
    passwordError.textContent = 'Mot de passe requis.';
    return false;
  }
  if (password.length < 6) {
    passwordError.textContent = 'Mot de passe trop court (minimum 6 caractères).';
    return false;
  }
  return true;
}

emailInput.addEventListener('focus', applyMemoIfAny);
passwordInput.addEventListener('focus', applyMemoIfAny);
emailInput.addEventListener('input', () => {
  globalError.textContent = '';
  validateEmailRealtime();
});
passwordInput.addEventListener('input', () => {
  globalError.textContent = '';
  validatePasswordRealtime();
});

togglePasswordButton.addEventListener('click', () => {
  const nextIsVisible = passwordInput.type === 'password';
  passwordInput.type = nextIsVisible ? 'text' : 'password';
  togglePasswordIcon.src = nextIsVisible ? 'Icon/Eye_ON.png' : 'Icon/Eye_OFF.png';
  togglePasswordButton.setAttribute('aria-label', nextIsVisible ? 'Cacher le mot de passe' : 'Afficher le mot de passe');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isAuthInProgress) {
    return;
  }
  globalError.textContent = '';

  const isEmailValid = await validateEmailRealtime();
  const isPasswordValid = validatePasswordRealtime();
  if (!isEmailValid || !isPasswordValid) {
    return;
  }

  setLoading(true, emailLoginButton);
  try {
    await signInWithEmailAndPassword(firebaseAuth, emailInput.value.trim(), passwordInput.value);
    saveCredentials(emailInput.value.trim(), passwordInput.value);
  } catch (error) {
    logAuthError(error);
    const code = String(error?.code || '');
    if (code.includes('wrong-password') || code.includes('invalid-credential')) {
      passwordError.textContent = 'Mot de passe incorrect.';
    } else if (code.includes('user-not-found')) {
      emailError.textContent = 'Email inexistant.';
    } else {
      globalError.textContent = 'Connexion impossible. Veuillez réessayer.';
    }
  } finally {
    setLoading(false, emailLoginButton);
  }
});

googleLoginButton.addEventListener('click', async () => {
  if (isAuthInProgress) {
    return;
  }

  isAuthInProgress = true;
  globalError.textContent = '';
  setLoading(true, googleLoginButton);
  try {
    const flow = await startGoogleSignIn();
    if (flow === 'redirect') {
      return;
    }
  } catch (error) {
    logAuthError(error);
    globalError.textContent = mapGoogleAuthError(error);
    isAuthInProgress = false;
    setLoading(false, googleLoginButton);
    return;
  }

  isAuthInProgress = false;
  setLoading(false, googleLoginButton);
});
