import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseAuth, firebaseDb } from './firebase-core.js';

const MAINTENANCE_MODAL_ID = 'globalMaintenanceModal';
const MAINTENANCE_STYLE_ID = 'globalMaintenanceModalStyles';
const MAINTENANCE_DOC_REF = doc(firebaseDb, 'appSettings', 'maintenance');
const PRIMARY_ADMIN_EMAIL = 'andrainaaina@gmail.com';
const BODY_LOCK_CLASS = 'global-maintenance-modal-open';

let maintenanceEnabled = false;
let authResolved = false;
let currentUserIsAdmin = false;
let unsubscribeUserProfile = null;
let modalVisible = false;
let blockedSiblings = [];

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function isPrimaryAdminEmail(email) {
  return String(email || '').trim().toLowerCase() === PRIMARY_ADMIN_EMAIL;
}

function resolveIsAdmin(profile, authUser) {
  const username = String(profile?.username || profile?.name || '').trim();
  const role = normalizeRole(profile?.role);
  return username === 'Admin' || role === 'admin' || isPrimaryAdminEmail(profile?.email || authUser?.email);
}

function ensureMaintenanceStyles() {
  if (document.getElementById(MAINTENANCE_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = MAINTENANCE_STYLE_ID;
  style.textContent = `
    body.${BODY_LOCK_CLASS} {
      overflow: hidden !important;
      touch-action: none;
    }

    .global-maintenance-modal {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: clamp(1rem, 4vw, 2rem);
      background: rgba(2, 6, 23, 0.68);
      backdrop-filter: blur(2px);
      overscroll-behavior: contain;
      animation: globalMaintenanceOverlayIn 180ms ease-out both;
    }

    .global-maintenance-modal[hidden] {
      display: none !important;
    }

    .global-maintenance-modal__dialog {
      width: min(100%, 30rem);
      border-radius: 1.35rem;
      background: #ffffff;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
      padding: clamp(1.35rem, 5vw, 2.1rem);
      text-align: center;
      color: #0f172a;
      animation: globalMaintenanceDialogIn 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .global-maintenance-modal__icon {
      display: inline-grid;
      place-items: center;
      width: clamp(3rem, 12vw, 4rem);
      height: clamp(3rem, 12vw, 4rem);
      margin: 0 auto 0.9rem;
      border-radius: 999px;
      background: #fff7ed;
      font-size: clamp(1.65rem, 7vw, 2.2rem);
      line-height: 1;
    }

    .global-maintenance-modal__title {
      margin: 0 0 0.85rem;
      font-size: clamp(1.35rem, 5vw, 1.75rem);
      line-height: 1.2;
      font-weight: 800;
      color: #111827;
    }

    .global-maintenance-modal__message {
      margin: 0;
      color: #374151;
      font-size: clamp(0.98rem, 3.5vw, 1.08rem);
      font-weight: 600;
      line-height: 1.65;
    }

    @keyframes globalMaintenanceOverlayIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes globalMaintenanceDialogIn {
      from {
        opacity: 0;
        transform: scale(0.94) translateY(0.5rem);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureMaintenanceModal() {
  const existingModal = document.getElementById(MAINTENANCE_MODAL_ID);
  if (existingModal) {
    return existingModal;
  }

  ensureMaintenanceStyles();

  const modal = document.createElement('section');
  modal.id = MAINTENANCE_MODAL_ID;
  modal.className = 'global-maintenance-modal';
  modal.hidden = true;
  modal.setAttribute('aria-labelledby', 'globalMaintenanceTitle');
  modal.setAttribute('aria-describedby', 'globalMaintenanceDescription');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('tabindex', '-1');
  modal.innerHTML = `
    <article class="global-maintenance-modal__dialog">
      <div class="global-maintenance-modal__icon" aria-hidden="true">🔧</div>
      <h2 id="globalMaintenanceTitle" class="global-maintenance-modal__title">🔧 Maintenance en cours</h2>
      <p id="globalMaintenanceDescription" class="global-maintenance-modal__message">
        La plateforme est actuellement en cours de maintenance.<br />
        Certaines fonctionnalités sont temporairement indisponibles.<br />
        Veuillez patienter quelques instants.<br />
        Nous vous remercions de votre compréhension.
      </p>
    </article>
  `;

  modal.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  modal.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
  document.body.appendChild(modal);
  return modal;
}

function setPageBlocked(modal, shouldBlock) {
  if (modalVisible === shouldBlock) {
    return;
  }

  modalVisible = shouldBlock;
  document.body.classList.toggle(BODY_LOCK_CLASS, shouldBlock);

  if (shouldBlock) {
    blockedSiblings = Array.from(document.body.children).filter((child) => child !== modal);
    blockedSiblings.forEach((child) => {
      child.setAttribute('aria-hidden', 'true');
      if ('inert' in child) {
        child.inert = true;
      }
    });
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    modal.focus({ preventScroll: true });
    return;
  }

  blockedSiblings.forEach((child) => {
    child.removeAttribute('aria-hidden');
    if ('inert' in child) {
      child.inert = false;
    }
  });
  blockedSiblings = [];
}

function renderMaintenanceModal() {
  const modal = ensureMaintenanceModal();
  const shouldShow = authResolved && maintenanceEnabled && !currentUserIsAdmin;
  modal.hidden = !shouldShow;
  setPageBlocked(modal, shouldShow);
}

function clearUserProfileSubscription() {
  if (typeof unsubscribeUserProfile === 'function') {
    unsubscribeUserProfile();
  }
  unsubscribeUserProfile = null;
}

function subscribeToCurrentUserRole(user) {
  clearUserProfileSubscription();
  if (!user) {
    authResolved = true;
    currentUserIsAdmin = false;
    renderMaintenanceModal();
    return;
  }

  currentUserIsAdmin = isPrimaryAdminEmail(user.email);
  authResolved = true;
  renderMaintenanceModal();

  unsubscribeUserProfile = onSnapshot(
    doc(firebaseDb, 'users', user.uid),
    (snapshot) => {
      currentUserIsAdmin = resolveIsAdmin(snapshot.exists() ? snapshot.data() : null, user);
      renderMaintenanceModal();
    },
    () => {
      currentUserIsAdmin = isPrimaryAdminEmail(user.email);
      renderMaintenanceModal();
    },
  );
}

function blockPageInteraction(event) {
  if (!modalVisible) {
    return;
  }

  const modal = document.getElementById(MAINTENANCE_MODAL_ID);
  if (event.type === 'keydown' || !modal?.contains(event.target)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function initGlobalMaintenanceModal() {
  ensureMaintenanceModal();

  document.addEventListener('click', blockPageInteraction, true);
  document.addEventListener('keydown', blockPageInteraction, true);
  document.addEventListener('submit', blockPageInteraction, true);

  const unsubscribeMaintenance = onSnapshot(
    MAINTENANCE_DOC_REF,
    (snapshot) => {
      maintenanceEnabled = Boolean(snapshot.exists() && snapshot.data()?.enabled);
      renderMaintenanceModal();
    },
    () => {
      maintenanceEnabled = false;
      renderMaintenanceModal();
    },
  );

  const unsubscribeAuth = onAuthStateChanged(firebaseAuth, subscribeToCurrentUserRole, () => {
    clearUserProfileSubscription();
    authResolved = true;
    currentUserIsAdmin = false;
    renderMaintenanceModal();
  });

  window.addEventListener('pagehide', () => {
    unsubscribeMaintenance();
    unsubscribeAuth();
    clearUserProfileSubscription();
  }, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGlobalMaintenanceModal, { once: true });
} else {
  initGlobalMaintenanceModal();
}
