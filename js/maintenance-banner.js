import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseDb } from './firebase-core.js';

const MAINTENANCE_BANNER_ID = 'globalMaintenanceBanner';
const MAINTENANCE_STYLE_ID = 'globalMaintenanceBannerStyles';
const MAINTENANCE_DOC_REF = doc(firebaseDb, 'appSettings', 'maintenance');

function ensureMaintenanceStyles() {
  if (document.getElementById(MAINTENANCE_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = MAINTENANCE_STYLE_ID;
  style.textContent = `
    .global-maintenance-banner {
      width: min(100% - 2rem, 72rem);
      margin: 1rem auto 0;
      padding: 0 0.25rem;
      animation: globalMaintenanceBannerIn 180ms ease-out both;
    }

    .global-maintenance-banner[hidden] {
      display: none !important;
    }

    .global-maintenance-banner__card {
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
      border: 1px solid #fb923c;
      border-left: 0.38rem solid #f97316;
      border-radius: 1rem;
      background: linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%);
      box-shadow: 0 14px 32px rgba(180, 83, 9, 0.16);
      color: #7c2d12;
      padding: 1rem 1.1rem;
    }

    .global-maintenance-banner__icon {
      flex: 0 0 auto;
      display: inline-grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 999px;
      background: rgba(251, 146, 60, 0.18);
      font-size: 1.2rem;
      line-height: 1;
    }

    .global-maintenance-banner__title {
      margin: 0 0 0.35rem;
      font-size: clamp(1rem, 2.4vw, 1.18rem);
      line-height: 1.25;
      font-weight: 800;
      color: #9a3412;
    }

    .global-maintenance-banner__message {
      margin: 0;
      color: #7c2d12;
      font-size: clamp(0.92rem, 2.2vw, 1rem);
      line-height: 1.5;
      font-weight: 600;
    }

    @keyframes globalMaintenanceBannerIn {
      from {
        opacity: 0;
        transform: translateY(-0.5rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 640px) {
      .global-maintenance-banner {
        width: 100%;
        margin-top: 0.75rem;
        padding: 0 0.75rem;
      }

      .global-maintenance-banner__card {
        gap: 0.7rem;
        padding: 0.9rem;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureMaintenanceBanner() {
  const existingBanner = document.getElementById(MAINTENANCE_BANNER_ID);
  if (existingBanner) {
    return existingBanner;
  }

  ensureMaintenanceStyles();

  const banner = document.createElement('section');
  banner.id = MAINTENANCE_BANNER_ID;
  banner.className = 'global-maintenance-banner';
  banner.hidden = true;
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = `
    <div class="global-maintenance-banner__card" role="status" aria-labelledby="globalMaintenanceTitle">
      <span class="global-maintenance-banner__icon" aria-hidden="true">🔧</span>
      <div class="global-maintenance-banner__content">
        <h2 id="globalMaintenanceTitle" class="global-maintenance-banner__title">🔧 Maintenance en cours</h2>
        <p class="global-maintenance-banner__message">
          La page est actuellement en cours de maintenance.<br />
          Certaines fonctionnalités peuvent être temporairement indisponibles.<br />
          Veuillez réessayer dans quelques instants.
        </p>
      </div>
    </div>
  `;

  const mainContent = document.querySelector('.main-content, main');
  if (mainContent?.parentNode) {
    mainContent.parentNode.insertBefore(banner, mainContent);
  } else {
    document.body.prepend(banner);
  }

  return banner;
}

function updateMaintenanceBanner(snapshot) {
  const banner = ensureMaintenanceBanner();
  const enabled = Boolean(snapshot.exists() && snapshot.data()?.enabled);
  banner.hidden = !enabled;
}

function initGlobalMaintenanceBanner() {
  ensureMaintenanceBanner();
  return onSnapshot(MAINTENANCE_DOC_REF, updateMaintenanceBanner, () => {
    const banner = document.getElementById(MAINTENANCE_BANNER_ID);
    if (banner) {
      banner.hidden = true;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGlobalMaintenanceBanner, { once: true });
} else {
  initGlobalMaintenanceBanner();
}
