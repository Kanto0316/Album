import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { firebaseAuth } from './firebase-core.js';

(function () {
  const { StorageService, UiService } = window;

  function requireElement(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const EXPORT_FILE_NAME_HISTORY_KEY = 'suiviMateriel.exportFileNames.v1';
  const EXPORT_FILE_NAME_HISTORY_LIMIT = 24;

  function sanitizeExportFileName(value, fallbackName = 'export-materiel') {
    const cleaned = String(value || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || fallbackName;
  }

  function normalizeExportBaseName(value, fallbackName = 'export-materiel') {
    return sanitizeExportFileName(value, fallbackName).replace(/\.xls$/i, '').trim() || fallbackName;
  }

  function readExportFileNameHistory() {
    try {
      const rawValue = window.localStorage.getItem(EXPORT_FILE_NAME_HISTORY_KEY);
      if (!rawValue) {
        return [];
      }
      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, EXPORT_FILE_NAME_HISTORY_LIMIT);
    } catch (_error) {
      return [];
    }
  }

  function saveExportFileNameToHistory(fileName) {
    const normalized = sanitizeExportFileName(fileName);
    const history = readExportFileNameHistory();
    const deduped = [normalized, ...history.filter((entry) => entry.toLowerCase() !== normalized.toLowerCase())]
      .slice(0, EXPORT_FILE_NAME_HISTORY_LIMIT);
    try {
      window.localStorage.setItem(EXPORT_FILE_NAME_HISTORY_KEY, JSON.stringify(deduped));
    } catch (_error) {
      // Ignore localStorage restrictions.
    }
  }

  function highlightMatchText(text, query) {
    const safeText = String(text || '');
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      return escapeHtml(safeText);
    }
    const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig');
    return escapeHtml(safeText).replace(matcher, '<mark>$1</mark>');
  }

  function setCountText(element, count, singular, plural) {
    element.textContent = `${count} ${count === 1 ? singular : plural}`;
  }

  function isSiteLocked(site) {
    return Boolean(site?.isLocked) && Boolean(String(site?.passwordHash || '').trim());
  }

  async function hashPassword(value) {
    const normalized = String(value || '');
    const encoded = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function resolveActorLabel(userId, userMap, fallbackName) {
    const directName = String(fallbackName || '').trim();
    if (directName) {
      return directName;
    }
    const username = userMap?.[String(userId || '')];
    return username || 'Utilisateur';
  }

  function buildDateAndTimeLabel(dateValue) {
    if (!dateValue) {
      return '--';
    }
    const parsedDate = new Date(dateValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return '--';
    }
    const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(parsedDate);
    const timeLabel = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(parsedDate);
    return `${dateLabel} · ${timeLabel}`;
  }

  function startOfDay(date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  function parseDateValue(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function itemMatchesDateFilter(item, filterValue) {
    if (!filterValue || filterValue === 'all') {
      return true;
    }

    const itemDate = parseDateValue(item?.dateCreation || item?.dateModification);
    if (!itemDate) {
      return false;
    }

    const today = startOfDay(new Date());
    const itemDay = startOfDay(itemDate);

    if (filterValue === 'today') {
      return itemDay.getTime() === today.getTime();
    }

    if (filterValue === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return itemDay.getTime() === yesterday.getTime();
    }

    if (filterValue === 'lastMonth') {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return itemDay.getTime() < yesterday.getTime();
    }

    if (filterValue === 'lastYear') {
      return itemDate.getFullYear() === today.getFullYear() - 1;
    }

    return true;
  }

  function resolveItemPeriodLabel(item) {
    const itemDate = parseDateValue(item?.dateCreation || item?.dateModification);
    if (!itemDate) {
      return null;
    }

    const today = startOfDay(new Date());
    const itemDay = startOfDay(itemDate);
    if (itemDay.getTime() === today.getTime()) {
      return "Aujourd'hui";
    }

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (itemDay.getTime() === yesterday.getTime()) {
      return 'Hier';
    }

    if (itemDay.getTime() < yesterday.getTime()) {
      return 'Plus ancien';
    }

    return null;
  }

  function computeEcart(detail) {
    const qteSortie = Number(detail?.qteSortie) || 0;
    const qtePosee = Number(detail?.qtePosee) || 0;
    const qteRetour = Number(detail?.qteRetour) || 0;

    if (qtePosee === 0 && qteRetour === 0) {
      return '';
    }

    return qteSortie - (qtePosee + qteRetour);
  }

  function setupZoomableDetailTable() {
    const tableContainer = requireElement('detailTableContainer');
    const tableWrapper = requireElement('detailTableWrapper');
    if (!tableContainer || !tableWrapper) {
      return;
    }

    const minScale = 0.7;
    const maxScale = 2;
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let dragState = null;
    let pinchState = null;

    function clampScale(value) {
      return Math.min(maxScale, Math.max(minScale, value));
    }

    function applyTransform() {
      tableWrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }

    function zoomAtPoint(nextScale, clientX, clientY) {
      const clampedScale = clampScale(nextScale);
      if (clampedScale === scale) {
        return;
      }

      const rect = tableContainer.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const nextTranslateX = localX - ((localX - translateX) / scale) * clampedScale;
      const nextTranslateY = localY - ((localY - translateY) / scale) * clampedScale;

      scale = clampedScale;
      translateX = nextTranslateX;
      translateY = nextTranslateY;
      applyTransform();
    }

    function isInteractiveTarget(target) {
      return Boolean(target.closest('input, select, textarea, button, a, label'));
    }

    tableContainer.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const zoomStep = 0.08;
      zoomAtPoint(scale + direction * zoomStep, event.clientX, event.clientY);
    }, { passive: false });

    tableContainer.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return;
      }
      dragState = {
        startX: event.clientX,
        startY: event.clientY,
        startTranslateX: translateX,
        startTranslateY: translateY,
      };
      tableContainer.classList.add('is-grabbing');
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!dragState) {
        return;
      }
      translateX = dragState.startTranslateX + (event.clientX - dragState.startX);
      translateY = dragState.startTranslateY + (event.clientY - dragState.startY);
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      dragState = null;
      tableContainer.classList.remove('is-grabbing');
    });

    tableContainer.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2) {
        const [touchA, touchB] = event.touches;
        const dx = touchB.clientX - touchA.clientX;
        const dy = touchB.clientY - touchA.clientY;
        pinchState = {
          distance: Math.hypot(dx, dy),
          scale,
        };
      }
    }, { passive: true });

    tableContainer.addEventListener('touchmove', (event) => {
      if (event.touches.length !== 2 || !pinchState) {
        return;
      }

      const [touchA, touchB] = event.touches;
      const dx = touchB.clientX - touchA.clientX;
      const dy = touchB.clientY - touchA.clientY;
      const currentDistance = Math.hypot(dx, dy);
      if (!currentDistance || !pinchState.distance) {
        return;
      }

      const midpointX = (touchA.clientX + touchB.clientX) / 2;
      const midpointY = (touchA.clientY + touchB.clientY) / 2;
      const scaleFactor = currentDistance / pinchState.distance;
      zoomAtPoint(pinchState.scale * scaleFactor, midpointX, midpointY);
      event.preventDefault();
    }, { passive: false });

    tableContainer.addEventListener('touchend', (event) => {
      if (event.touches.length < 2) {
        pinchState = null;
      }
    });

    tableContainer.addEventListener('touchcancel', () => {
      pinchState = null;
    });

    applyTransform();
  }

  function setupBackButtons() {
    document.querySelectorAll('[data-back]').forEach((button) => {
      button.addEventListener('click', () => {
        UiService.navigate(button.dataset.back);
      });
    });
  }

  function waitForAuthState() {
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
        unsubscribe();
        resolve(user || null);
      }, () => resolve(null));
    });
  }

  function normalizeAuthUserData(user) {
    const authUser = user || firebaseAuth.currentUser;
    if (!authUser) {
      return null;
    }
    const photoUrl = String(authUser.photoURL || authUser.photo || '').trim();
    const displayName = String(authUser.displayName || authUser.name || '').trim();
    const email = String(authUser.email || '').trim();
    return {
      uid: authUser.uid || '',
      name: displayName,
      displayName,
      email,
      photoURL: photoUrl,
      photo: photoUrl,
    };
  }

  function renderHomeAccessControls({ authUser, onAvatarClick }) {
    const avatarButton = document.getElementById('userAvatarButton');
    const loginButton = document.getElementById('openLoginButton');
    const userData = normalizeAuthUserData(authUser);
    const isAuthenticated = Boolean(userData);

    setHomeAccessControlVisibility({ showAvatar: false, showLoginButton: false });

    if (isAuthenticated) {
      setHomeAccessControlVisibility({ showAvatar: true, showLoginButton: false });
      renderAvatar(userData, onAvatarClick);
      return;
    }

    if (avatarButton) {
      avatarButton.onclick = null;
    }
    if (loginButton) {
      setHomeAccessControlVisibility({ showAvatar: false, showLoginButton: true });
      loginButton.onclick = () => UiService.navigate('login.html');
    }
  }

  function initAuthRequiredNoticeCard() {
    const cards = Array.from(document.querySelectorAll('[data-auth-required-card]'));
    if (!cards.length) {
      return;
    }

    const loginActions = Array.from(document.querySelectorAll('[data-auth-login-action]'));
    const updateCardVisibility = (user) => {
      const isAuthenticated = Boolean(user?.uid);
      cards.forEach((card) => {
        card.hidden = isAuthenticated;
        card.style.display = isAuthenticated ? 'none' : '';
      });
    };

    loginActions.forEach((actionButton) => {
      actionButton.addEventListener('click', () => {
        UiService.navigate('login.html');
      });
    });

    updateCardVisibility(firebaseAuth.currentUser);
    onAuthStateChanged(firebaseAuth, (user) => {
      updateCardVisibility(user || null);
    });
  }

  function setHomeAccessControlVisibility({ showAvatar, showLoginButton }) {
    const avatarButton = document.getElementById('userAvatarButton');
    const loginButton = document.getElementById('openLoginButton');

    if (avatarButton) {
      avatarButton.hidden = !showAvatar;
      avatarButton.style.display = showAvatar ? 'inline-flex' : 'none';
    }

    if (loginButton) {
      loginButton.hidden = !showLoginButton;
      loginButton.style.display = showLoginButton ? 'inline-flex' : 'none';
    }
  }

  function downloadExcelFile(fileName, title, workbook) {
    const blob = new Blob(['\ufeff', workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    UiService.showToast(`${title} lancé.`);
  }

  function buildDetailExcelContent(title, details) {
    const rows = details
      .map(
        (detail) => `
            <tr>
              <td>${escapeHtml(detail.champ)}</td>
              <td>${escapeHtml(detail.code)}</td>
              <td>${escapeHtml(detail.designation)}</td>
              <td>${escapeHtml(detail.qteSortie)}</td>
              <td>${escapeHtml(detail.unite)}</td>
              <td>${escapeHtml(detail.qtePosee)}</td>
              <td>${escapeHtml(detail.qteRetour)}</td>
              <td>${escapeHtml(computeEcart(detail))}</td>
              <td>${escapeHtml(detail.observation)}</td>
            </tr>
          `,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #cfd8e3; padding: 8px; text-align: center; vertical-align: middle; }
    </style>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>Champ</th>
          <th>Code</th>
          <th>Désignation</th>
          <th>Qté Sortie</th>
          <th>Unité</th>
          <th>Qté posée</th>
          <th>Qté Retour</th>
          <th>Ecart</th>
          <th>Observation</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
  }

  function buildSiteExcelContent(title, rows) {
    const bodyRows = rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.out)}</td>
            <td>${escapeHtml(row.code)}</td>
            <td>${escapeHtml(row.designation)}</td>
            <td>${escapeHtml(row.qteSortie)}</td>
            <td>${escapeHtml(row.unite)}</td>
            <td>${escapeHtml(row.qtePosee)}</td>
            <td>${escapeHtml(row.qteRetour)}</td>
            <td>${escapeHtml(computeEcart(row))}</td>
            <td>${escapeHtml(row.observation)}</td>
          </tr>
        `,
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #cfd8e3; padding: 8px; text-align: center; vertical-align: middle; }
    </style>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>OUT</th>
          <th>Code</th>
          <th>Désignation</th>
          <th>Qté Sortie</th>
          <th>Unité</th>
          <th>Qté posée</th>
          <th>Qté Retour</th>
          <th>Ecart</th>
          <th>Remarque</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body>
</html>`;
  }



  function buildPermissions(profile) {
    const username = String(profile?.username || '');
    const role = String(profile?.role || 'limite').toLowerCase();
    const isAdmin = username === 'Admin' || role === 'admin';
    const isStandard = role === 'standard';
    const isLecture = role === 'lecture';
    if (isAdmin) {
      return {
        canCreate: true,
        canEdit: true,
        canDelete: true,
        isAdmin: true,
        isStandard: false,
        canManageUsers: true,
        canImportExport: true,
        isLecture: false,
      };
    }
    return {
      canCreate: true,
      canEdit: true,
      canDelete: true,
      isAdmin: false,
      isStandard,
      canManageUsers: isStandard,
      canImportExport: isStandard,
      isLecture,
    };
  }

  function ensureMaintenanceOverlay() {
    let overlay = document.getElementById('maintenanceOverlay');
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement('div');
    overlay.id = 'maintenanceOverlay';
    overlay.className = 'maintenance-overlay item-delete-confirm-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <article class="maintenance-card" role="alertdialog" aria-modal="true" aria-labelledby="maintenanceTitle">
        <h3 id="maintenanceTitle">Information</h3>
        <p>Page en cours de maintenance, veuillez attendre s'il vous plaît</p>
      </article>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function initMaintenanceGate(permissions, profile) {
    const bypassMaintenance = Boolean(
      permissions?.isAdmin
      || profile?.maintenanceAuthorized
      || profile?.maintenanceAccess,
    );
    if (bypassMaintenance) {
      return () => {};
    }

    const overlay = ensureMaintenanceOverlay();
    return StorageService.subscribeMaintenanceState(
      (maintenanceState) => {
        overlay.hidden = !maintenanceState.enabled;
      },
      () => {
        UiService.showToast('État de maintenance indisponible.');
      },
    );
  }

  function clearClientUserState() {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch (_error) {
      // Ignore storage cleanup errors (private mode / restricted storage).
    }
  }

  function getInitialsFromName(name) {
    const sanitizedName = String(name || '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim();
    const initials = sanitizedName.substring(0, 2).toUpperCase();
    return initials || 'U';
  }

  function getAvatarFallback(user) {
    const displayName = String(user?.displayName || user?.name || '').trim();
    const emailName = String(user?.email || '').split('@')[0].trim();
    const source = displayName || emailName || 'U';
    return getInitialsFromName(source);
  }

  function renderAvatarVisual(container, { photo, initials, imageClass, altText }) {
    if (!container) {
      return;
    }
    container.innerHTML = photo
      ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(altText)}" class="${imageClass}" />`
      : `<span class="avatar-initials">${escapeHtml(initials)}</span>`;
  }

  function renderUserAvatar(user) {
    const normalizedUser = normalizeAuthUserData(user);
    const photo = String(normalizedUser?.photoURL || '').trim();
    const initials = getAvatarFallback(normalizedUser);
    const headerAvatarElement = document.getElementById('userAvatarButton');
    const bottomSheetAvatarElement = document.getElementById('avatarSheetPreview');

    renderAvatarVisual(headerAvatarElement, {
      photo,
      initials,
      imageClass: 'header-avatar-img',
      altText: 'Avatar',
    });

    renderAvatarVisual(bottomSheetAvatarElement, {
      photo,
      initials,
      imageClass: 'sheet-avatar-img',
      altText: 'Avatar',
    });
  }

  function renderAvatar(authUserData, onClick) {
    const avatarButton = document.getElementById('userAvatarButton');
    if (!avatarButton) {
      return;
    }
    renderUserAvatar(authUserData);
    avatarButton.title = authUserData?.name || authUserData?.email || '';
    setHomeAccessControlVisibility({ showAvatar: true, showLoginButton: false });
    avatarButton.onclick = onClick;
  }

  function ensureAvatarBottomSheet() {
    let overlay = document.getElementById('avatarSheetOverlay');
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'avatarSheetOverlay';
    overlay.className = 'bottom-sheet-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="bottom-sheet" id="avatarBottomSheet" role="dialog" aria-modal="true" aria-label="Actions du profil">
        <div class="bottom-sheet__handle" aria-hidden="true"></div>
        <div class="bottom-sheet__content">
          <div class="bottom-sheet__avatar-wrap">
            <div class="bottom-sheet__avatar" id="avatarSheetPreview">U</div>
          </div>
          <p class="bottom-sheet__name" id="avatarSheetName">Utilisateur</p>
          <button type="button" class="bottom-sheet__action" id="avatarSheetLogout">Déconnexion</button>
          <p id="avatarSheetMessage" class="form-error" aria-live="polite"></p>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  }

  function ensureLogoutConfirmationCard() {
    let overlay = document.getElementById('logoutConfirmOverlay');
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'logoutConfirmOverlay';
    overlay.className = 'maintenance-overlay item-delete-confirm-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <article class="maintenance-card item-delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="logoutConfirmTitle">
        <h3 id="logoutConfirmTitle">Déconnexion</h3>
        <p>Voulez-vous vous déconnecter ?</p>
        <div class="modal-actions item-delete-confirm-actions">
          <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--cancel" id="logoutConfirmCancel">Annuler</button>
          <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--danger" id="logoutConfirmSubmit">Déconnexion</button>
        </div>
      </article>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function askLogoutConfirmation() {
    const overlay = ensureLogoutConfirmationCard();
    const cancelButton = overlay.querySelector('#logoutConfirmCancel');
    const submitButton = overlay.querySelector('#logoutConfirmSubmit');
    if (!cancelButton || !submitButton) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const closeAnimationDurationMs = 170;
      let closeAnimationTimer = null;
      let isClosing = false;
      const cleanup = () => {
        if (closeAnimationTimer) {
          window.clearTimeout(closeAnimationTimer);
          closeAnimationTimer = null;
        }
        overlay.hidden = true;
        overlay.classList.remove('is-open');
        overlay.onclick = null;
        cancelButton.onclick = null;
        submitButton.onclick = null;
        document.removeEventListener('keydown', handleKeyDown);
      };
      const close = (value) => {
        if (isClosing) {
          return;
        }
        isClosing = true;
        overlay.classList.remove('is-open');
        closeAnimationTimer = window.setTimeout(() => {
          cleanup();
          resolve(value);
        }, closeAnimationDurationMs);
      };
      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          close(false);
        }
      };

      cancelButton.onclick = () => close(false);
      submitButton.onclick = () => close(true);
      overlay.onclick = (event) => {
        if (event.target === overlay) {
          close(false);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      overlay.hidden = false;
      window.requestAnimationFrame(() => {
        overlay.classList.add('is-open');
      });
    });
  }

  function openAvatarBottomSheet(authUserData) {
    const overlay = ensureAvatarBottomSheet();
    const sheet = overlay.querySelector('#avatarBottomSheet');
    const avatarPreview = overlay.querySelector('#avatarSheetPreview');
    const nameLabel = overlay.querySelector('#avatarSheetName');
    const logoutButton = overlay.querySelector('#avatarSheetLogout');
    const message = overlay.querySelector('#avatarSheetMessage');

    if (!sheet || !avatarPreview || !nameLabel || !logoutButton || !message) {
      return;
    }

    renderUserAvatar(authUserData);
    nameLabel.textContent = String(authUserData?.name || authUserData?.email || 'Utilisateur');
    avatarPreview.title = authUserData?.name || authUserData?.email || '';
    message.textContent = '';

    const closeTransitionDurationMs = 320;
    const clearCloseListeners = () => {
      if (overlay.__closeTimerId) {
        window.clearTimeout(overlay.__closeTimerId);
        overlay.__closeTimerId = null;
      }
      if (overlay.__closeTransitionHandler) {
        overlay.removeEventListener('transitionend', overlay.__closeTransitionHandler);
        overlay.__closeTransitionHandler = null;
      }
    };
    const finalizeClose = () => {
      clearCloseListeners();
      overlay.hidden = true;
      overlay.classList.remove('is-open');
    };
    const closeSheet = () =>
      new Promise((resolve) => {
        if (overlay.hidden) {
          resolve();
          return;
        }

        let isResolved = false;
        const finish = () => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          finalizeClose();
          resolve();
        };

        overlay.classList.remove('is-open');
        overlay.__closeTransitionHandler = (event) => {
          if (event.target !== overlay && event.target !== sheet) {
            return;
          }
          finish();
        };
        overlay.addEventListener('transitionend', overlay.__closeTransitionHandler);
        overlay.__closeTimerId = window.setTimeout(finish, closeTransitionDurationMs);
      });

    logoutButton.onclick = async () => {
      await closeSheet();
      const shouldLogout = await askLogoutConfirmation();
      if (!shouldLogout) {
        return;
      }
      try {
        await signOut(firebaseAuth);
      } catch (_error) {
        message.textContent = "Impossible de se déconnecter pour l'instant.";
      }
    };

    overlay.onclick = (event) => {
      if (event.target === overlay) {
        closeSheet();
      }
    };

    let touchStartY = null;
    sheet.ontouchstart = (event) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    sheet.ontouchend = (event) => {
      if (touchStartY === null) {
        return;
      }
      const touchEndY = event.changedTouches[0]?.clientY ?? touchStartY;
      if (touchEndY - touchStartY > 60) {
        closeSheet();
      }
      touchStartY = null;
    };

    overlay.hidden = false;
    clearCloseListeners();
    window.requestAnimationFrame(() => {
      overlay.classList.add('is-open');
    });
  }

  function initHomePage(permissions, authState) {
    initAuthRequiredNoticeCard();

    const searchInput = requireElement('searchInput');
    const siteList = requireElement('siteList');
    const siteCount = requireElement('siteCount');
    const siteDialog = requireElement('siteDialog');
    const siteForm = requireElement('siteForm');
    const siteNameInput = requireElement('siteNameInput');
    const siteNameCounter = requireElement('siteNameCounter');
    const siteFormError = requireElement('siteFormError');
    const siteCreateSubmitButton = requireElement('siteCreateSubmitButton');
    const siteEditNameDialog = requireElement('siteEditNameDialog');
    const siteEditNameForm = requireElement('siteEditNameForm');
    const siteEditNameInput = requireElement('siteEditNameInput');
    const siteEditNameCounter = requireElement('siteEditNameCounter');
    const siteEditNameError = requireElement('siteEditNameError');
    const siteEditNameSubmitButton = requireElement('siteEditNameSubmitButton');
    const homeMenuButton = requireElement('homeMenuButton');
    const homeMenuPanel = requireElement('homeMenuPanel');
    const homeMenuOverlay = requireElement('homeMenuOverlay');
    const importDataButton = requireElement('sidebarImportBtn');
    const exportDataButton = requireElement('sidebarExportBtn');
    const manageUsersButton = requireElement('sidebarUsersBtn');
    const usersSidebarBtn = homeMenuPanel?.querySelector('#sidebarUsersBtn') || null;
    const historySidebarBtn = homeMenuPanel?.querySelector('#sidebarHistoryBtn') || null;
    const allMaterialsSidebarBtn = homeMenuPanel?.querySelector('#sidebarAllMaterialsBtn') || null;
    const sidebarItems = homeMenuPanel ? Array.from(homeMenuPanel.querySelectorAll('.sidebar-item')) : [];
    const siteLockDialog = requireElement('siteLockDialog');
    const siteLockForm = requireElement('siteLockForm');
    const siteLockPasswordInput = requireElement('siteLockPasswordInput');
    const siteLockConfirmPasswordInput = requireElement('siteLockConfirmPasswordInput');
    const siteLockPasswordError = requireElement('siteLockPasswordError');
    const siteLockConfirmPasswordError = requireElement('siteLockConfirmPasswordError');
    const siteLockStrengthIndicator = requireElement('siteLockStrengthIndicator');
    const siteLockStrengthLabel = requireElement('siteLockStrengthLabel');
    const siteUnlockDialog = requireElement('siteUnlockDialog');
    const siteUnlockForm = requireElement('siteUnlockForm');
    const siteUnlockPasswordInput = requireElement('siteUnlockPasswordInput');
    const siteUnlockPasswordToggle = requireElement('siteUnlockPasswordToggle');
    const siteUnlockSubmitButton = requireElement('siteUnlockSubmitButton');
    const siteUnlockError = requireElement('siteUnlockError');
    const siteLockManageDialog = requireElement('siteLockManageDialog');
    const siteLockManageForm = requireElement('siteLockManageForm');
    const siteLockCurrentPasswordInput = requireElement('siteLockCurrentPasswordInput');
    const siteLockNewPasswordInput = requireElement('siteLockNewPasswordInput');
    const siteLockCurrentPasswordError = requireElement('siteLockCurrentPasswordError');
    const siteLockNewPasswordError = requireElement('siteLockNewPasswordError');
    const siteLockCurrentPasswordToggle = requireElement('siteLockCurrentPasswordToggle');
    const siteLockNewPasswordToggle = requireElement('siteLockNewPasswordToggle');
    const siteLockManageUpdateButton = requireElement('siteLockManageUpdateButton');
    const siteLockManageUnlockButton = requireElement('siteLockManageUnlockButton');

    let currentSites = [];
    let itemCountsBySite = {};
    let userNamesById = {};
    let currentPermissions = permissions;
    let isAuthenticated = Boolean(authState?.isAuthenticated);
    let siteIdPendingLock = null;
    let siteIdPendingUnlock = null;
    let siteIdPendingLockManage = null;
    const siteActionState = {
      activeSiteId: null,
      closeSheet: null,
      refreshSheetContent: null,
      closeConfirmation: null,
      hasHistoryEntry: false,
      ignoreNextPopstate: false,
    };
    const transientErrorTimers = new WeakMap();
    let isSiteCreationPending = false;
    let siteNameErrorClearTimer = null;
    let siteNameEditErrorClearTimer = null;
    let isSiteNameEditPending = false;
    let siteNameAvailabilityDebounceTimer = null;
    let isSiteCreateInputValid = false;
    const siteLockFieldStateTimers = new WeakMap();
    let isSiteUnlockPending = false;
    let isSiteLockManageUpdatePending = false;
    let isSiteLockManageUnlockPending = false;

    function setSiteCreateLoadingState(isLoading) {
      isSiteCreationPending = Boolean(isLoading);
      if (!siteCreateSubmitButton) {
        return;
      }
      siteCreateSubmitButton.disabled = isSiteCreationPending || !isSiteCreateInputValid;
      siteCreateSubmitButton.classList.toggle('is-loading', isSiteCreationPending);
      siteCreateSubmitButton.setAttribute('aria-busy', String(isSiteCreationPending));
    }

    function getSiteNameMaxLength() {
      return siteNameInput.maxLength > 0 ? siteNameInput.maxLength : null;
    }

    function getSiteEditNameMaxLength() {
      return siteEditNameInput?.maxLength > 0 ? siteEditNameInput.maxLength : 25;
    }

    function setSiteUnlockLoadingState(isLoading) {
      isSiteUnlockPending = Boolean(isLoading);
      if (!siteUnlockSubmitButton) {
        return;
      }
      siteUnlockSubmitButton.disabled = isSiteUnlockPending;
      siteUnlockSubmitButton.classList.toggle('is-loading', isSiteUnlockPending);
      siteUnlockSubmitButton.setAttribute('aria-busy', String(isSiteUnlockPending));
    }

    function setSiteLockManageActionLoadingState(action, isLoading) {
      if (action === 'unlock') {
        isSiteLockManageUnlockPending = Boolean(isLoading);
        if (!siteLockManageUnlockButton) {
          return;
        }
        siteLockManageUnlockButton.disabled = isSiteLockManageUnlockPending;
        siteLockManageUnlockButton.classList.toggle('is-loading', isSiteLockManageUnlockPending);
        siteLockManageUnlockButton.setAttribute('aria-busy', String(isSiteLockManageUnlockPending));
        return;
      }
      isSiteLockManageUpdatePending = Boolean(isLoading);
      if (!siteLockManageUpdateButton) {
        return;
      }
      siteLockManageUpdateButton.disabled = isSiteLockManageUpdatePending;
      siteLockManageUpdateButton.classList.toggle('is-loading', isSiteLockManageUpdatePending);
      siteLockManageUpdateButton.setAttribute('aria-busy', String(isSiteLockManageUpdatePending));
    }

    function enforceSiteNameMaxLength() {
      const maxLength = getSiteNameMaxLength();
      if (!maxLength || maxLength <= 0) {
        return;
      }
      if (siteNameInput.value.length > maxLength) {
        siteNameInput.value = siteNameInput.value.slice(0, maxLength);
      }
    }

    function updateSiteNameCounter() {
      enforceSiteNameMaxLength();
      const maxLength = getSiteNameMaxLength();
      const currentLength = siteNameInput.value.length;
      siteNameCounter.textContent = `${currentLength} / ${maxLength ?? currentLength}`;

      siteNameCounter.classList.remove('is-warning', 'is-limit');
      if (!maxLength || maxLength <= 0) {
        return;
      }

      const ratio = currentLength / maxLength;
      if (ratio >= 1) {
        siteNameCounter.classList.add('is-limit');
      } else if (ratio >= 0.8) {
        siteNameCounter.classList.add('is-warning');
      }
    }

    function updateSiteEditNameCounter() {
      if (!siteEditNameInput || !siteEditNameCounter) {
        return;
      }
      const maxLength = getSiteEditNameMaxLength();
      if (siteEditNameInput.value.length > maxLength) {
        siteEditNameInput.value = siteEditNameInput.value.slice(0, maxLength);
      }
      const currentLength = siteEditNameInput.value.length;
      siteEditNameCounter.textContent = `${currentLength} / ${maxLength}`;
      siteEditNameCounter.classList.remove('is-warning', 'is-limit');
      const ratio = currentLength / maxLength;
      if (ratio >= 1) {
        siteEditNameCounter.classList.add('is-limit');
      } else if (ratio >= 0.8) {
        siteEditNameCounter.classList.add('is-warning');
      }
    }

    function clearTransientError(errorElement) {
      if (!errorElement) {
        return;
      }
      const activeTimer = transientErrorTimers.get(errorElement);
      if (activeTimer) {
        window.clearTimeout(activeTimer);
        transientErrorTimers.delete(errorElement);
      }
      errorElement.textContent = '';
    }

    function clearSiteNameErrorState() {
      if (siteNameErrorClearTimer) {
        window.clearTimeout(siteNameErrorClearTimer);
        siteNameErrorClearTimer = null;
      }
      siteNameInput.classList.remove('is-error', 'is-shaking');
    }

    function showSiteNameError(message, durationMs = 2300) {
      clearSiteNameErrorState();
      showTransientError(siteFormError, message);
      siteNameInput.classList.remove('is-shaking');
      // Force un reflow pour rejouer l'animation à chaque nouvelle erreur.
      void siteNameInput.offsetWidth;
      siteNameInput.classList.add('is-error', 'is-shaking');
      siteNameErrorClearTimer = window.setTimeout(() => {
        clearSiteNameErrorState();
      }, durationMs);
    }

    function setSiteCreateSubmitEnabled(isEnabled) {
      if (!siteCreateSubmitButton) {
        return;
      }
      isSiteCreateInputValid = Boolean(isEnabled);
      siteCreateSubmitButton.disabled = isSiteCreationPending || !isSiteCreateInputValid;
    }

    function clearSiteNameAvailabilityMessage() {
      clearTransientError(siteFormError);
      siteFormError.style.color = '';
      clearSiteNameErrorState();
    }

    function showSiteNameAvailabilityError(message) {
      clearSiteNameErrorState();
      siteNameInput.classList.add('is-error');
      siteFormError.textContent = message;
      siteFormError.style.color = '';
    }

    function showSiteNameAvailabilitySuccess(message) {
      clearSiteNameErrorState();
      siteFormError.textContent = message;
      siteFormError.style.color = 'var(--success)';
    }

    function isSiteNameAlreadyUsed(normalizedName) {
      return currentSites.some((site) => String(site?.name || site?.nom || '').trim().toLowerCase() === normalizedName);
    }

    function validateSiteNameDuringInput() {
      const value = siteNameInput.value.trim();
      const normalizedValue = value.toLowerCase();

      if (!value) {
        clearSiteNameAvailabilityMessage();
        setSiteCreateSubmitEnabled(false);
        return;
      }

      if (value.length < 4) {
        showSiteNameAvailabilityError('Le nom doit contenir au moins 4 caractères.');
        setSiteCreateSubmitEnabled(false);
        return;
      }

      if (isSiteNameAlreadyUsed(normalizedValue)) {
        showSiteNameAvailabilityError('Ce nom de site existe déjà.');
        setSiteCreateSubmitEnabled(false);
        return;
      }

      showSiteNameAvailabilitySuccess('Ce nom de site est disponible.');
      setSiteCreateSubmitEnabled(Boolean(currentPermissions.canCreate) && !isSiteCreationPending);
    }

    function clearSiteEditNameErrorState() {
      if (siteNameEditErrorClearTimer) {
        window.clearTimeout(siteNameEditErrorClearTimer);
        siteNameEditErrorClearTimer = null;
      }
      siteEditNameInput?.classList.remove('input-error', 'is-error', 'is-shaking');
    }

    function showSiteEditNameError(message, durationMs = 2300) {
      clearSiteEditNameErrorState();
      showTransientError(siteEditNameError, message);
      siteEditNameInput?.classList.remove('is-shaking');
      void siteEditNameInput?.offsetWidth;
      siteEditNameInput?.classList.add('input-error', 'is-error', 'is-shaking');
      siteNameEditErrorClearTimer = window.setTimeout(() => {
        clearSiteEditNameErrorState();
      }, durationMs);
    }

    function setSiteEditNameLoadingState(isLoading) {
      isSiteNameEditPending = Boolean(isLoading);
      if (!siteEditNameSubmitButton) {
        return;
      }
      siteEditNameSubmitButton.disabled = isSiteNameEditPending;
    }

    function showTransientError(errorElement, message) {
      if (!errorElement) {
        return;
      }
      clearTransientError(errorElement);
      errorElement.textContent = message;
      const hideTimer = window.setTimeout(() => {
        errorElement.textContent = '';
        transientErrorTimers.delete(errorElement);
      }, 2000);
      transientErrorTimers.set(errorElement, hideTimer);
    }

    function clearSiteLockFieldErrorState(inputElement, errorElement) {
      if (!inputElement || !errorElement) {
        return;
      }
      clearTransientError(errorElement);
      const timer = siteLockFieldStateTimers.get(inputElement);
      if (timer) {
        window.clearTimeout(timer);
        siteLockFieldStateTimers.delete(inputElement);
      }
      inputElement.classList.remove('is-error', 'is-shaking');
    }

    function showSiteLockFieldError(inputElement, errorElement, message, durationMs = 2300) {
      if (!inputElement || !errorElement) {
        return;
      }
      clearSiteLockFieldErrorState(inputElement, errorElement);
      showTransientError(errorElement, message);
      inputElement.classList.remove('is-shaking');
      void inputElement.offsetWidth;
      inputElement.classList.add('is-error', 'is-shaking');
      const timer = window.setTimeout(() => {
        inputElement.classList.remove('is-error', 'is-shaking');
        siteLockFieldStateTimers.delete(inputElement);
      }, durationMs);
      siteLockFieldStateTimers.set(inputElement, timer);
    }

    function clearSiteLockManageFieldErrorState(inputElement, errorElement) {
      clearSiteLockFieldErrorState(inputElement, errorElement);
    }

    function showSiteLockManageFieldError(inputElement, errorElement, message, durationMs = 2300) {
      showSiteLockFieldError(inputElement, errorElement, message, durationMs);
    }

    function clearSiteLockManageErrors() {
      clearSiteLockManageFieldErrorState(siteLockCurrentPasswordInput, siteLockCurrentPasswordError);
      clearSiteLockManageFieldErrorState(siteLockNewPasswordInput, siteLockNewPasswordError);
    }

    function clearSiteLockManageLoadingStates() {
      setSiteLockManageActionLoadingState('update', false);
      setSiteLockManageActionLoadingState('unlock', false);
    }

    function clearSiteUnlockFieldErrorState() {
      if (!siteUnlockPasswordInput || !siteUnlockError) {
        return;
      }
      clearTransientError(siteUnlockError);
      const timer = siteLockFieldStateTimers.get(siteUnlockPasswordInput);
      if (timer) {
        window.clearTimeout(timer);
        siteLockFieldStateTimers.delete(siteUnlockPasswordInput);
      }
      siteUnlockPasswordInput.classList.remove('is-error', 'is-shaking');
    }

    function showSiteUnlockFieldError(message, durationMs = 2300) {
      if (!siteUnlockPasswordInput || !siteUnlockError) {
        return;
      }
      clearSiteUnlockFieldErrorState();
      showTransientError(siteUnlockError, message);
      siteUnlockPasswordInput.classList.remove('is-shaking');
      void siteUnlockPasswordInput.offsetWidth;
      siteUnlockPasswordInput.classList.add('is-error', 'is-shaking');
      const timer = window.setTimeout(() => {
        siteUnlockPasswordInput.classList.remove('is-error', 'is-shaking');
        siteLockFieldStateTimers.delete(siteUnlockPasswordInput);
      }, durationMs);
      siteLockFieldStateTimers.set(siteUnlockPasswordInput, timer);
    }

    function setPasswordVisibility(inputElement, toggleButton, isVisible) {
      if (!inputElement || !toggleButton) {
        return;
      }
      const iconElement = toggleButton.querySelector('img');
      inputElement.type = isVisible ? 'text' : 'password';
      toggleButton.setAttribute('aria-label', isVisible ? 'Cacher le mot de passe' : 'Afficher le mot de passe');
      if (iconElement) {
        iconElement.src = isVisible ? 'Icon/Eye_ON.png' : 'Icon/Eye_OFF.png';
      }
    }

    function getPasswordStrength(passwordValue) {
      const value = String(passwordValue || '');
      const length = value.length;
      if (!length) {
        return null;
      }
      const bonusCount = [/[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
      if (length < 6) {
        return 'weak';
      }
      if (length >= 10 && bonusCount >= 2) {
        return 'strong';
      }
      if ((length >= 6 && length <= 9) || bonusCount >= 1) {
        return 'medium';
      }
      return 'weak';
    }

    function updateSiteLockStrengthIndicator() {
      if (!siteLockStrengthIndicator || !siteLockStrengthLabel) {
        return;
      }
      const passwordValue = siteLockPasswordInput?.value || '';
      const strength = getPasswordStrength(passwordValue);
      if (!strength) {
        siteLockStrengthIndicator.hidden = true;
        siteLockStrengthIndicator.removeAttribute('data-strength');
        return;
      }
      const strengthLabelByKey = {
        weak: 'Mot de passe faible',
        medium: 'Mot de passe moyen',
        strong: 'Mot de passe fort',
      };
      siteLockStrengthIndicator.hidden = false;
      siteLockStrengthIndicator.dataset.strength = strength;
      siteLockStrengthLabel.textContent = strengthLabelByKey[strength] || strengthLabelByKey.weak;
    }

    async function loadUserNames() {
      try {
        const users = await StorageService.listUsers();
        userNamesById = users.reduce((accumulator, user) => {
          if (user?.id) {
            accumulator[user.id] = user.username || 'Utilisateur';
          }
          return accumulator;
        }, {});
      } catch (_error) {
        userNamesById = {};
      }
      renderSites();
    }

    function formatExportFileName() {
      const now = new Date();
      const datePart = now.toISOString().replace(/[:]/g, '-').replace(/\..+/, '').replace('T', '_');
      return `Exporter.${datePart}.su`;
    }

    const HOME_MENU_ANIMATION_LOCK_MS = 320;
    let homeMenuCloseTimer = null;
    let sidebarAnimating = false;
    let touchStartX = 0;
    let touchCurrentX = 0;
    let isDraggingSidebar = false;
    let sidebarWidth = 0;
    const homeMenuStateKey = '__homeMenuOpen__';
    const homeMenuCloseButton = requireElement('homeMenuCloseButton');

    function finalizeHomeMenuClose() {
      if (!homeMenuPanel) {
        return;
      }
      if (homeMenuOverlay) {
        homeMenuOverlay.hidden = true;
        homeMenuOverlay.classList.remove('is-open');
      }
      document.body.classList.remove('sidebar-open');
      homeMenuButton?.setAttribute('aria-expanded', 'false');
      if (window.history.state?.[homeMenuStateKey]) {
        window.history.back();
      }
      homeMenuPanel.hidden = true;
      homeMenuPanel.classList.remove('is-open', 'is-closing');
      homeMenuPanel.style.transform = '';
      homeMenuPanel.style.transition = '';
      if (homeMenuOverlay) {
        homeMenuOverlay.style.opacity = '';
      }
      isDraggingSidebar = false;
      sidebarAnimating = false;
    }

    function closeSidebar() {
      if (!homeMenuPanel || !homeMenuButton || sidebarAnimating) {
        return;
      }
      if (!homeMenuOverlay || homeMenuOverlay.hidden || homeMenuPanel.classList.contains('is-closing')) {
        finalizeHomeMenuClose();
        return;
      }
      sidebarAnimating = true;
      if (homeMenuCloseTimer) {
        window.clearTimeout(homeMenuCloseTimer);
        homeMenuCloseTimer = null;
      }

      homeMenuPanel.classList.remove('is-open');
      homeMenuPanel.classList.add('is-closing');
      homeMenuPanel.style.transform = '';
      const onTransitionEnd = (event) => {
        if (event.target !== homeMenuPanel) {
          return;
        }
        finalizeHomeMenuClose();
      };
      homeMenuPanel.addEventListener('transitionend', onTransitionEnd, { once: true });
      homeMenuCloseTimer = window.setTimeout(() => {
        homeMenuPanel.removeEventListener('transitionend', onTransitionEnd);
        finalizeHomeMenuClose();
        homeMenuCloseTimer = null;
      }, HOME_MENU_ANIMATION_LOCK_MS);
    }

    function openSidebar() {
      if (!homeMenuPanel || !homeMenuButton || sidebarAnimating) {
        return;
      }
      updateSidebarPermissions();
      if (!homeMenuOverlay?.hidden || homeMenuPanel.classList.contains('is-open')) {
        return;
      }
      if (homeMenuCloseTimer) {
        window.clearTimeout(homeMenuCloseTimer);
        homeMenuCloseTimer = null;
      }
      if (!homeMenuOverlay) {
        return;
      }
      sidebarAnimating = true;
      homeMenuOverlay.hidden = false;
      homeMenuPanel.hidden = false;
      document.body.classList.add('sidebar-open');
      homeMenuPanel.classList.remove('is-closing');
      window.requestAnimationFrame(() => {
        if (homeMenuOverlay.hidden) {
          return;
        }
        homeMenuPanel.classList.add('is-open');
      });
      homeMenuOverlay.classList.add('is-open');
      homeMenuButton.setAttribute('aria-expanded', 'true');
      if (!window.history.state?.[homeMenuStateKey]) {
        window.history.pushState({ ...(window.history.state || {}), [homeMenuStateKey]: true }, '');
      }
      window.setTimeout(() => {
        sidebarAnimating = false;
      }, HOME_MENU_ANIMATION_LOCK_MS);
    }


    function downloadSuFile(fileName, content) {
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }

    async function handleImportFile(fileInput) {
      const [file] = Array.from(fileInput.files || []);
      if (!file) {
        fileInput.remove();
        return;
      }

      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const imported = await StorageService.importData(payload);
        if (!imported) {
          UiService.showToast('Fichier .su invalide.');
          return;
        }
        UiService.showToast('Données importées.');
      } catch (_error) {
        UiService.showToast('Importation impossible.');
      } finally {
        fileInput.value = '';
        fileInput.remove();
      }
    }

    function exportAllData() {
      const payload = StorageService.exportData();
      const serialized = JSON.stringify(payload, null, 2);
      downloadSuFile(formatExportFileName(), serialized);
      UiService.showToast('Exportation des données lancée.');
    }

    function openImportFilePicker() {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.su,.json,application/json';
      fileInput.hidden = true;
      fileInput.tabIndex = -1;
      fileInput.setAttribute('aria-hidden', 'true');
      fileInput.addEventListener(
        'change',
        () => {
          handleImportFile(fileInput);
        },
        { once: true },
      );
      document.body.appendChild(fileInput);

      try {
        if (typeof fileInput.showPicker === 'function') {
          fileInput.showPicker();
          return;
        }
      } catch (_error) {
        // Certains navigateurs refusent showPicker sur certains contextes.
      }

      fileInput.click();
    }

    function ensureSiteActionBottomSheet() {
      let overlay = document.getElementById('siteActionSheetOverlay');
      if (overlay) {
        return overlay;
      }

      overlay = document.createElement('div');
      overlay.id = 'siteActionSheetOverlay';
      overlay.className = 'bottom-sheet-overlay item-action-sheet-overlay';
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="bottom-sheet item-action-sheet" id="siteActionSheet" role="dialog" aria-modal="true" aria-label="Actions du site">
          <div class="bottom-sheet__handle" aria-hidden="true"></div>
          <p class="item-action-sheet__title" id="siteActionSheetTitle">Actions</p>
          <div class="item-action-sheet__content">
            <button type="button" class="item-action-sheet__row" id="siteActionLockToggleButton">
              <img src="Icon/cle.png" alt="" aria-hidden="true" class="item-action-sheet__icon" />
              <span id="siteActionLockToggleLabel">Verrouiller</span>
            </button>
            <div class="item-action-sheet__divider" aria-hidden="true"></div>
            <button type="button" class="item-action-sheet__row" id="siteActionEditNameButton">
              <img src="Icon/crayon-de-blog.png" alt="" aria-hidden="true" class="item-action-sheet__icon" />
              <span>Modifier le nom</span>
            </button>
            <div class="item-action-sheet__divider" aria-hidden="true"></div>
            <button type="button" class="item-action-sheet__row item-action-sheet__row--danger" id="siteActionDeleteButton">
              <img src="Icon/poubelle.png" alt="" aria-hidden="true" class="item-action-sheet__icon" />
              <span>Supprimer</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      return overlay;
    }

    function ensureSiteDeleteConfirmationDialog() {
      let overlay = document.getElementById('siteDeleteConfirmOverlay');
      if (overlay) {
        return overlay;
      }

      overlay = document.createElement('div');
      overlay.id = 'siteDeleteConfirmOverlay';
      overlay.className = 'maintenance-overlay item-delete-confirm-overlay';
      overlay.hidden = true;
      overlay.innerHTML = `
        <article class="maintenance-card item-delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="siteDeleteConfirmTitle">
          <h3 id="siteDeleteConfirmTitle">Supprimer ce site ?</h3>
          <p id="siteDeleteConfirmText">Cette action est irréversible.</p>
          <div class="modal-actions item-delete-confirm-actions">
            <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--cancel" id="siteDeleteCancelButton">Annuler</button>
            <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--danger" id="siteDeleteConfirmButton">Supprimer</button>
          </div>
        </article>
      `;
      document.body.appendChild(overlay);
      return overlay;
    }

    function askSiteDeleteConfirmation(siteName) {
      const overlay = ensureSiteDeleteConfirmationDialog();
      const text = overlay.querySelector('#siteDeleteConfirmText');
      const cancelButton = overlay.querySelector('#siteDeleteCancelButton');
      const confirmButton = overlay.querySelector('#siteDeleteConfirmButton');
      if (!text || !cancelButton || !confirmButton) {
        return Promise.resolve(false);
      }

      const title = overlay.querySelector('#siteDeleteConfirmTitle');
      const normalizedSiteName = String(siteName || '').trim() || 'inconnu';
      if (title) {
        title.textContent = `Supprimer ce site ${normalizedSiteName} ?`;
      }
      text.textContent = 'Cette action est irréversible.';

      return new Promise((resolve) => {
        const closeAnimationDurationMs = 170;
        let closeAnimationTimer = null;
        let isClosing = false;
        const cleanup = () => {
          if (closeAnimationTimer) {
            window.clearTimeout(closeAnimationTimer);
            closeAnimationTimer = null;
          }
          overlay.hidden = true;
          overlay.classList.remove('is-open');
          overlay.onclick = null;
          cancelButton.onclick = null;
          confirmButton.onclick = null;
          document.removeEventListener('keydown', handleKeyDown);
          siteActionState.closeConfirmation = null;
        };
        const close = (value) => {
          if (isClosing) {
            return;
          }
          isClosing = true;
          overlay.classList.remove('is-open');
          closeAnimationTimer = window.setTimeout(() => {
            cleanup();
            resolve(value);
          }, closeAnimationDurationMs);
        };
        const handleKeyDown = (event) => {
          if (event.key === 'Escape') {
            close(false);
          }
        };

        siteActionState.closeConfirmation = () => close(false);
        cancelButton.onclick = () => close(false);
        confirmButton.onclick = () => close(true);
        overlay.onclick = (event) => {
          if (event.target === overlay) {
            close(false);
          }
        };
        document.addEventListener('keydown', handleKeyDown);
        overlay.hidden = false;
        window.requestAnimationFrame(() => {
          overlay.classList.add('is-open');
        });
      });
    }

    function closeActiveSiteTransientLayer() {
      if (typeof siteActionState.closeConfirmation === 'function') {
        siteActionState.closeConfirmation();
        return true;
      }
      if (typeof siteActionState.closeSheet === 'function') {
        siteActionState.closeSheet({ fromPopState: true });
        return true;
      }
      return false;
    }

    function getLatestSiteState(siteId) {
      if (!siteId) {
        return null;
      }
      return StorageService.getSite(siteId) || currentSites.find((site) => site.id === siteId) || null;
    }

    function openSiteLockActionDialog(siteId) {
      if (!isAuthenticated) {
        return;
      }
      const targetSite = getLatestSiteState(siteId);
      if (isSiteLocked(targetSite)) {
        if (
          !siteLockManageDialog ||
          !siteLockCurrentPasswordInput ||
          !siteLockNewPasswordInput ||
          !siteLockCurrentPasswordError ||
          !siteLockNewPasswordError
        ) {
          return;
        }
        siteIdPendingLockManage = siteId;
        siteLockCurrentPasswordInput.value = '';
        siteLockNewPasswordInput.value = '';
        clearSiteLockManageErrors();
        clearSiteLockManageLoadingStates();
        setPasswordVisibility(siteLockCurrentPasswordInput, siteLockCurrentPasswordToggle, false);
        setPasswordVisibility(siteLockNewPasswordInput, siteLockNewPasswordToggle, false);
        siteLockManageDialog.showModal();
        siteLockCurrentPasswordInput.focus();
        return;
      }

      if (
        !siteLockDialog ||
        !siteLockPasswordInput ||
        !siteLockConfirmPasswordInput ||
        !siteLockPasswordError ||
        !siteLockConfirmPasswordError
      ) {
        return;
      }
      siteIdPendingLock = siteId;
      siteLockPasswordInput.value = '';
      siteLockConfirmPasswordInput.value = '';
      clearSiteLockFieldErrorState(siteLockPasswordInput, siteLockPasswordError);
      clearSiteLockFieldErrorState(siteLockConfirmPasswordInput, siteLockConfirmPasswordError);
      updateSiteLockStrengthIndicator();
      siteLockDialog.showModal();
      siteLockPasswordInput.focus();
    }

    window.addEventListener('popstate', () => {
      if (siteActionState.ignoreNextPopstate) {
        siteActionState.ignoreNextPopstate = false;
        return;
      }
      closeActiveSiteTransientLayer();
    });

    function openSiteActionSheet(siteId) {
      const overlay = ensureSiteActionBottomSheet();
      const sheet = overlay.querySelector('#siteActionSheet');
      const title = overlay.querySelector('#siteActionSheetTitle');
      const lockToggleButton = overlay.querySelector('#siteActionLockToggleButton');
      const lockToggleLabel = overlay.querySelector('#siteActionLockToggleLabel');
      const editNameButton = overlay.querySelector('#siteActionEditNameButton');
      const deleteButton = overlay.querySelector('#siteActionDeleteButton');
      if (!sheet || !title || !lockToggleButton || !lockToggleLabel || !editNameButton || !deleteButton) {
        return;
      }
      const closeTransitionDurationMs = 280;
      const refreshSiteActionSheetContent = () => {
        const latestSite = getLatestSiteState(siteId);
        if (!latestSite) {
          closeSheet();
          return null;
        }

        title.textContent = String(latestSite.nom || '').trim() || 'Actions';
        const siteIsLocked = isSiteLocked(latestSite);
        const canDeleteSite = isAuthenticated && currentPermissions.canDelete && !siteIsLocked;
        lockToggleLabel.textContent = siteIsLocked ? 'Déverrouiller' : 'Verrouiller';
        const canEditSiteName = !siteIsLocked;
        editNameButton.hidden = !canEditSiteName;
        editNameButton.style.display = canEditSiteName ? 'inline-flex' : 'none';
        editNameButton.disabled = !canEditSiteName;
        deleteButton.hidden = !canDeleteSite;
        deleteButton.style.display = canDeleteSite ? 'inline-flex' : 'none';
        deleteButton.disabled = !canDeleteSite;
        return latestSite;
      };

      const clearCloseListeners = () => {
        if (overlay.__closeTimerId) {
          window.clearTimeout(overlay.__closeTimerId);
          overlay.__closeTimerId = null;
        }
        if (overlay.__closeTransitionHandler) {
          overlay.removeEventListener('transitionend', overlay.__closeTransitionHandler);
          overlay.__closeTransitionHandler = null;
        }
      };

      const closeSheet = ({ fromPopState = false } = {}) =>
        new Promise((resolve) => {
          if (overlay.hidden) {
            resolve();
            return;
          }
          let isResolved = false;
          const finish = () => {
            if (isResolved) {
              return;
            }
            isResolved = true;
            clearCloseListeners();
            overlay.hidden = true;
            overlay.classList.remove('is-open');
            siteActionState.activeSiteId = null;
            siteActionState.closeSheet = null;
            siteActionState.refreshSheetContent = null;
            if (siteActionState.hasHistoryEntry && !fromPopState) {
              siteActionState.hasHistoryEntry = false;
              siteActionState.ignoreNextPopstate = true;
              window.history.back();
            } else if (fromPopState) {
              siteActionState.hasHistoryEntry = false;
            }
            resolve();
          };

          overlay.classList.remove('is-open');
          overlay.__closeTransitionHandler = (event) => {
            if (event.target !== overlay && event.target !== sheet) {
              return;
            }
            finish();
          };
          overlay.addEventListener('transitionend', overlay.__closeTransitionHandler);
          overlay.__closeTimerId = window.setTimeout(finish, closeTransitionDurationMs);
        });

      siteActionState.activeSiteId = siteId;
      siteActionState.closeSheet = closeSheet;
      siteActionState.refreshSheetContent = refreshSiteActionSheetContent;
      const activeSite = refreshSiteActionSheetContent();
      if (!activeSite) {
        return;
      }
      lockToggleButton.onclick = async () => {
        await closeSheet();
        openSiteLockActionDialog(siteId);
      };
      editNameButton.onclick = async () => {
        const targetSite = getLatestSiteState(siteId);
        if (isSiteLocked(targetSite)) {
          UiService.showToast('Impossible de modifier le nom tant que le site est verrouillé.');
          refreshSiteActionSheetContent();
          return;
        }
        await closeSheet();
        if (!targetSite || !siteEditNameDialog || !siteEditNameInput) {
          return;
        }
        siteActionState.activeSiteId = siteId;
        siteEditNameInput.value = String(targetSite.nom || '').trim();
        clearTransientError(siteEditNameError);
        clearSiteEditNameErrorState();
        setSiteEditNameLoadingState(false);
        updateSiteEditNameCounter();
        siteEditNameDialog.showModal();
        siteEditNameInput.focus();
      };
      deleteButton.onclick = async () => {
        const latestSiteState = getLatestSiteState(siteId);
        if (!latestSiteState || isSiteLocked(latestSiteState)) {
          UiService.showToast('Suppression impossible tant que le site est verrouillé.');
          refreshSiteActionSheetContent();
          return;
        }
        deleteButton.disabled = true;
        try {
          await closeSheet();
          const shouldDelete = await askSiteDeleteConfirmation(activeSite.nom || 'inconnu');
          if (!shouldDelete) {
            return;
          }
          const removedSnapshot = await StorageService.removeSite(siteId);
          if (!removedSnapshot) {
            UiService.showToast('Suppression impossible.');
            return;
          }
          UiService.showUndoSnackbar('Site supprimé.', async () => {
            const restored = await StorageService.restoreSite(removedSnapshot);
            UiService.showToast(restored ? 'Suppression annulée.' : 'Restauration impossible.');
          });
        } finally {
          deleteButton.disabled = false;
        }
      };

      overlay.onclick = (event) => {
        if (event.target === overlay) {
          closeSheet();
        }
      };

      let touchStartY = null;
      sheet.ontouchstart = (event) => {
        touchStartY = event.touches[0]?.clientY ?? null;
      };
      sheet.ontouchend = (event) => {
        if (touchStartY === null) {
          return;
        }
        const touchEndY = event.changedTouches[0]?.clientY ?? touchStartY;
        if (touchEndY - touchStartY > 60) {
          closeSheet();
        }
        touchStartY = null;
      };

      overlay.hidden = false;
      clearCloseListeners();
      if (!siteActionState.hasHistoryEntry) {
        window.history.pushState({ siteActionSheet: true }, '');
        siteActionState.hasHistoryEntry = true;
      }
      window.requestAnimationFrame(() => {
        overlay.classList.add('is-open');
      });
    }

    function renderSites() {
      const query = searchInput.value.trim().toUpperCase();
      const sites = currentSites.filter((site) => String(site.nom || '').toUpperCase().includes(query));
      siteCount.textContent = String(sites.length);

      if (!sites.length) {
        UiService.renderEmptyState(
          siteList,
          query ? 'Aucun site ne correspond à votre recherche.' : 'Aucun site enregistré pour le moment.',
        );
        return;
      }

      siteList.innerHTML = sites
        .map((site) => {
          const outCount = itemCountsBySite[site.id] || 0;
          const createdDateTime = buildDateAndTimeLabel(site?.dateCreation);
          const createdBy = resolveActorLabel(site?.createdBy, userNamesById, site?.createdByName);
          const lockIconSrc = isSiteLocked(site) ? 'Icon/Cadenas_close.png' : 'Icon/Cadenas_Open.png';
          const lockActorEmail = isSiteLocked(site)
            ? String(site?.lockedBy || '').trim()
            : String(site?.unlockedBy || '').trim();
          const lockLabel = isSiteLocked(site) ? 'Verrouillé' : 'Déverrouillé';
          const lockLabelWithActor = lockActorEmail ? `${lockLabel} par` : lockLabel;
          const canShowSiteActions = isAuthenticated;
          return `
            <article class="list-card">
              ${canShowSiteActions ? `<button class="list-card__menu-button" type="button" data-site-menu="${site.id}" aria-label="Plus d'actions" title="Plus d'actions"><img src="Icon/Trois point.png" alt="" aria-hidden="true" class="list-card__menu-icon" /></button>` : ''}
              <button class="list-card__button" type="button" data-site-open="${site.id}">
                <h3 class="list-card__title">${escapeHtml(site.nom)}</h3>
                <div class="list-card__meta">
                  <span class="list-card__meta-item list-card__meta-item--outs">
                    <img src="Icon/OUT.png" alt="" aria-hidden="true" class="icon" />
                    <span class="outs-count"><span class="outs-number">${outCount}</span><span class="outs-label">OUT${outCount > 1 ? 'S' : ''}</span></span>
                  </span>
                  <span class="list-card__meta-item">
                    <img src="Icon/Date et Heure.png" alt="" aria-hidden="true" class="icon" />
                    <span>Créé le ${escapeHtml(createdDateTime)}</span>
                  </span>
                  <span class="list-card__meta-item">
                    <img src="Icon/Utilisateur.png" alt="" aria-hidden="true" class="icon" />
                    <span>${escapeHtml(createdBy)}</span>
                  </span>
                </div>
                <span class="list-card__divider" aria-hidden="true"></span>
                <span class="list-card__status ${isSiteLocked(site) ? 'list-card__status--locked' : 'list-card__status--unlocked'}">
                  <img src="${lockIconSrc}" alt="" aria-hidden="true" class="list-card__status-icon" />
                  <span class="list-card__status-text">
                    <span class="list-card__status-main">${escapeHtml(lockLabelWithActor)}</span>
                    ${lockActorEmail ? `<span class="list-card__status-actor">${escapeHtml(lockActorEmail)}</span>` : ''}
                  </span>
                </span>
              </button>
            </article>
          `;
        })
        .join('');

      siteList.querySelectorAll('[data-site-open]').forEach((button) => {
        const siteId = button.dataset.siteOpen;

        button.addEventListener('contextmenu', (event) => {
          event.preventDefault();
        });

        button.addEventListener('click', () => {
          const targetSite = getLatestSiteState(siteId);
          if (!isSiteLocked(targetSite)) {
            UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
            return;
          }
          if (!siteUnlockDialog || !siteUnlockPasswordInput || !siteUnlockError) {
            return;
          }
          siteIdPendingUnlock = siteId;
          siteUnlockPasswordInput.value = '';
          clearSiteUnlockFieldErrorState();
          setPasswordVisibility(siteUnlockPasswordInput, siteUnlockPasswordToggle, false);
          setSiteUnlockLoadingState(false);
          siteUnlockDialog.showModal();
          siteUnlockPasswordInput.focus();
        });
      });

      siteList.querySelectorAll('[data-site-menu]').forEach((button) => {
        button.addEventListener('click', () => {
          openSiteActionSheet(button.dataset.siteMenu);
        });
      });
    }

    if (homeMenuButton && homeMenuPanel && homeMenuOverlay) {
      homeMenuButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSidebar();
      });


      homeMenuPanel.addEventListener('click', (event) => {
        event.stopPropagation();
      });

      homeMenuPanel.addEventListener('touchstart', (event) => {
        if (!homeMenuPanel.classList.contains('is-open') || sidebarAnimating) {
          return;
        }
        touchStartX = event.touches[0].clientX;
        touchCurrentX = touchStartX;
        sidebarWidth = homeMenuPanel.offsetWidth || 0;
        isDraggingSidebar = true;
        homeMenuPanel.style.transition = 'none';
      }, { passive: true });

      homeMenuPanel.addEventListener('touchmove', (event) => {
        if (!isDraggingSidebar || !sidebarWidth) {
          return;
        }
        touchCurrentX = event.touches[0].clientX;
        const deltaX = touchCurrentX - touchStartX;
        if (deltaX < 0) {
          const translateX = Math.max(deltaX, -sidebarWidth);
          homeMenuPanel.style.transform = `translateX(${translateX}px)`;
          const progress = Math.min(Math.abs(deltaX) / sidebarWidth, 1);
          homeMenuOverlay.style.opacity = String(1 - progress * 0.45);
        }
      }, { passive: true });

      homeMenuPanel.addEventListener('touchend', () => {
        if (!isDraggingSidebar) {
          return;
        }
        isDraggingSidebar = false;
        const deltaX = touchCurrentX - touchStartX;
        homeMenuPanel.style.transition = '';
        homeMenuOverlay.style.opacity = '';
        if (Math.abs(deltaX) > sidebarWidth * 0.35 && deltaX < 0) {
          closeSidebar();
          return;
        }
        homeMenuPanel.style.transform = '';
      });

      homeMenuPanel.addEventListener('touchcancel', () => {
        isDraggingSidebar = false;
        homeMenuPanel.style.transition = '';
        homeMenuPanel.style.transform = '';
        homeMenuOverlay.style.opacity = '';
      });

      homeMenuOverlay.addEventListener('click', closeSidebar);

      homeMenuCloseButton?.addEventListener('click', closeSidebar);
      window.addEventListener('popstate', () => {
        if (!homeMenuOverlay?.hidden) {
          closeSidebar();
        }
      });
    }

    function setActiveSidebarItem(targetItem) {
      sidebarItems.forEach((item) => item.classList.remove('active'));
      if (targetItem) {
        targetItem.classList.add('active');
      }
    }

    if (sidebarItems.length) {
      const currentPage = window.location.pathname;
      let activeItemFromPage = null;

      sidebarItems.forEach((item) => {
        const link = String(item.getAttribute('data-link') || '').trim();
        if (link && currentPage.includes(link)) {
          activeItemFromPage = item;
        }
        item.addEventListener('click', () => {
          setActiveSidebarItem(item);
        });
      });

      setActiveSidebarItem(activeItemFromPage);
    }

    function openHistory() {
      window.location.href = 'historiques.html';
    }

    function openImportModal() {
      openImportFilePicker();
    }

    function openUserManagement() {
      window.location.href = 'users.html';
    }

    let sidebarActionRunning = false;
    function runSidebarAction(action) {
      if (sidebarActionRunning) {
        return;
      }

      sidebarActionRunning = true;
      closeSidebar();

      window.setTimeout(() => {
        action();
        sidebarActionRunning = false;
      }, 200);
    }

    if (exportDataButton) {
      exportDataButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        runSidebarAction(exportAllData);
      });
    }

    if (importDataButton) {
      importDataButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        runSidebarAction(openImportModal);
      });
    }
    if (usersSidebarBtn) {
      usersSidebarBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign('users.html');
      });
    }


    if (allMaterialsSidebarBtn) {
      allMaterialsSidebarBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign('materiels.html');
      });
    }

    if (historySidebarBtn) {
      historySidebarBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign('historiques.html');
      });
    }

    const openCreateSite = requireElement('openCreateSite');

    function mettreAJourHeaderUtilisateur(authUser) {
      const authUserData = normalizeAuthUserData(authUser);
      renderHomeAccessControls({
        authUser: authUserData,
        onAvatarClick: () => openAvatarBottomSheet(authUserData),
      });
    }

    function getCurrentUserRole() {
      if (currentPermissions?.isAdmin) {
        return 'admin';
      }
      if (currentPermissions?.isStandard) {
        return 'standard';
      }
      return 'limite';
    }

    function setSidebarItemVisible(selector, visible) {
      const el = document.querySelector(selector);
      if (!el) {
        return;
      }
      el.hidden = !visible;
      el.style.display = visible ? 'flex' : 'none';
    }

    function updateSidebarPermissions() {
      const user = firebaseAuth.currentUser;
      const role = getCurrentUserRole();
      const isConnected = Boolean(user);
      const normalizedRole = String(role || '').toLowerCase();
      const isAdmin = normalizedRole === 'admin';
      const isStandard = normalizedRole === 'standard';
      const isLimited = normalizedRole === 'limité' || normalizedRole === 'limite' || normalizedRole === 'limited';

      setSidebarItemVisible('#sidebarHistoryBtn', true);
      setSidebarItemVisible('#sidebarAllMaterialsBtn', isConnected);

      if (!isConnected || isLimited) {
        setSidebarItemVisible('#sidebarImportBtn', false);
        setSidebarItemVisible('#sidebarExportBtn', false);
        setSidebarItemVisible('#sidebarUsersBtn', false);
        return;
      }

      if (isStandard) {
        setSidebarItemVisible('#sidebarImportBtn', true);
        setSidebarItemVisible('#sidebarExportBtn', true);
        setSidebarItemVisible('#sidebarUsersBtn', false);
        return;
      }

      if (isAdmin) {
        setSidebarItemVisible('#sidebarImportBtn', true);
        setSidebarItemVisible('#sidebarExportBtn', true);
        setSidebarItemVisible('#sidebarUsersBtn', true);
        return;
      }

      setSidebarItemVisible('#sidebarImportBtn', false);
      setSidebarItemVisible('#sidebarExportBtn', false);
      setSidebarItemVisible('#sidebarUsersBtn', false);
    }

    function mettreAJourPermissionsUI(nextPermissions) {
      currentPermissions = { ...currentPermissions, ...(nextPermissions || {}) };

      if (openCreateSite) {
        openCreateSite.hidden = !isAuthenticated;
      }

      updateSidebarPermissions();

      closeSidebar();
      renderSites();
    }

    mettreAJourHeaderUtilisateur(authState?.authUser || null);
    mettreAJourPermissionsUI(currentPermissions);
    onAuthStateChanged(firebaseAuth, (user) => {
      isAuthenticated = Boolean(user);
      renderUserAvatar(user || null);
      mettreAJourHeaderUtilisateur(user || null);
      mettreAJourPermissionsUI(currentPermissions);
      renderSites();
    });

    openCreateSite?.addEventListener('click', () => {
      if (!currentPermissions.canCreate) {
        UiService.showToast('Action non autorisée.');
        return;
      }
      siteForm.reset();
      clearTransientError(siteFormError);
      clearSiteNameErrorState();
      setSiteCreateLoadingState(false);
      clearSiteNameAvailabilityMessage();
      setSiteCreateSubmitEnabled(false);
      updateSiteNameCounter();
      siteDialog.showModal();
      siteNameInput.focus();
    });

    searchInput.addEventListener('input', renderSites);

    siteNameInput.addEventListener('beforeinput', (event) => {
      const maxLength = getSiteNameMaxLength();
      if (!maxLength || event.inputType.startsWith('delete')) {
        return;
      }

      const selectionStart = siteNameInput.selectionStart ?? siteNameInput.value.length;
      const selectionEnd = siteNameInput.selectionEnd ?? siteNameInput.value.length;
      const selectedLength = Math.max(0, selectionEnd - selectionStart);
      const nextAllowedLength = maxLength - (siteNameInput.value.length - selectedLength);
      if (nextAllowedLength <= 0) {
        event.preventDefault();
      }
    });
    siteEditNameInput?.addEventListener('beforeinput', (event) => {
      const maxLength = getSiteEditNameMaxLength();
      if (!maxLength || event.inputType.startsWith('delete')) {
        return;
      }
      const selectionStart = siteEditNameInput.selectionStart ?? siteEditNameInput.value.length;
      const selectionEnd = siteEditNameInput.selectionEnd ?? siteEditNameInput.value.length;
      const selectedLength = Math.max(0, selectionEnd - selectionStart);
      const nextAllowedLength = maxLength - (siteEditNameInput.value.length - selectedLength);
      if (nextAllowedLength <= 0) {
        event.preventDefault();
      }
    });

    siteNameInput.addEventListener('input', () => {
      updateSiteNameCounter();
      if (siteNameAvailabilityDebounceTimer) {
        window.clearTimeout(siteNameAvailabilityDebounceTimer);
      }
      siteNameAvailabilityDebounceTimer = window.setTimeout(() => {
        validateSiteNameDuringInput();
      }, 200);
    });
    siteEditNameInput?.addEventListener('input', () => {
      clearTransientError(siteEditNameError);
      clearSiteEditNameErrorState();
      updateSiteEditNameCounter();
    });

    siteDialog.addEventListener('close', () => {
      if (siteNameAvailabilityDebounceTimer) {
        window.clearTimeout(siteNameAvailabilityDebounceTimer);
        siteNameAvailabilityDebounceTimer = null;
      }
      clearSiteNameAvailabilityMessage();
      setSiteCreateSubmitEnabled(false);
      setSiteCreateLoadingState(false);
      updateSiteNameCounter();
    });
    siteEditNameDialog?.addEventListener('close', () => {
      clearTransientError(siteEditNameError);
      clearSiteEditNameErrorState();
      setSiteEditNameLoadingState(false);
      updateSiteEditNameCounter();
    });

    siteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isSiteCreationPending) {
        return;
      }
      const name = siteNameInput.value.trim();
      if (!name) {
        showSiteNameError('Veuillez remplir ce champ');
        return;
      }

      if (name.length < 4) {
        showSiteNameError('Le nom doit contenir au moins 4 caractères.');
        return;
      }

      if (isSiteNameAlreadyUsed(name.toLowerCase())) {
        showSiteNameError('Ce nom de site existe déjà.');
        return;
      }

      if (!currentPermissions.canCreate) {
        showSiteNameError('Action non autorisée.');
        return;
      }

      try {
        setSiteCreateLoadingState(true);
        const result = await StorageService.createSite(name);
        if (!result?.ok) {
          showSiteNameError(
            result?.reason === 'duplicate_site'
              ? 'Ce nom de site existe déjà.'
              : 'Création impossible. Vérifiez le nom du site.',
          );
          setSiteCreateLoadingState(false);
          return;
        }

        setSiteCreateLoadingState(false);
        siteDialog.close();
        UiService.showToast('Site créé avec succés.');
      } catch (error) {
        console.error('Erreur lors de la création du site :', error);
        showSiteNameError("Impossible d'enregistrer le site. Vérifiez Firestore et réessayez.");
        setSiteCreateLoadingState(false);
      }
    });
    siteEditNameForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isSiteNameEditPending) {
        return;
      }
      const siteId = siteActionState.activeSiteId;
      const targetSite = getLatestSiteState(siteId);
      if (!siteId || !targetSite) {
        siteEditNameDialog?.close();
        return;
      }
      if (isSiteLocked(targetSite)) {
        siteEditNameDialog?.close();
        UiService.showToast('Impossible de modifier le nom tant que le site est verrouillé.');
        return;
      }
      const currentName = String(targetSite.nom || '').trim();
      const nextName = String(siteEditNameInput?.value || '').trim();
      if (!nextName) {
        showSiteEditNameError('Veuillez entrer un nom de site.');
        return;
      }
      if (nextName.length < 4) {
        showSiteEditNameError('Le nom doit contenir au moins 4 caractères.');
        return;
      }
      if (nextName.length > 25) {
        showSiteEditNameError('Le nom doit contenir au maximum 25 caractères.');
        return;
      }
      if (nextName === currentName) {
        siteEditNameDialog?.close();
        return;
      }
      try {
        setSiteEditNameLoadingState(true);
        const result = await StorageService.updateSiteName(siteId, nextName);
        if (!result?.ok) {
          showSiteEditNameError(result?.reason === 'duplicate_site' ? 'Ce nom de site existe déjà.' : 'Modification impossible.');
          setSiteEditNameLoadingState(false);
          return;
        }
        setSiteEditNameLoadingState(false);
        siteEditNameDialog?.close();
        UiService.showToast('Nom du site mis à jour.');
      } catch (_error) {
        showSiteEditNameError("Impossible d'enregistrer le nom du site.");
        setSiteEditNameLoadingState(false);
      }
    });

    siteLockForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!siteIdPendingLock) {
        return;
      }
      clearSiteLockFieldErrorState(siteLockPasswordInput, siteLockPasswordError);
      clearSiteLockFieldErrorState(siteLockConfirmPasswordInput, siteLockConfirmPasswordError);
      const passwordValue = siteLockPasswordInput?.value || '';
      const confirmValue = siteLockConfirmPasswordInput?.value || '';

      const isPasswordMissing = !passwordValue.trim();
      const isConfirmMissing = !confirmValue.trim();
      if (isPasswordMissing || isConfirmMissing) {
        if (isPasswordMissing) {
          showSiteLockFieldError(siteLockPasswordInput, siteLockPasswordError, 'Veuillez remplir ce champ');
        }
        if (isConfirmMissing) {
          showSiteLockFieldError(siteLockConfirmPasswordInput, siteLockConfirmPasswordError, 'Veuillez remplir ce champ');
        }
        return;
      }

      if (passwordValue !== confirmValue) {
        showSiteLockFieldError(
          siteLockConfirmPasswordInput,
          siteLockConfirmPasswordError,
          'Les mots de passe ne correspondent pas.',
        );
        return;
      }

      try {
        const passwordHash = await hashPassword(passwordValue);
        const result = await StorageService.setSiteLock(siteIdPendingLock, { passwordHash });
        if (!result?.ok) {
          showSiteLockFieldError(siteLockConfirmPasswordInput, siteLockConfirmPasswordError, 'Impossible de verrouiller ce site.');
          return;
        }
        siteLockDialog?.close();
        siteIdPendingLock = null;
        UiService.showToast('Site verrouillé.');
      } catch (_error) {
        showSiteLockFieldError(siteLockConfirmPasswordInput, siteLockConfirmPasswordError, 'Erreur pendant le verrouillage.');
      }
    });

    siteLockPasswordInput?.addEventListener('input', () => {
      clearSiteLockFieldErrorState(siteLockPasswordInput, siteLockPasswordError);
      updateSiteLockStrengthIndicator();
    });

    siteLockConfirmPasswordInput?.addEventListener('input', () => {
      clearSiteLockFieldErrorState(siteLockConfirmPasswordInput, siteLockConfirmPasswordError);
    });

    siteUnlockPasswordInput?.addEventListener('input', () => {
      clearSiteUnlockFieldErrorState();
    });

    siteUnlockPasswordToggle?.addEventListener('click', () => {
      const nextIsVisible = siteUnlockPasswordInput?.type === 'password';
      setPasswordVisibility(siteUnlockPasswordInput, siteUnlockPasswordToggle, nextIsVisible);
    });

    siteLockCurrentPasswordInput?.addEventListener('input', () => {
      clearSiteLockManageFieldErrorState(siteLockCurrentPasswordInput, siteLockCurrentPasswordError);
    });

    siteLockNewPasswordInput?.addEventListener('input', () => {
      clearSiteLockManageFieldErrorState(siteLockNewPasswordInput, siteLockNewPasswordError);
    });

    siteLockCurrentPasswordToggle?.addEventListener('click', () => {
      const nextIsVisible = siteLockCurrentPasswordInput?.type === 'password';
      setPasswordVisibility(siteLockCurrentPasswordInput, siteLockCurrentPasswordToggle, nextIsVisible);
    });

    siteLockNewPasswordToggle?.addEventListener('click', () => {
      const nextIsVisible = siteLockNewPasswordInput?.type === 'password';
      setPasswordVisibility(siteLockNewPasswordInput, siteLockNewPasswordToggle, nextIsVisible);
    });

    siteUnlockForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!siteIdPendingUnlock || isSiteUnlockPending) {
        return;
      }
      clearSiteUnlockFieldErrorState();
      const passwordValue = siteUnlockPasswordInput?.value || '';
      if (!passwordValue.trim()) {
        showSiteUnlockFieldError('Veuillez entrer le mot de passe.');
        return;
      }

      const targetSite = getLatestSiteState(siteIdPendingUnlock);
      if (!isSiteLocked(targetSite)) {
        setSiteUnlockLoadingState(true);
        siteUnlockDialog?.close();
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteIdPendingUnlock)}`);
        siteIdPendingUnlock = null;
        setSiteUnlockLoadingState(false);
        return;
      }

      try {
        setSiteUnlockLoadingState(true);
        const passwordHash = await hashPassword(passwordValue);
        if (passwordHash !== targetSite.passwordHash) {
          showSiteUnlockFieldError('Mot de passe incorrect.');
          setSiteUnlockLoadingState(false);
          return;
        }
        const openSiteId = siteIdPendingUnlock;
        siteUnlockDialog?.close();
        siteIdPendingUnlock = null;
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(openSiteId)}`);
      } catch (_error) {
        showSiteUnlockFieldError('Erreur pendant la vérification.');
        setSiteUnlockLoadingState(false);
      }
    });

    siteLockManageForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!siteIdPendingLockManage) {
        return;
      }

      const submittedAction = event.submitter?.dataset?.lockManageAction === 'unlock' ? 'unlock' : 'update';
      if (
        (submittedAction === 'unlock' && isSiteLockManageUnlockPending) ||
        (submittedAction === 'update' && isSiteLockManageUpdatePending)
      ) {
        return;
      }

      clearSiteLockManageErrors();

      const currentPasswordValue = siteLockCurrentPasswordInput?.value || '';
      const newPasswordValue = siteLockNewPasswordInput?.value || '';
      const targetSite = getLatestSiteState(siteIdPendingLockManage);
      if (!isSiteLocked(targetSite)) {
        clearSiteLockManageLoadingStates();
        siteLockManageDialog?.close();
        siteIdPendingLockManage = null;
        return;
      }

      if (!currentPasswordValue.trim()) {
        showSiteLockManageFieldError(
          siteLockCurrentPasswordInput,
          siteLockCurrentPasswordError,
          'Veuillez remplir ce champ',
        );
        return;
      }

      if (submittedAction === 'update' && !newPasswordValue.trim()) {
        showSiteLockManageFieldError(siteLockNewPasswordInput, siteLockNewPasswordError, 'Veuillez remplir ce champ');
        return;
      }

      try {
        setSiteLockManageActionLoadingState(submittedAction, true);
        const currentPasswordHash = await hashPassword(currentPasswordValue);
        if (currentPasswordHash !== targetSite.passwordHash) {
          showSiteLockManageFieldError(
            siteLockCurrentPasswordInput,
            siteLockCurrentPasswordError,
            'Mot de passe actuel incorrect.',
          );
          setSiteLockManageActionLoadingState(submittedAction, false);
          return;
        }

        if (submittedAction === 'unlock') {
          const result = await StorageService.clearSiteLock(siteIdPendingLockManage);
          if (!result?.ok) {
            showSiteLockManageFieldError(
              siteLockCurrentPasswordInput,
              siteLockCurrentPasswordError,
              'Impossible de retirer le verrouillage.',
            );
            setSiteLockManageActionLoadingState('unlock', false);
            return;
          }
          siteLockManageDialog?.close();
          siteIdPendingLockManage = null;
          UiService.showToast('Le verrouillage a été retiré avec succès.');
          return;
        }

        const nextPasswordHash = await hashPassword(newPasswordValue);
        const result = await StorageService.setSiteLock(siteIdPendingLockManage, { passwordHash: nextPasswordHash });
        if (!result?.ok) {
          showSiteLockManageFieldError(
            siteLockNewPasswordInput,
            siteLockNewPasswordError,
            'Impossible de mettre à jour le mot de passe.',
          );
          setSiteLockManageActionLoadingState('update', false);
          return;
        }
        siteLockManageDialog?.close();
        siteIdPendingLockManage = null;
        UiService.showToast('Le mot de passe a été mis à jour avec succès.');
      } catch (_error) {
        if (submittedAction === 'unlock') {
          showSiteLockManageFieldError(
            siteLockCurrentPasswordInput,
            siteLockCurrentPasswordError,
            'Erreur pendant la gestion du mot de passe.',
          );
          setSiteLockManageActionLoadingState('unlock', false);
          return;
        }
        showSiteLockManageFieldError(
          siteLockNewPasswordInput,
          siteLockNewPasswordError,
          'Erreur pendant la gestion du mot de passe.',
        );
        setSiteLockManageActionLoadingState('update', false);
      }
    });

    siteLockDialog?.addEventListener('close', () => {
      siteIdPendingLock = null;
      clearSiteLockFieldErrorState(siteLockPasswordInput, siteLockPasswordError);
      clearSiteLockFieldErrorState(siteLockConfirmPasswordInput, siteLockConfirmPasswordError);
      updateSiteLockStrengthIndicator();
    });

    siteUnlockDialog?.addEventListener('close', () => {
      siteIdPendingUnlock = null;
      clearSiteUnlockFieldErrorState();
      setPasswordVisibility(siteUnlockPasswordInput, siteUnlockPasswordToggle, false);
      setSiteUnlockLoadingState(false);
    });

    siteLockManageDialog?.addEventListener('close', () => {
      siteIdPendingLockManage = null;
      clearSiteLockManageErrors();
      clearSiteLockManageLoadingStates();
      setPasswordVisibility(siteLockCurrentPasswordInput, siteLockCurrentPasswordToggle, false);
      setPasswordVisibility(siteLockNewPasswordInput, siteLockNewPasswordToggle, false);
    });

    StorageService.subscribeSites(
      (sites) => {
        currentSites = sites;
        renderSites();
        if (siteActionState.activeSiteId && typeof siteActionState.refreshSheetContent === 'function') {
          siteActionState.refreshSheetContent();
        }
      },
      () => {
        UiService.showToast('Synchronisation indisponible.');
      },
    );

    StorageService.subscribeItemCounts(
      (counts) => {
        itemCountsBySite = counts;
        renderSites();
      },
      () => {
        UiService.showToast('Comptage des sous-éléments indisponible.');
      },
    );

    loadUserNames();
  }

  function initSiteDetailPage(permissions) {
    initAuthRequiredNoticeCard();

    const params = UiService.getQueryParams();
    const siteId = params.get('siteId');
    if (!siteId) {
      UiService.navigate('index.html');
      return;
    }

    const siteTitle = requireElement('siteTitle');
    const itemList = requireElement('itemList');
    const itemCount = requireElement('itemCount');
    const itemDialog = requireElement('itemDialog');
    const itemForm = requireElement('itemForm');
    const itemNumberInput = requireElement('itemNumberInput');
    const itemStoreSelect = requireElement('itemStoreSelect');
    const itemStoreOtherGroup = requireElement('itemStoreOtherGroup');
    const itemStoreOtherInput = requireElement('itemStoreOtherInput');
    const itemNumberCounter = requireElement('itemNumberCounter');
    const itemFormError = requireElement('itemFormError');
    const itemCreateSubmitButton = requireElement('itemCreateSubmitButton');
    const openExportItems = requireElement('openExportItems');
    const siteExportDialog = requireElement('siteExportDialog');
    const siteExportForm = requireElement('siteExportForm');
    const siteExportFileNameInput = requireElement('siteExportFileNameInput');
    const siteExportFileNameError = requireElement('siteExportFileNameError');
    const siteExportSubmitButton = requireElement('siteExportSubmitButton');
    const siteExportCancelButton = requireElement('siteExportCancelButton');
    const itemSearchInput = requireElement('itemSearchInput');
    const itemDateFilter = requireElement('itemDateFilter');
    const itemDialogTitle = itemDialog?.querySelector('.modal-header h2');
    const itemNumberLabel = itemDialog?.querySelector('.input-group--item-create > span');

    let currentSite = StorageService.getSite(siteId);
    let currentItems = [];
    let detailCountsByItem = {};
    let detailDesignationsByItem = {};
    let detailRowsByItem = {};
    let userNamesById = {};
    const itemActionState = {
      activeItemId: null,
      closeSheet: null,
      closeConfirmation: null,
      hasHistoryEntry: false,
      ignoreNextPopstate: false,
    };
    const dateFilterStorageKey = `site-detail:item-date-filter:${siteId}`;
    const searchStorageKey = `site-detail:item-search:${siteId}`;
    const filterChipButtons = Array.from(document.querySelectorAll('[data-filter-chip]'));
    let selectedDateFilter = window.localStorage.getItem(dateFilterStorageKey) || 'all';
    itemSearchInput.value = window.localStorage.getItem(searchStorageKey) || '';

    siteTitle.textContent = currentSite ? currentSite.nom : 'Chargement...';


    async function loadUserNames() {
      try {
        const users = await StorageService.listUsers();
        userNamesById = users.reduce((accumulator, user) => {
          if (user?.id) {
            accumulator[user.id] = user.username || 'Utilisateur';
          }
          return accumulator;
        }, {});
      } catch (_error) {
        userNamesById = {};
      }
      renderItems();
    }

    function formatSiteExportUnit(unit) {
      const normalizedUnit = String(unit || '').trim().toLowerCase();
      if (normalizedUnit === 'pcs') {
        return 'pcs';
      }
      return normalizedUnit || 'm';
    }

    function buildSiteExportRows() {
      const itemsWithLines = currentItems.filter((item) => Number(detailCountsByItem[item.id] || 0) > 0);
      return itemsWithLines.flatMap((item) =>
        (detailRowsByItem[item.id] || []).map((detail) => ({
          out: item.numero,
          champ: detail.champ,
          code: detail.code,
          designation: detail.designation,
          qteSortie: detail.qteSortie,
          unite: formatSiteExportUnit(detail.unite),
          qtePosee: detail.qtePosee,
          qteRetour: detail.qteRetour,
          observation: detail.observation,
        })),
      );
    }

    async function exportItems(fileNameOverride) {
      if (!currentSite) {
        UiService.navigate('index.html');
        return;
      }

      let rows = buildSiteExportRows();
      if (!rows.length) {
        try {
          detailRowsByItem = await StorageService.getDetailRowsBySite(siteId);
          rows = buildSiteExportRows();
        } catch (_error) {
          // On conserve le comportement actuel: un toast utilisateur si aucune donnée exploitable.
        }
      }
      if (!rows.length) {
        UiService.showToast('Aucune donnée');
        return;
      }

      const sortedRows = [...rows].sort((a, b) => {
        const designationA = String(a?.designation || '').trim();
        const designationB = String(b?.designation || '').trim();

        if (!designationA && !designationB) {
          return 0;
        }
        if (!designationA) {
          return 1;
        }
        if (!designationB) {
          return -1;
        }

        const byDesignation = designationA.localeCompare(designationB, 'fr', {
          sensitivity: 'base',
          numeric: true,
        });
        if (byDesignation !== 0) {
          return byDesignation;
        }

        const outA = String(a?.out || '').trim();
        const outB = String(b?.out || '').trim();
        const byOut = outA.localeCompare(outB, 'fr', {
          sensitivity: 'base',
          numeric: true,
        });
        if (byOut !== 0) {
          return byOut;
        }

        const codeA = String(a?.code || '').trim();
        const codeB = String(b?.code || '').trim();
        return codeA.localeCompare(codeB, 'fr', {
          sensitivity: 'base',
          numeric: true,
        });
      });

      const title = `SUIVI MATERIEL . ${currentSite.nom}`;
      const workbook = buildSiteExcelContent(title, sortedRows);
      const fileBaseName = normalizeExportBaseName(fileNameOverride || title, title);
      downloadExcelFile(`${fileBaseName}.xls`, 'Export Excel', workbook);
      saveExportFileNameToHistory(fileBaseName);
    }

    function updateSiteExportSubmitState() {
      if (!siteExportSubmitButton || !siteExportFileNameInput) {
        return;
      }
      const hasValue = Boolean(String(siteExportFileNameInput.value || '').trim());
      siteExportSubmitButton.disabled = !hasValue;
      if (siteExportFileNameError) {
        siteExportFileNameError.textContent = hasValue ? '' : 'Veuillez entrer un nom de fichier.';
      }
    }

    function closeSiteExportDialog() {
      if (siteExportFileNameError) {
        siteExportFileNameError.textContent = '';
      }
      if (siteExportSubmitButton) {
        siteExportSubmitButton.disabled = false;
        siteExportSubmitButton.classList.remove('is-loading');
      }
      siteExportDialog?.close();
    }

    function openSiteExportDialog() {
      if (!siteExportDialog || !siteExportFileNameInput) {
        exportItems();
        return;
      }
      const defaultName = currentSite?.nom ? `SUIVI MATERIEL . ${currentSite.nom}` : 'export-materiel';
      siteExportFileNameInput.value = sanitizeExportFileName(defaultName);
      if (siteExportFileNameError) {
        siteExportFileNameError.textContent = '';
      }
      if (siteExportSubmitButton) {
        siteExportSubmitButton.classList.remove('is-loading');
      }
      updateSiteExportSubmitState();
      siteExportDialog.showModal();
      window.setTimeout(() => {
        siteExportFileNameInput.focus();
        siteExportFileNameInput.select();
      }, 40);
    }

    function ensureItemActionBottomSheet() {
      let overlay = document.getElementById('itemActionSheetOverlay');
      if (overlay) {
        return overlay;
      }

      overlay = document.createElement('div');
      overlay.id = 'itemActionSheetOverlay';
      overlay.className = 'bottom-sheet-overlay item-action-sheet-overlay';
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="bottom-sheet item-action-sheet" id="itemActionSheet" role="dialog" aria-modal="true" aria-label="Actions de l'élément">
          <div class="bottom-sheet__handle" aria-hidden="true"></div>
          <p class="item-action-sheet__title" id="itemActionSheetTitle">Actions</p>
          <div class="item-action-sheet__content">
            <button type="button" class="item-action-sheet__row" id="itemActionEditNameButton">
              <img src="Icon/crayon-de-blog.png" alt="" aria-hidden="true" class="item-action-sheet__icon" />
              <span>Modifier le nom</span>
            </button>
            <button type="button" class="item-action-sheet__row item-action-sheet__row--danger" id="itemActionDeleteButton">
              <img src="Icon/poubelle.png" alt="" aria-hidden="true" class="item-action-sheet__icon" />
              <span>Supprimer</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      return overlay;
    }

    function ensureItemDeleteConfirmationDialog() {
      let overlay = document.getElementById('itemDeleteConfirmOverlay');
      if (overlay) {
        return overlay;
      }

      overlay = document.createElement('div');
      overlay.id = 'itemDeleteConfirmOverlay';
      overlay.className = 'maintenance-overlay item-delete-confirm-overlay';
      overlay.hidden = true;
      overlay.innerHTML = `
        <article class="maintenance-card item-delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="itemDeleteConfirmTitle">
          <h3 id="itemDeleteConfirmTitle">Supprimer cet OUT ?</h3>
          <p id="itemDeleteConfirmText">Cette action peut être annulée depuis la notification.</p>
          <div class="modal-actions item-delete-confirm-actions">
            <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--cancel" id="itemDeleteCancelButton">Annuler</button>
            <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--danger" id="itemDeleteConfirmButton">Supprimer</button>
          </div>
        </article>
      `;
      document.body.appendChild(overlay);
      return overlay;
    }

    function askItemDeleteConfirmation(itemLabel) {
      const overlay = ensureItemDeleteConfirmationDialog();
      const text = overlay.querySelector('#itemDeleteConfirmText');
      const cancelButton = overlay.querySelector('#itemDeleteCancelButton');
      const confirmButton = overlay.querySelector('#itemDeleteConfirmButton');
      if (!text || !cancelButton || !confirmButton) {
        return Promise.resolve(false);
      }

      const title = overlay.querySelector('#itemDeleteConfirmTitle');
      const normalizedLabel = String(itemLabel || '').trim() || 'OUT inconnu';
      if (title) {
        title.textContent = `Supprimer cet ${normalizedLabel} ?`;
      }
      text.textContent = 'Confirmer si OUI .';

      return new Promise((resolve) => {
        const closeAnimationDurationMs = 170;
        let closeAnimationTimer = null;
        let isClosing = false;
        const cleanup = () => {
          if (closeAnimationTimer) {
            window.clearTimeout(closeAnimationTimer);
            closeAnimationTimer = null;
          }
          overlay.hidden = true;
          overlay.classList.remove('is-open');
          overlay.onclick = null;
          cancelButton.onclick = null;
          confirmButton.onclick = null;
          document.removeEventListener('keydown', handleKeyDown);
          itemActionState.closeConfirmation = null;
        };
        const close = (value) => {
          if (isClosing) {
            return;
          }
          isClosing = true;
          overlay.classList.remove('is-open');
          closeAnimationTimer = window.setTimeout(() => {
            cleanup();
            resolve(value);
          }, closeAnimationDurationMs);
        };
        const handleKeyDown = (event) => {
          if (event.key === 'Escape') {
            close(false);
          }
        };

        itemActionState.closeConfirmation = () => close(false);
        cancelButton.onclick = () => close(false);
        confirmButton.onclick = () => close(true);
        overlay.onclick = (event) => {
          if (event.target === overlay) {
            close(false);
          }
        };
        document.addEventListener('keydown', handleKeyDown);
        overlay.hidden = false;
        window.requestAnimationFrame(() => {
          overlay.classList.add('is-open');
        });
      });
    }

    function closeActiveTransientLayer() {
      if (typeof itemActionState.closeConfirmation === 'function') {
        itemActionState.closeConfirmation();
        return true;
      }
      if (typeof itemActionState.closeSheet === 'function') {
        itemActionState.closeSheet({ fromPopState: true });
        return true;
      }
      return false;
    }

    window.addEventListener('popstate', () => {
      if (itemActionState.ignoreNextPopstate) {
        itemActionState.ignoreNextPopstate = false;
        return;
      }
      closeActiveTransientLayer();
    });

    function openItemActionSheet(itemId) {
      const overlay = ensureItemActionBottomSheet();
      const sheet = overlay.querySelector('#itemActionSheet');
      const title = overlay.querySelector('#itemActionSheetTitle');
      const editNameButton = overlay.querySelector('#itemActionEditNameButton');
      const deleteButton = overlay.querySelector('#itemActionDeleteButton');
      if (!sheet || !title || !editNameButton || !deleteButton) {
        return;
      }

      const activeItem = currentItems.find((item) => item.id === itemId);
      if (!activeItem) {
        return;
      }

      itemActionState.activeItemId = itemId;
      title.textContent = String(activeItem.numero || '').trim() || 'Actions';
      const closeTransitionDurationMs = 280;

      const clearCloseListeners = () => {
        if (overlay.__closeTimerId) {
          window.clearTimeout(overlay.__closeTimerId);
          overlay.__closeTimerId = null;
        }
        if (overlay.__closeTransitionHandler) {
          overlay.removeEventListener('transitionend', overlay.__closeTransitionHandler);
          overlay.__closeTransitionHandler = null;
        }
      };

      const closeSheet = ({ fromPopState = false } = {}) =>
        new Promise((resolve) => {
          if (overlay.hidden) {
            resolve();
            return;
          }
          let isResolved = false;
          const finish = () => {
            if (isResolved) {
              return;
            }
            isResolved = true;
            clearCloseListeners();
            overlay.hidden = true;
            overlay.classList.remove('is-open');
            itemActionState.activeItemId = null;
            itemActionState.closeSheet = null;
            if (itemActionState.hasHistoryEntry && !fromPopState) {
              itemActionState.hasHistoryEntry = false;
              itemActionState.ignoreNextPopstate = true;
              window.history.back();
            } else if (fromPopState) {
              itemActionState.hasHistoryEntry = false;
            }
            resolve();
          };

          overlay.classList.remove('is-open');
          overlay.__closeTransitionHandler = (event) => {
            if (event.target !== overlay && event.target !== sheet) {
              return;
            }
            finish();
          };
          overlay.addEventListener('transitionend', overlay.__closeTransitionHandler);
          overlay.__closeTimerId = window.setTimeout(finish, closeTransitionDurationMs);
        });

      itemActionState.closeSheet = closeSheet;
      editNameButton.onclick = async () => {
        await closeSheet();
        const targetItem = currentItems.find((item) => item.id === itemId);
        if (!targetItem) {
          return;
        }
        itemForm.reset();
        clearItemFormError();
        clearItemNumberErrorState();
        hasBlockingItemNumberError = false;
        itemCreateSubmitButton.disabled = false;
        itemCreateSubmitButton.classList.remove('is-loading');
        setItemDialogMode(ITEM_DIALOG_MODE_EDIT, targetItem);
        itemDialog.showModal();
        itemNumberInput.focus();
      };
      deleteButton.onclick = async () => {
        deleteButton.disabled = true;
        try {
          await closeSheet();
          const shouldDelete = await askItemDeleteConfirmation(activeItem.numero || "cet élément");
          if (!shouldDelete) {
            return;
          }
          const removedSnapshot = await StorageService.removeItem(siteId, itemId);
          if (!removedSnapshot) {
            UiService.showToast('Suppression impossible.');
            return;
          }
          UiService.showUndoSnackbar('Élément supprimé.', async () => {
            const restored = await StorageService.restoreItem(removedSnapshot);
            UiService.showToast(restored ? 'Suppression annulée.' : 'Restauration impossible.');
          });
        } finally {
          deleteButton.disabled = false;
        }
      };

      overlay.onclick = (event) => {
        if (event.target === overlay) {
          closeSheet();
        }
      };

      let touchStartY = null;
      sheet.ontouchstart = (event) => {
        touchStartY = event.touches[0]?.clientY ?? null;
      };
      sheet.ontouchend = (event) => {
        if (touchStartY === null) {
          return;
        }
        const touchEndY = event.changedTouches[0]?.clientY ?? touchStartY;
        if (touchEndY - touchStartY > 60) {
          closeSheet();
        }
        touchStartY = null;
      };

      overlay.hidden = false;
      clearCloseListeners();
      if (!itemActionState.hasHistoryEntry) {
        window.history.pushState({ itemActionSheet: true }, '');
        itemActionState.hasHistoryEntry = true;
      }
      window.requestAnimationFrame(() => {
        overlay.classList.add('is-open');
      });
    }

    function renderItems() {
      const query = itemSearchInput.value.trim().toUpperCase();
      const filteredItems = currentItems.filter((item) => {
        if (!itemMatchesDateFilter(item, selectedDateFilter)) {
          return false;
        }
        if (!query) {
          return true;
        }
        const outMatches = String(item.numero || '').toUpperCase().includes(query);
        if (outMatches) {
          return true;
        }
        const itemDesignations = detailDesignationsByItem[item.id] || [];
        return itemDesignations.some((designation) => String(designation || '').toUpperCase().includes(query));
      });

      itemCount.innerHTML = `<span class="outs-number">${filteredItems.length}</span><span class="outs-label">OUT${filteredItems.length > 1 ? 'S' : ''}</span>`;

      if (!filteredItems.length) {
        UiService.renderEmptyState(
          itemList,
          query ? 'Aucun N° OUT Ou Article correspond à votre recherche.' : 'Aucune Article Disponible.',
        );
        return;
      }

      const htmlParts = [];
      let previousLabel = null;
      filteredItems.forEach((item) => {
        const currentLabel = resolveItemPeriodLabel(item);
        if (currentLabel && currentLabel !== previousLabel) {
          htmlParts.push(`
            <div class="list-separator" role="separator" aria-label="${escapeHtml(currentLabel)}">
              <span class="list-separator__label">${escapeHtml(currentLabel)}</span>
            </div>
          `);
        }
        previousLabel = currentLabel;
        const createdBy = resolveActorLabel(item?.createdBy, userNamesById, item?.createdByName);
        const createdLabel = buildDateAndTimeLabel(item?.dateCreation || item?.dateModification);
        htmlParts.push(`
            <article class="list-card">
              ${permissions.canDelete && !permissions.isLecture ? `<button class="list-card__menu-button" type="button" data-item-menu="${item.id}" aria-label="Plus d'actions" title="Plus d'actions"><img src="Icon/Trois point.png" alt="" aria-hidden="true" class="list-card__menu-icon" /></button>` : ''}
              <button class="list-card__button" type="button" data-item-open="${item.id}">
                <h3 class="list-card__title">${escapeHtml(item.numero)}</h3>
                <div class="list-card__meta">
                  <span class="list-card__meta-item list-card__meta-item--article"><img src="Icon/Article.png" alt="" aria-hidden="true" class="icon" /><span class="outs-count"><span class="outs-number">${detailCountsByItem[item.id] || 0}</span><span class="outs-label">Article${(detailCountsByItem[item.id] || 0) > 1 ? 's' : ''}</span></span></span>
                  <span class="list-card__meta-item"><img src="Icon/Date et Heure.png" alt="" aria-hidden="true" class="icon" /><span>Créé le ${escapeHtml(createdLabel)}</span></span>
                  <span class="list-card__meta-item"><img src="Icon/Utilisateur.png" alt="" aria-hidden="true" class="icon" /><span>${escapeHtml(createdBy)}</span></span>
                </div>
              </button>
            </article>
          `);
      });
      itemList.innerHTML = htmlParts.join('');

      itemList.querySelectorAll('[data-item-open]').forEach((button) => {
        button.addEventListener('click', () => {
          UiService.navigate(`page3.html?siteId=${encodeURIComponent(siteId)}&itemId=${encodeURIComponent(button.dataset.itemOpen)}`);
        });
      });

      itemList.querySelectorAll('[data-item-menu]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          openItemActionSheet(button.dataset.itemMenu);
        });
      });
    }

    const openCreateItem = document.querySelector('body[data-page="site-detail"] #openCreateItem');
    const createItemLabel = document.querySelector(
      'body[data-page="site-detail"] .site-detail-fab-label--create',
    );
    const siteDetailFabStack = document.querySelector('body[data-page="site-detail"] .site-detail-fab-stack');
    let itemFormErrorTimeoutId = null;
    let itemNumberErrorClearTimer = null;
    let itemAvailabilityDebounceTimer = null;
    let hasBlockingItemNumberError = false;
    let itemStoreOtherHideTimer = null;
    const itemStoreOtherTransitionDurationMs = 200;
    const ITEM_DIALOG_MODE_CREATE = 'create';
    const ITEM_DIALOG_MODE_EDIT = 'edit';
    let itemDialogMode = ITEM_DIALOG_MODE_CREATE;
    let editingItemId = null;

    function isFirebaseUserAuthenticated(user) {
      return Boolean(user?.uid);
    }

    function updateCreateItemButtonVisibility(user) {
      if (!openCreateItem && !createItemLabel) {
        return;
      }
      const isAuthenticated = isFirebaseUserAuthenticated(user);
      if (openCreateItem) {
        openCreateItem.hidden = !isAuthenticated;
        openCreateItem.style.display = isAuthenticated ? 'inline-flex' : 'none';
      }
      if (createItemLabel) {
        createItemLabel.hidden = !isAuthenticated;
        createItemLabel.style.display = isAuthenticated ? '' : 'none';
      }
      const createButtonRow = openCreateItem?.closest('[data-fab-row="create"]');
      if (createButtonRow) {
        createButtonRow.hidden = !isAuthenticated;
        createButtonRow.style.display = isAuthenticated ? '' : 'none';
      }
    }

    function getItemNumberMaxLength() {
      return itemNumberInput.maxLength > 0 ? itemNumberInput.maxLength : null;
    }

    function normalizeItemNumberInput(rawValue) {
      const normalizedRawValue = String(rawValue || '').trim().replace(/^out-/i, '');
      const digitsOnly = normalizedRawValue.replace(/\D/g, '');
      const maxLength = getItemNumberMaxLength();
      if (!maxLength) {
        return digitsOnly;
      }
      return digitsOnly.slice(0, maxLength);
    }

    function updateItemStoreOtherVisibility(options = {}) {
      if (!itemStoreSelect || !itemStoreOtherGroup) {
        return;
      }
      const immediate = Boolean(options.immediate);
      const shouldShowOtherField = itemStoreSelect.value === 'Autre à préciser';
      if (itemStoreOtherHideTimer) {
        window.clearTimeout(itemStoreOtherHideTimer);
        itemStoreOtherHideTimer = null;
      }

      if (shouldShowOtherField) {
        itemStoreOtherGroup.hidden = false;
        itemStoreOtherGroup.classList.remove('is-hiding');
        window.requestAnimationFrame(() => {
          itemStoreOtherGroup.classList.add('is-visible');
        });
        return;
      }

      if (itemStoreOtherInput) {
        itemStoreOtherInput.value = '';
      }

      if (immediate || itemStoreOtherGroup.hidden) {
        itemStoreOtherGroup.classList.remove('is-visible', 'is-hiding');
        itemStoreOtherGroup.hidden = true;
        return;
      }

      itemStoreOtherGroup.classList.remove('is-visible');
      itemStoreOtherGroup.classList.add('is-hiding');
      itemStoreOtherHideTimer = window.setTimeout(() => {
        itemStoreOtherGroup.hidden = true;
        itemStoreOtherGroup.classList.remove('is-hiding');
        itemStoreOtherHideTimer = null;
      }, itemStoreOtherTransitionDurationMs);
    }

    function resolveItemStoreValue() {
      const selectedValue = String(itemStoreSelect?.value || '').trim();
      if (!selectedValue) {
        return 'None';
      }
      if (selectedValue === 'Autre à préciser') {
        const customStore = String(itemStoreOtherInput?.value || '').trim();
        return customStore || 'None';
      }
      return selectedValue;
    }

    function updateItemNumberCounter() {
      const maxLength = getItemNumberMaxLength();
      const currentLength = itemNumberInput.value.length;
      itemNumberCounter.textContent = `${currentLength} / ${maxLength ?? currentLength}`;

      itemNumberCounter.classList.remove('is-warning', 'is-limit');
      if (!maxLength || maxLength <= 0) {
        return;
      }

      const ratio = currentLength / maxLength;
      if (ratio >= 1) {
        itemNumberCounter.classList.add('is-limit');
      } else if (ratio >= 0.8) {
        itemNumberCounter.classList.add('is-warning');
      }
    }

    function clearItemFormError() {
      if (itemFormErrorTimeoutId) {
        window.clearTimeout(itemFormErrorTimeoutId);
        itemFormErrorTimeoutId = null;
      }
      itemFormError.textContent = '';
      itemFormError.style.color = '';
    }

    function clearItemNumberErrorState() {
      if (itemNumberErrorClearTimer) {
        window.clearTimeout(itemNumberErrorClearTimer);
        itemNumberErrorClearTimer = null;
      }
      itemNumberInput.classList.remove('is-error', 'is-shaking');
    }

    function showItemFormError(message, durationMs = 2300) {
      clearItemNumberErrorState();
      hasBlockingItemNumberError = true;
      setItemFormMessage(message, { autoClearMs: 2000 });
      itemNumberInput.classList.remove('is-shaking');
      // Force un reflow pour rejouer l'animation à chaque nouvelle erreur.
      void itemNumberInput.offsetWidth;
      itemNumberInput.classList.add('is-error', 'is-shaking');
      itemNumberErrorClearTimer = window.setTimeout(() => {
        clearItemNumberErrorState();
      }, durationMs);
    }

    function setItemFormMessage(message, options = {}) {
      const { isSuccess = false, autoClearMs = null } = options;
      clearItemFormError();
      itemFormError.textContent = message;
      itemFormError.style.color = isSuccess ? 'var(--success)' : 'var(--danger)';
      if (autoClearMs && autoClearMs > 0) {
        itemFormErrorTimeoutId = window.setTimeout(() => {
          itemFormError.textContent = '';
          itemFormError.style.color = '';
          itemFormErrorTimeoutId = null;
        }, autoClearMs);
      }
    }

    function setItemCreateButtonState() {
      const value = normalizeItemNumberInput(itemNumberInput.value.trim());
      const isValidLength = value.length >= 4;
      const hasStoreValue = itemDialogMode === ITEM_DIALOG_MODE_EDIT || Boolean(resolveItemStoreValue() !== 'None');
      itemCreateSubmitButton.disabled = hasBlockingItemNumberError || !isValidLength || !hasStoreValue;
    }

    function validateItemNumberAvailability() {
      const normalizedValue = normalizeItemNumberInput(itemNumberInput.value.trim());
      itemNumberInput.value = normalizedValue;

      if (!normalizedValue) {
        hasBlockingItemNumberError = false;
        clearItemNumberErrorState();
        clearItemFormError();
        setItemCreateButtonState();
        return;
      }

      if (normalizedValue.length < 4) {
        hasBlockingItemNumberError = true;
        clearItemNumberErrorState();
        setItemFormMessage('Le numéro OUT doit contenir au moins 4 caractères.');
        setItemCreateButtonState();
        return;
      }

      const fullOutName = `OUT-${normalizedValue}`;
      const exists = currentItems.some((item) => String(item?.numero || '').toUpperCase() === fullOutName.toUpperCase());

      if (exists) {
        hasBlockingItemNumberError = true;
        itemNumberInput.classList.add('is-error');
        itemNumberInput.classList.remove('is-shaking');
        setItemFormMessage('Ce numéro OUT existe déjà.');
      } else {
        hasBlockingItemNumberError = false;
        clearItemNumberErrorState();
        setItemFormMessage('Ce numéro OUT est disponible.', { isSuccess: true });
      }

      setItemCreateButtonState();
    }

    function setItemDialogMode(mode, targetItem = null) {
      itemDialogMode = mode === ITEM_DIALOG_MODE_EDIT ? ITEM_DIALOG_MODE_EDIT : ITEM_DIALOG_MODE_CREATE;
      editingItemId = itemDialogMode === ITEM_DIALOG_MODE_EDIT ? targetItem?.id || null : null;
      itemDialog.classList.toggle('edit-out-modal', itemDialogMode === ITEM_DIALOG_MODE_EDIT);
      if (itemDialogTitle) {
        itemDialogTitle.textContent = itemDialogMode === ITEM_DIALOG_MODE_EDIT ? 'Modifier le nom OUT' : 'Nouveau numéro OUT';
      }
      if (itemNumberLabel) {
        itemNumberLabel.textContent = itemDialogMode === ITEM_DIALOG_MODE_EDIT ? 'Nom OUT' : 'Numéro OUT';
      }
      const defaultLabel = itemCreateSubmitButton?.querySelector('.btn-label-default');
      const loadingLabel = itemCreateSubmitButton?.querySelector('.btn-label-loading');
      if (defaultLabel) {
        defaultLabel.textContent = itemDialogMode === ITEM_DIALOG_MODE_EDIT ? 'Enregistrer' : 'Créer';
      }
      if (loadingLabel) {
        loadingLabel.textContent = itemDialogMode === ITEM_DIALOG_MODE_EDIT ? 'Enregistrement...' : 'Création...';
      }
      if (itemDialogMode === ITEM_DIALOG_MODE_EDIT) {
        itemNumberInput.setAttribute('inputmode', 'numeric');
        itemNumberInput.setAttribute('pattern', '[0-9]*');
        itemNumberInput.placeholder = 'Exemple : 26050200';
        itemNumberInput.value = normalizeItemNumberInput(targetItem?.numero || '');
      } else {
        itemNumberInput.setAttribute('inputmode', 'numeric');
        itemNumberInput.setAttribute('pattern', '[0-9]*');
        itemNumberInput.placeholder = 'Exemple : 26050200';
      }
      itemStoreSelect?.closest('.input-group')?.toggleAttribute('hidden', itemDialogMode === ITEM_DIALOG_MODE_EDIT);
      updateItemNumberCounter();
    }

    updateCreateItemButtonVisibility(firebaseAuth.currentUser);
    onAuthStateChanged(firebaseAuth, (user) => {
      updateCreateItemButtonVisibility(user || null);
    });

    openCreateItem?.addEventListener('click', () => {
      setItemDialogMode(ITEM_DIALOG_MODE_CREATE);
      itemForm.reset();
      clearItemFormError();
      clearItemNumberErrorState();
      hasBlockingItemNumberError = false;
      if (itemAvailabilityDebounceTimer) {
        window.clearTimeout(itemAvailabilityDebounceTimer);
        itemAvailabilityDebounceTimer = null;
      }
      itemCreateSubmitButton.disabled = false;
      itemCreateSubmitButton.classList.remove('is-loading');
      updateItemNumberCounter();
      updateItemStoreOtherVisibility({ immediate: true });
      itemDialog.showModal();
      itemNumberInput.focus();
    });

    itemStoreSelect?.addEventListener('change', () => {
      updateItemStoreOtherVisibility();
      setItemCreateButtonState();
    });

    itemStoreOtherInput?.addEventListener('input', () => {
      setItemCreateButtonState();
    });

    itemNumberInput.addEventListener('beforeinput', (event) => {
      const maxLength = getItemNumberMaxLength();
      if (!maxLength || event.inputType.startsWith('delete')) {
        return;
      }

      const selectionStart = itemNumberInput.selectionStart ?? itemNumberInput.value.length;
      const selectionEnd = itemNumberInput.selectionEnd ?? itemNumberInput.value.length;
      const selectedLength = Math.max(0, selectionEnd - selectionStart);
      const nextAllowedLength = maxLength - (itemNumberInput.value.length - selectedLength);
      if (nextAllowedLength <= 0) {
        event.preventDefault();
      }
    });

    itemNumberInput.addEventListener('paste', (event) => {
      const clipboardText = event.clipboardData?.getData('text') ?? '';
      const sanitizedClipboardText = String(clipboardText).replace(/\D/g, '');
      if (!sanitizedClipboardText) {
        event.preventDefault();
        updateItemNumberCounter();
        return;
      }

      event.preventDefault();
      const maxLength = getItemNumberMaxLength();
      const selectionStart = itemNumberInput.selectionStart ?? itemNumberInput.value.length;
      const selectionEnd = itemNumberInput.selectionEnd ?? itemNumberInput.value.length;
      const selectedLength = Math.max(0, selectionEnd - selectionStart);
      const remainingLength = maxLength
        ? Math.max(0, maxLength - (itemNumberInput.value.length - selectedLength))
        : sanitizedClipboardText.length;
      const insertedValue = sanitizedClipboardText.slice(0, remainingLength);
      itemNumberInput.setRangeText(insertedValue, selectionStart, selectionEnd, 'end');
      updateItemNumberCounter();
    });

    itemNumberInput.addEventListener('input', () => {
      const normalizedValue = normalizeItemNumberInput(itemNumberInput.value);
      if (itemNumberInput.value !== normalizedValue) {
        itemNumberInput.value = normalizedValue;
      }
      updateItemNumberCounter();
      if (itemAvailabilityDebounceTimer) {
        window.clearTimeout(itemAvailabilityDebounceTimer);
      }
      itemAvailabilityDebounceTimer = window.setTimeout(() => {
        validateItemNumberAvailability();
      }, 200);
    });
    updateItemNumberCounter();

    itemDialog.addEventListener('close', () => {
      clearItemFormError();
      clearItemNumberErrorState();
      hasBlockingItemNumberError = false;
      if (itemAvailabilityDebounceTimer) {
        window.clearTimeout(itemAvailabilityDebounceTimer);
        itemAvailabilityDebounceTimer = null;
      }
      itemCreateSubmitButton.classList.remove('is-loading');
      itemCreateSubmitButton.disabled = false;
      updateItemNumberCounter();
      updateItemStoreOtherVisibility({ immediate: true });
      setItemDialogMode(ITEM_DIALOG_MODE_CREATE);
      editingItemId = null;
    });

    if (openExportItems) {
      openExportItems.addEventListener('click', openSiteExportDialog);
    }

    if (siteExportCancelButton) {
      siteExportCancelButton.addEventListener('click', closeSiteExportDialog);
    }

    if (siteExportDialog) {
      siteExportDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeSiteExportDialog();
      });
      siteExportDialog.addEventListener('click', (event) => {
        if (event.target === siteExportDialog) {
          closeSiteExportDialog();
        }
      });
    }

    if (siteExportFileNameInput) {
      siteExportFileNameInput.addEventListener('input', () => {
        updateSiteExportSubmitState();
      });
    }

    if (siteExportForm) {
      siteExportForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!siteExportSubmitButton || siteExportSubmitButton.disabled) {
          return;
        }
        const fileName = sanitizeExportFileName(siteExportFileNameInput?.value || '');
        if (!fileName) {
          updateSiteExportSubmitState();
          return;
        }
        siteExportSubmitButton.disabled = true;
        siteExportSubmitButton.classList.add('is-loading');
        try {
          await exportItems(fileName);
          closeSiteExportDialog();
        } catch (_error) {
          siteExportSubmitButton.disabled = false;
          siteExportSubmitButton.classList.remove('is-loading');
          UiService.showToast('Exportation impossible.');
        }
      });
    }

    if (siteDetailFabStack) {
      const siteDetailScrollContainer = document.querySelector('body[data-page="site-detail"] .page-content');
      let siteDetailScrollTimerId = null;
      const SCROLL_IDLE_DELAY_MS = 180;

      const setFabStackScrollingState = (isScrolling) => {
        siteDetailFabStack.classList.toggle('is-scroll-hidden', isScrolling);
      };

      const handleSiteDetailScroll = () => {
        setFabStackScrollingState(true);
        if (siteDetailScrollTimerId) {
          window.clearTimeout(siteDetailScrollTimerId);
        }
        siteDetailScrollTimerId = window.setTimeout(() => {
          setFabStackScrollingState(false);
          siteDetailScrollTimerId = null;
        }, SCROLL_IDLE_DELAY_MS);
      };

      siteDetailScrollContainer?.addEventListener('scroll', handleSiteDetailScroll, { passive: true });
    }

    itemSearchInput.addEventListener('input', () => {
      window.localStorage.setItem(searchStorageKey, itemSearchInput.value);
      renderItems();
    });

    if (itemDateFilter) {
      if (!itemDateFilter.querySelector(`option[value="${selectedDateFilter}"]`)) {
        selectedDateFilter = 'all';
      }
      itemDateFilter.value = selectedDateFilter;
      const updateFilterChipsState = () => {
        filterChipButtons.forEach((chip) => {
          chip.classList.toggle('is-active', chip.dataset.filterChip === selectedDateFilter);
        });
      };
      updateFilterChipsState();
      filterChipButtons.forEach((chip) => {
        chip.addEventListener('click', () => {
          const nextFilter = chip.dataset.filterChip || 'all';
          if (nextFilter === selectedDateFilter) {
            return;
          }
          selectedDateFilter = nextFilter;
          itemDateFilter.value = selectedDateFilter;
          window.localStorage.setItem(dateFilterStorageKey, selectedDateFilter);
          updateFilterChipsState();
          renderItems();
        });
      });
      itemDateFilter.addEventListener('change', () => {
        selectedDateFilter = itemDateFilter.value || 'all';
        window.localStorage.setItem(dateFilterStorageKey, selectedDateFilter);
        updateFilterChipsState();
        renderItems();
      });
    }

    itemForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (itemCreateSubmitButton.disabled) {
        return;
      }
      const value = normalizeItemNumberInput(itemNumberInput.value.trim());
      itemNumberInput.value = value;
      const maxLength = getItemNumberMaxLength();
      if (itemDialogMode === ITEM_DIALOG_MODE_EDIT) {
        if (!value) {
          showItemFormError('Veuillez entrer un nom OUT.');
          return;
        }
        if (value.length < 4) {
          showItemFormError('Le nom doit contenir au moins 4 caractères.');
          return;
        }
        if (maxLength && value.length > maxLength) {
          showItemFormError(`Le nom OUT ne peut pas dépasser ${maxLength} caractères.`);
          return;
        }
      } else {
        if (!value) {
          showItemFormError('Veuillez remplir ce champ');
          return;
        }
        if (!/^\d+$/.test(value)) {
          showItemFormError('Veuillez saisir des chiffres uniquement.');
          return;
        }
        if (value.length < 4) {
          showItemFormError('Veuillez saisir au moins 4 chiffres.');
          return;
        }
      }
      if (itemDialogMode === ITEM_DIALOG_MODE_CREATE) {
        const fullOutName = `OUT-${value}`;
        const exists = currentItems.some((item) => String(item?.numero || '').toUpperCase() === fullOutName.toUpperCase());
        if (exists) {
          showItemFormError('Ce numéro OUT existe déjà.');
          itemCreateSubmitButton.disabled = true;
          return;
        }
      }
      if (!permissions.canCreate) {
        showItemFormError('Action non autorisée.');
        return;
      }
      itemCreateSubmitButton.disabled = true;
      itemCreateSubmitButton.classList.add('is-loading');
      try {
        const result = itemDialogMode === ITEM_DIALOG_MODE_EDIT
          ? await StorageService.updateItemName(siteId, editingItemId, value)
          : await StorageService.createItem(siteId, value, { magasin: resolveItemStoreValue() });
        if (!result?.ok) {
          showItemFormError(
            result?.reason === 'duplicate_out'
              ? 'Ce N° OUT existe déjà pour ce site.'
              : itemDialogMode === ITEM_DIALOG_MODE_EDIT
                ? 'Modification impossible.'
                : 'Veuillez saisir au moins 4 chiffres.',
          );
          return;
        }
        if (itemDialogMode === ITEM_DIALOG_MODE_EDIT && result?.unchanged) {
          itemDialog.close();
          return;
        }
        clearItemFormError();
        itemCreateSubmitButton.classList.remove('is-loading');
        itemCreateSubmitButton.disabled = false;
        itemDialog.close();
        UiService.showToast(itemDialogMode === ITEM_DIALOG_MODE_EDIT ? 'Nom OUT mis à jour.' : 'N° OUT ajouté .');
      } finally {
        if (itemDialog.open) {
          itemCreateSubmitButton.classList.remove('is-loading');
          itemCreateSubmitButton.disabled = false;
        }
      }
    });

    StorageService.subscribeSites((sites) => {
      currentSite = sites.find((site) => site.id === siteId) || currentSite;
      if (!currentSite) {
        UiService.navigate('index.html');
        return;
      }
      siteTitle.textContent = currentSite.nom;
    });

    StorageService.subscribeItems(
      siteId,
      (items) => {
        currentItems = items;
        renderItems();
        if (itemDialog.open && itemDialogMode === ITEM_DIALOG_MODE_CREATE) {
          validateItemNumberAvailability();
        }
      },
      () => {
        UiService.showToast('Synchronisation  indisponible.');
      },
    );

    StorageService.subscribeDetailCounts(
      siteId,
      (counts) => {
        detailCountsByItem = counts;
        renderItems();
      },
      () => {},
    );

    StorageService.subscribeDetailDesignations(
      siteId,
      (designationsByItem) => {
        detailDesignationsByItem = designationsByItem;
        renderItems();
      },
      () => {},
    );

    StorageService.subscribeDetailRows(
      siteId,
      (rowsByItem) => {
        detailRowsByItem = rowsByItem;
      },
      () => {},
    );

    loadUserNames();
  }

  function initItemDetailPage(permissions) {
    initAuthRequiredNoticeCard();

    const params = UiService.getQueryParams();
    const siteId = params.get('siteId');
    const itemId = params.get('itemId');
    if (!siteId || !itemId) {
      UiService.navigate('index.html');
      return;
    }

    requireElement('itemBackButton').addEventListener('click', () => {
      UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
    });

    const detailForm = requireElement('detailForm');
    const detailFormSection = requireElement('detailFormSection');
    const detailFormError = requireElement('detailFormError');
    const detailFormModal = requireElement('detailFormModal');
    const openDetailFormButton = requireElement('openDetailFormButton');
    const itemDetailFabLabel = document.querySelector('body[data-page="item-detail"] #itemDetailFabLabel');
    const itemDetailFabRow = openDetailFormButton?.closest('[data-fab-row="create"]');
    const cancelDetailFormButton = requireElement('cancelDetailFormButton');
    const detailCreateSubmitButton = requireElement('detailCreateSubmitButton');
    const detailCount = requireElement('detailCount');
    const detailStore = requireElement('detailStore');
    const detailTableBody = requireElement('detailTableBody');
    const detailSearchInput = requireElement('detailSearchInput');
    const clearSearchBtn = document.querySelector('#clearSearchBtn');
    const exportButton = requireElement('exportDetailsButton');
    const detailExportDialog = requireElement('detailExportDialog');
    const detailExportForm = requireElement('detailExportForm');
    const detailExportFileNameInput = requireElement('detailExportFileNameInput');
    const detailExportFileNameError = requireElement('detailExportFileNameError');
    const detailExportSubmitButton = requireElement('detailExportSubmitButton');
    const detailExportCancelButton = requireElement('detailExportCancelButton');
    const codeInput = requireElement('codeInput');
    const codeInputCounter = requireElement('codeInputCounter');
    const codeInputError = requireElement('codeInputError');
    const designationInput = requireElement('designationInput');
    const designationInputCounter = requireElement('designationInputCounter');
    const designationInputError = requireElement('designationInputError');
    const codeSuggestions = requireElement('codeSuggestions');
    const isAuthenticatedUser = Boolean(firebaseAuth.currentUser);
    const canEditDetails = permissions.canEdit && isAuthenticatedUser;

    setupZoomableDetailTable();

    let currentSite = StorageService.getSite(siteId);
    let currentItem = StorageService.getItem(siteId, itemId);
    let currentDetails = [];
    let hasResolvedInitialDetails = false;
    let isDetailSkeletonVisible = false;
    let detailSkeletonTimerId = null;
    let animateNextTableRender = false;
    let codeSuggestionSource = [];
    let visibleCodeSuggestions = [];
    let activeSuggestionIndex = -1;
    let detailFormErrorTimeoutId = null;
    let codeInputErrorTimeoutId = null;
    let designationInputErrorTimeoutId = null;
    let codeInputErrorStateTimeoutId = null;
    let designationInputErrorStateTimeoutId = null;

    function setDetailModalOpenState(isOpen) {
      document.body.classList.toggle('item-detail-modal-open', isOpen);
    }

    function closeDetailModal() {
      if (!detailFormModal?.open) {
        setDetailModalOpenState(false);
        return;
      }
      detailFormModal.close();
      setDetailModalOpenState(false);
      hideCodeSuggestions();
      clearDetailFormError();
      clearDetailRequiredFieldErrors();
    }

    function openDetailModal() {
      if (!detailFormModal || !permissions.canCreate || permissions.isLecture) {
        return;
      }
      detailForm.reset();
      requireElement('uniteInput').value = 'm';
      setDetailFormSavingState(false);
      clearDetailFormError();
      clearDetailRequiredFieldErrors();
      updateDetailInputCounters();
      detailFormModal.showModal();
      setDetailModalOpenState(true);
      window.setTimeout(() => {
        codeInput?.focus();
      }, 60);
    }

    function setDetailFormSavingState(isSaving) {
      if (!detailCreateSubmitButton) {
        return;
      }
      detailCreateSubmitButton.disabled = isSaving;
      detailCreateSubmitButton.classList.toggle('is-loading', isSaving);
    }

    function getInputMaxLength(input) {
      return input?.maxLength > 0 ? input.maxLength : null;
    }

    function enforceInputMaxLength(input) {
      const maxLength = getInputMaxLength(input);
      if (!input || !maxLength || maxLength <= 0) {
        return;
      }
      if (input.value.length > maxLength) {
        input.value = input.value.slice(0, maxLength);
      }
    }

    function updateInputCharCounter(input, counter) {
      if (!input || !counter) {
        return;
      }
      enforceInputMaxLength(input);
      const maxLength = getInputMaxLength(input);
      const currentLength = input.value.length;
      counter.textContent = `${currentLength} / ${maxLength ?? currentLength}`;
      counter.classList.remove('is-warning', 'is-limit');
      if (!maxLength || maxLength <= 0) {
        return;
      }
      const ratio = currentLength / maxLength;
      if (ratio >= 1) {
        counter.classList.add('is-limit');
      } else if (ratio >= 0.8) {
        counter.classList.add('is-warning');
      }
    }

    function enforceMaxLengthOnBeforeInput(event, input) {
      const maxLength = getInputMaxLength(input);
      if (!input || !maxLength || event.inputType.startsWith('delete')) {
        return;
      }
      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? input.value.length;
      const selectedLength = Math.max(0, selectionEnd - selectionStart);
      const nextAllowedLength = maxLength - (input.value.length - selectedLength);
      if (nextAllowedLength <= 0) {
        event.preventDefault();
      }
    }

    function enforceMaxLengthOnPaste(event, input, counter) {
      if (!input) {
        return;
      }
      const maxLength = getInputMaxLength(input);
      if (!maxLength) {
        return;
      }
      const clipboardText = event.clipboardData?.getData('text') ?? '';
      event.preventDefault();

      const selectionStart = input.selectionStart ?? input.value.length;
      const selectionEnd = input.selectionEnd ?? input.value.length;
      const prefix = input.value.slice(0, selectionStart);
      const suffix = input.value.slice(selectionEnd);
      const remainingLength = maxLength - (prefix.length + suffix.length);
      if (remainingLength <= 0) {
        updateInputCharCounter(input, counter);
        return;
      }

      const insertedText = clipboardText.slice(0, remainingLength);
      const nextValue = `${prefix}${insertedText}${suffix}`;
      input.value = nextValue.slice(0, maxLength);
      const caretPosition = prefix.length + insertedText.length;
      input.setSelectionRange(caretPosition, caretPosition);
      updateInputCharCounter(input, counter);
    }

    function updateDetailInputCounters() {
      updateInputCharCounter(codeInput, codeInputCounter);
      updateInputCharCounter(designationInput, designationInputCounter);
    }

    function clearDetailFormError() {
      if (!detailFormError) {
        return;
      }
      if (detailFormErrorTimeoutId) {
        window.clearTimeout(detailFormErrorTimeoutId);
        detailFormErrorTimeoutId = null;
      }
      detailFormError.textContent = '';
    }

    function getDetailFieldElements(fieldName) {
      if (fieldName === 'code') {
        return { input: codeInput, error: codeInputError };
      }
      if (fieldName === 'designation') {
        return { input: designationInput, error: designationInputError };
      }
      return { input: null, error: null };
    }

    function clearDetailFieldErrorTimeout(fieldName) {
      if (fieldName === 'code' && codeInputErrorTimeoutId) {
        window.clearTimeout(codeInputErrorTimeoutId);
        codeInputErrorTimeoutId = null;
      }
      if (fieldName === 'designation' && designationInputErrorTimeoutId) {
        window.clearTimeout(designationInputErrorTimeoutId);
        designationInputErrorTimeoutId = null;
      }
    }

    function clearDetailFieldErrorStateTimeout(fieldName) {
      if (fieldName === 'code' && codeInputErrorStateTimeoutId) {
        window.clearTimeout(codeInputErrorStateTimeoutId);
        codeInputErrorStateTimeoutId = null;
      }
      if (fieldName === 'designation' && designationInputErrorStateTimeoutId) {
        window.clearTimeout(designationInputErrorStateTimeoutId);
        designationInputErrorStateTimeoutId = null;
      }
    }

    function clearDetailFieldErrorState(fieldName) {
      const { input, error } = getDetailFieldElements(fieldName);
      clearDetailFieldErrorTimeout(fieldName);
      clearDetailFieldErrorStateTimeout(fieldName);
      if (error) {
        error.textContent = '';
      }
      if (input) {
        input.classList.remove('is-error', 'is-shaking');
      }
    }

    function showDetailFieldError(fieldName, message, durationMs = 2400) {
      const { input, error } = getDetailFieldElements(fieldName);
      if (!input || !error) {
        return;
      }
      clearDetailFieldErrorState(fieldName);
      clearDetailFormError();
      error.textContent = message;
      input.classList.remove('is-shaking');
      void input.offsetWidth;
      input.classList.add('is-error', 'is-shaking');

      const errorTimeoutId = window.setTimeout(() => {
        error.textContent = '';
        if (fieldName === 'code') {
          codeInputErrorTimeoutId = null;
        } else if (fieldName === 'designation') {
          designationInputErrorTimeoutId = null;
        }
      }, durationMs);

      const errorStateTimeoutId = window.setTimeout(() => {
        input.classList.remove('is-error', 'is-shaking');
        if (fieldName === 'code') {
          codeInputErrorStateTimeoutId = null;
        } else if (fieldName === 'designation') {
          designationInputErrorStateTimeoutId = null;
        }
      }, durationMs);

      if (fieldName === 'code') {
        codeInputErrorTimeoutId = errorTimeoutId;
        codeInputErrorStateTimeoutId = errorStateTimeoutId;
      } else if (fieldName === 'designation') {
        designationInputErrorTimeoutId = errorTimeoutId;
        designationInputErrorStateTimeoutId = errorStateTimeoutId;
      }
    }

    function clearDetailRequiredFieldErrors() {
      clearDetailFieldErrorState('code');
      clearDetailFieldErrorState('designation');
    }

    function showDetailFormError(message) {
      if (!detailFormError) {
        return;
      }
      clearDetailFormError();
      detailFormError.textContent = message;
      detailFormErrorTimeoutId = window.setTimeout(() => {
        detailFormError.textContent = '';
        detailFormErrorTimeoutId = null;
      }, 2600);
    }

    function buildCodeSuggestionSource(details) {
      const suggestionsByCode = new Map();
      details.forEach((detail) => {
        const code = String(detail?.code || '').trim();
        if (!code) {
          return;
        }
        const designation = String(detail?.designation || '').trim();
        const key = code.toLowerCase();
        if (!suggestionsByCode.has(key)) {
          suggestionsByCode.set(key, { code, designation });
          return;
        }
        const existing = suggestionsByCode.get(key);
        if (!existing.designation && designation) {
          existing.designation = designation;
        }
      });

      return Array.from(suggestionsByCode.values())
        .sort((a, b) => a.code.localeCompare(b.code, 'fr', { sensitivity: 'base' }));
    }

    function getCodeMatches(query) {
      const normalizedQuery = String(query || '').trim().toLowerCase();
      if (!normalizedQuery) {
        return [];
      }

      return codeSuggestionSource
        .map((entry) => {
          const codeLower = entry.code.toLowerCase();
          const matchIndex = codeLower.indexOf(normalizedQuery);
          return { entry, matchIndex, startsWith: codeLower.startsWith(normalizedQuery) };
        })
        .filter((item) => item.matchIndex !== -1)
        .sort((a, b) => {
          if (a.startsWith !== b.startsWith) {
            return a.startsWith ? -1 : 1;
          }
          if (a.matchIndex !== b.matchIndex) {
            return a.matchIndex - b.matchIndex;
          }
          return a.entry.code.localeCompare(b.entry.code, 'fr', { sensitivity: 'base' });
        })
        .slice(0, 8)
        .map((item) => item.entry);
    }

    function buildHighlightedText(text, query) {
      const safeText = String(text || '');
      const normalizedQuery = String(query || '').trim();
      if (!normalizedQuery) {
        return escapeHtml(safeText);
      }

      const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig');
      return escapeHtml(safeText).replace(matcher, '<mark>$1</mark>');
    }

    function setActiveSuggestion(index) {
      activeSuggestionIndex = index;
      if (!codeSuggestions) {
        return;
      }

      codeSuggestions.querySelectorAll('.typeahead__option').forEach((option, optionIndex) => {
        const isActive = optionIndex === index;
        option.classList.toggle('is-active', isActive);
        option.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) {
          option.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    function hideCodeSuggestions() {
      visibleCodeSuggestions = [];
      activeSuggestionIndex = -1;
      if (!codeSuggestions) {
        return;
      }
      codeSuggestions.hidden = true;
      codeSuggestions.style.display = 'none';
      codeSuggestions.innerHTML = '';
    }

    function applyCodeSuggestion(entry) {
      if (!entry || !codeInput || !designationInput) {
        return;
      }
      codeInput.value = entry.code;
      designationInput.value = entry.designation || '';
      updateDetailInputCounters();
      hideCodeSuggestions();
    }

    function renderCodeSuggestions(query) {
      if (!codeSuggestions) {
        return;
      }

      const normalizedQuery = String(query || '').trim();
      if (!normalizedQuery) {
        hideCodeSuggestions();
        return;
      }

      visibleCodeSuggestions = getCodeMatches(query);
      activeSuggestionIndex = -1;

      if (!visibleCodeSuggestions.length) {
        hideCodeSuggestions();
        return;
      }

      codeSuggestions.hidden = false;
      codeSuggestions.style.display = 'block';
      codeSuggestions.innerHTML = visibleCodeSuggestions
        .map(
          (entry, index) => `
            <button
              type="button"
              class="typeahead__option"
              role="option"
              data-typeahead-index="${index}"
              aria-selected="false"
            >
              <span class="typeahead__code">${buildHighlightedText(entry.code, query)}</span>
              <span class="typeahead__designation">${buildHighlightedText(entry.designation || 'Désignation indisponible', query)}</span>
            </button>
          `,
        )
        .join('');
    }

    async function refreshCodeSuggestionSource() {
      const details = await StorageService.getAllDetails();
      codeSuggestionSource = buildCodeSuggestionSource(details);
      if (document.activeElement === codeInput && String(codeInput.value || '').trim()) {
        renderCodeSuggestions(codeInput.value);
      }
    }

    if (!permissions.canDelete || permissions.isLecture) {
      document.querySelector('.data-table')?.classList.add('data-table--hide-action');
    }

    function isFirebaseUserAuthenticated(user) {
      return Boolean(user?.uid);
    }

    function updateDetailCreateButtonVisibility(user) {
      if (!openDetailFormButton) {
        return;
      }
      const isAuthenticated = isFirebaseUserAuthenticated(user);
      openDetailFormButton.hidden = !isAuthenticated;
      openDetailFormButton.style.display = isAuthenticated ? 'inline-flex' : 'none';
      if (itemDetailFabLabel) {
        itemDetailFabLabel.hidden = !isAuthenticated;
        itemDetailFabLabel.style.display = isAuthenticated ? '' : 'none';
      }
      if (itemDetailFabRow) {
        itemDetailFabRow.hidden = !isAuthenticated;
        itemDetailFabRow.style.display = isAuthenticated ? '' : 'none';
      }
    }

    if (!permissions.canCreate || permissions.isLecture) {
      detailFormSection.hidden = true;
    } else if (detailFormSection) {
      detailFormSection.hidden = false;
    }

    updateDetailCreateButtonVisibility(firebaseAuth.currentUser);
    onAuthStateChanged(firebaseAuth, (user) => {
      updateDetailCreateButtonVisibility(user || null);
    });

    function renderTitle() {
      const itemTitle = requireElement('itemTitle');
      if (!currentSite || !currentItem) {
        itemTitle.textContent = 'Chargement...';
        return;
      }
      itemTitle.innerHTML = '';
      const primaryLine = document.createElement('span');
      primaryLine.className = 'header-title__line header-title__line--primary';
      primaryLine.textContent = currentSite.nom;
      const secondaryLine = document.createElement('span');
      secondaryLine.className = 'header-title__line header-title__line--secondary';
      secondaryLine.textContent = currentItem.numero;
      itemTitle.append(primaryLine, secondaryLine);
    }

    function renderStoreLabel() {
      if (!detailStore) {
        return;
      }
      const rawStoreValue = String(currentItem?.magasin || '').trim();
      const normalizedStoreValue = rawStoreValue.toLowerCase();
      let displayValue = rawStoreValue;
      let badgeVariantClass = 'detail-store-badge--custom';

      if (!rawStoreValue || normalizedStoreValue === 'none' || normalizedStoreValue === 'null') {
        displayValue = 'Non défini';
        badgeVariantClass = 'detail-store-badge--undefined';
      } else if (normalizedStoreValue === 'tit i' || normalizedStoreValue === 'titan i') {
        displayValue = 'TITAN I';
        badgeVariantClass = 'detail-store-badge--tit-i';
      } else if (normalizedStoreValue === 'hag 36') {
        displayValue = 'HAG 36';
        badgeVariantClass = 'detail-store-badge--hag-36';
      } else if (normalizedStoreValue === 'by pass') {
        displayValue = 'BYPASS';
        badgeVariantClass = 'detail-store-badge--by-pass';
      }

      detailStore.textContent = '';
      const storeLabel = document.createElement('span');
      storeLabel.className = 'detail-store-label page3-info-label';
      storeLabel.textContent = 'Magasin :';
      const storeBadge = document.createElement('span');
      storeBadge.className = `detail-store-badge page3-store-badge badge ${badgeVariantClass}`;
      storeBadge.textContent = displayValue;
      detailStore.append(storeLabel, storeBadge);
    }

    function getSearchQuery() {
      return detailSearchInput ? detailSearchInput.value.trim().toLowerCase() : '';
    }

    function getFilteredDetails(details) {
      const query = getSearchQuery();
      if (!query) {
        return details;
      }
      return details.filter((detail) => String(detail.designation || '').toLowerCase().includes(query));
    }

    function updateCount(filteredCount, totalCount) {
      const countNumber = detailCount?.querySelector('.count-number');
      const countLabel = detailCount?.querySelector('.count-label');
      if (!countNumber || !countLabel) {
        return;
      }

      countNumber.textContent = String(filteredCount);
      if (filteredCount === totalCount) {
        countLabel.textContent = filteredCount > 1 ? 'Articles' : 'Article';
        return;
      }
      countLabel.textContent = `${filteredCount > 1 ? 'Articles' : 'Article'} affiché${filteredCount > 1 ? 's' : ''} / ${totalCount}`;
    }

    function exportDetails(fileNameOverride) {
      if (!currentItem || !currentSite) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(currentDetails);
      if (!filteredDetails.length) {
        UiService.showToast('Aucune Article à exporter.');
        return;
      }

      const baseName = normalizeExportBaseName(fileNameOverride || `${currentSite.nom} · ${currentItem.numero}`, `${currentSite.nom} · ${currentItem.numero}`);
      const fileName = `${baseName}.xls`;
      const workbook = buildDetailExcelContent(`${currentSite.nom} · ${currentItem.numero}`, filteredDetails);
      downloadExcelFile(fileName, 'Export Excel', workbook);
      saveExportFileNameToHistory(baseName);
    }

    function updateDetailExportSubmitState() {
      if (!detailExportSubmitButton || !detailExportFileNameInput) {
        return;
      }
      const hasValue = Boolean(String(detailExportFileNameInput.value || '').trim());
      detailExportSubmitButton.disabled = !hasValue;
      if (detailExportFileNameError) {
        detailExportFileNameError.textContent = hasValue ? '' : 'Veuillez entrer un nom de fichier.';
      }
    }

    function closeDetailExportDialog() {
      if (detailExportFileNameError) {
        detailExportFileNameError.textContent = '';
      }
      if (detailExportSubmitButton) {
        detailExportSubmitButton.disabled = false;
        detailExportSubmitButton.classList.remove('is-loading');
      }
      detailExportDialog?.close();
    }

    function openDetailExportDialog() {
      if (!detailExportDialog || !detailExportFileNameInput) {
        exportDetails();
        return;
      }
      const defaultName = currentSite?.nom && currentItem?.numero
        ? `${currentSite.nom} · ${currentItem.numero}`
        : 'export-materiel';
      detailExportFileNameInput.value = sanitizeExportFileName(defaultName);
      if (detailExportFileNameError) {
        detailExportFileNameError.textContent = '';
      }
      if (detailExportSubmitButton) {
        detailExportSubmitButton.classList.remove('is-loading');
      }
      updateDetailExportSubmitState();
      detailExportDialog.showModal();
      window.setTimeout(() => {
        detailExportFileNameInput.focus();
        detailExportFileNameInput.select();
      }, 40);
    }

    function ensureDetailDeleteConfirmationDialog() {
      let overlay = document.getElementById('detailDeleteConfirmOverlay');
      if (overlay) {
        return overlay;
      }

      overlay = document.createElement('div');
      overlay.id = 'detailDeleteConfirmOverlay';
      overlay.className = 'maintenance-overlay item-delete-confirm-overlay detail-delete-confirm-overlay';
      overlay.hidden = true;
      overlay.innerHTML = `
        <article class="maintenance-card item-delete-confirm-card detail-delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="detailDeleteConfirmTitle">
          <h3 id="detailDeleteConfirmTitle">Supprimer cette donnée ?</h3>
          <p id="detailDeleteConfirmText">Cette action est définitive.</p>
          <div class="modal-actions item-delete-confirm-actions detail-delete-confirm-actions">
            <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--cancel" id="detailDeleteCancelButton">Annuler</button>
            <button type="button" class="btn item-delete-confirm-button item-delete-confirm-button--danger detail-delete-confirm-submit" id="detailDeleteConfirmButton">
              <span class="btn-label-default">Supprimer</span>
              <span class="btn-loading-spinner" aria-hidden="true"></span>
              <span class="btn-label-loading" aria-hidden="true">Suppression...</span>
            </button>
          </div>
        </article>
      `;
      document.body.appendChild(overlay);
      return overlay;
    }

    function askDetailDeleteConfirmation(detailId) {
      const overlay = ensureDetailDeleteConfirmationDialog();
      const cancelButton = overlay.querySelector('#detailDeleteCancelButton');
      const confirmButton = overlay.querySelector('#detailDeleteConfirmButton');
      if (!cancelButton || !confirmButton) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const closeAnimationDurationMs = 170;
        let closeAnimationTimer = null;
        let isClosing = false;
        let isDeleting = false;

        const setLoadingState = (isLoading) => {
          confirmButton.disabled = isLoading;
          confirmButton.classList.toggle('is-loading', isLoading);
          cancelButton.disabled = isLoading;
        };

        const cleanup = () => {
          if (closeAnimationTimer) {
            window.clearTimeout(closeAnimationTimer);
            closeAnimationTimer = null;
          }
          setLoadingState(false);
          overlay.hidden = true;
          overlay.classList.remove('is-open');
          overlay.onclick = null;
          cancelButton.onclick = null;
          confirmButton.onclick = null;
          document.removeEventListener('keydown', handleKeyDown);
        };

        const close = () => {
          if (isClosing) {
            return;
          }
          isClosing = true;
          overlay.classList.remove('is-open');
          closeAnimationTimer = window.setTimeout(() => {
            cleanup();
            resolve();
          }, closeAnimationDurationMs);
        };

        const handleKeyDown = (event) => {
          if (event.key === 'Escape' && !isDeleting) {
            close();
          }
        };

        cancelButton.onclick = () => {
          if (!isDeleting) {
            close();
          }
        };

        confirmButton.onclick = async () => {
          if (isDeleting) {
            return;
          }
          isDeleting = true;
          setLoadingState(true);
          const removed = await StorageService.removeDetail(siteId, itemId, detailId);
          UiService.showToast(removed ? 'Article supprimée.' : 'Suppression impossible.');
          if (removed) {
            close();
            return;
          }
          isDeleting = false;
          setLoadingState(false);
        };

        overlay.onclick = (event) => {
          if (event.target === overlay && !isDeleting) {
            close();
          }
        };
        document.addEventListener('keydown', handleKeyDown);
        overlay.hidden = false;
        window.requestAnimationFrame(() => {
          overlay.classList.add('is-open');
        });
      });
    }

    function renderTable() {
      if (!currentItem) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(currentDetails);
      updateCount(filteredDetails.length, currentDetails.length);

      if (!filteredDetails.length) {
        detailTableBody.innerHTML = `<tr><td colspan="11"><div class="empty-state">${currentDetails.length ? 'Aucune  désignation ne correspond à votre recherche.' : 'Aucune article enregistrée.'}</div></td></tr>`;
        return;
      }

      detailTableBody.innerHTML = filteredDetails
        .map(
          (detail, index) => {
            const ecart = computeEcart(detail);
            const ecartClassName = typeof ecart === 'number' && ecart !== 0 ? ' cell-input--ecart-alert' : '';
            const enterAnimationStyle = animateNextTableRender ? ` style="--detail-row-enter-delay:${Math.min(index, 5) * 40}ms"` : '';
            return `
            <tr data-detail-id="${detail.id}" class="${animateNextTableRender ? 'detail-row-enter' : ''}"${enterAnimationStyle}>
              <td><span class="field-badge">${detail.champ}</span></td>
              <td><input class="cell-input cell-input--autosize cell-input--left" data-field="code" value="${escapeHtml(detail.code)}" size="${Math.max(String(detail.code || '').length + 1, 10)}" /></td>
              <td><input class="cell-input cell-input--autosize cell-input--designation cell-input--left" data-field="designation" value="${escapeHtml(detail.designation)}" size="${Math.max(String(detail.designation || '').length + 1, 20)}" /></td>
              <td>
                <div class="qte-sortie-field">
                  <input class="cell-input" data-field="qteSortie" type="number" min="0" step="1" value="${escapeHtml(detail.qteSortie)}" />
                  <span class="meta-value meta-value--inline">${escapeHtml(detail.unite)}</span>
                </div>
              </td>
              <td><input class="cell-input" data-field="qtePosee" type="number" min="0" step="1" value="${detail.qtePosee}" /></td>
              <td><input class="cell-input" data-field="qteRetour" type="number" min="0" step="1" value="${detail.qteRetour}" /></td>
              <td><input class="cell-input${ecartClassName}" type="number" value="${ecart}" readonly aria-label="Ecart" /></td>
              <td><input class="cell-input cell-input--autosize" data-field="observation" type="text" value="${escapeHtml(detail.observation)}" size="${Math.max(String(detail.observation || '').length + 1, 14)}" /></td>
              <td><span class="meta-value">${UiService.formatDate(detail.dateCreation)}</span></td>
              <td><span class="meta-value">${UiService.formatDate(detail.dateModification)}</span></td>
              <td>
                ${permissions.canDelete && !permissions.isLecture
      ? `<button class="table-delete-icon-button" type="button" data-detail-delete="${detail.id}" aria-label="Supprimer" title="Supprimer"><img src="Icon/poubelle.png" alt="" aria-hidden="true" class="table-delete-icon-button__icon" /></button>`
      : ""}
              </td>
            </tr>
          `;
          },
        )
        .join('');
      animateNextTableRender = false;

      detailTableBody.querySelectorAll('[data-field]').forEach((field) => {
        if (!canEditDetails) {
          field.disabled = true;
        }
        if (!canEditDetails) {
          return;
        }

        field.addEventListener('change', async (event) => {
          const row = event.target.closest('tr');
          const fieldName = event.target.dataset.field;
          const currentDetail = currentDetails.find((detail) => detail.id === row.dataset.detailId);

          if (!currentDetail) {
            return;
          }

          const nextValue = event.target.value;
          if (String(currentDetail[fieldName] ?? '') === String(nextValue ?? '')) {
            return;
          }

          await StorageService.updateDetail(siteId, itemId, row.dataset.detailId, {
            [fieldName]: nextValue,
          });
        });
      });

      detailTableBody.querySelectorAll('[data-detail-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          await askDetailDeleteConfirmation(button.dataset.detailDelete);
        });
      });
    }

    detailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearDetailFormError();
      let hasFieldError = false;
      if (!String(codeInput.value || '').trim()) {
        showDetailFieldError('code', 'Veuillez remplir ce champ');
        hasFieldError = true;
      }
      if (!String(designationInput.value || '').trim()) {
        showDetailFieldError('designation', 'Veuillez remplir ce champ');
        hasFieldError = true;
      }
      if (hasFieldError) {
        return;
      }
      if (!permissions.canCreate) {
        showDetailFormError('Action non autorisée.');
        return;
      }

      setDetailFormSavingState(true);
      try {
        const result = await StorageService.createDetail(siteId, itemId, {
          code: requireElement('codeInput').value,
          designation: designationInput.value,
          qteSortie: requireElement('qteSortieInput').value,
          unite: requireElement('uniteInput').value,
        });
        if (!result?.ok) {
          showDetailFormError(
            result?.reason === 'duplicate_designation'
              ? 'Cette désignation existe déjà pour ce N° OUT.'
              : 'Création impossible. Vérifiez la désignation.',
          );
          return;
        }
        detailForm.reset();
        requireElement('uniteInput').value = 'm';
        updateDetailInputCounters();
        hideCodeSuggestions();
        clearDetailFormError();
        closeDetailModal();
        UiService.showToast('Article ajoutée .');
      } finally {
        setDetailFormSavingState(false);
      }
    });

    if (openDetailFormButton) {
      openDetailFormButton.addEventListener('click', openDetailModal);
    }

    if (cancelDetailFormButton) {
      cancelDetailFormButton.addEventListener('click', closeDetailModal);
    }

    if (detailFormModal) {
      detailFormModal.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDetailModal();
      });

      detailFormModal.addEventListener('click', (event) => {
        if (event.target === detailFormModal) {
          closeDetailModal();
        }
      });

      detailFormModal.addEventListener('close', () => {
        setDetailModalOpenState(false);
      });
    }

    if (codeInput && codeSuggestions) {
      codeInput.addEventListener('focus', () => {
        if (!String(codeInput.value || '').trim()) {
          hideCodeSuggestions();
          return;
        }
        renderCodeSuggestions(codeInput.value);
      });

      codeInput.addEventListener('input', () => {
        clearDetailFormError();
        clearDetailFieldErrorState('code');
        updateInputCharCounter(codeInput, codeInputCounter);
        renderCodeSuggestions(codeInput.value);
      });

      codeInput.addEventListener('beforeinput', (event) => {
        enforceMaxLengthOnBeforeInput(event, codeInput);
      });

      codeInput.addEventListener('paste', (event) => {
        enforceMaxLengthOnPaste(event, codeInput, codeInputCounter);
        renderCodeSuggestions(codeInput.value);
      });

      codeInput.addEventListener('keydown', (event) => {
        if (!visibleCodeSuggestions.length) {
          return;
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIndex = activeSuggestionIndex < visibleCodeSuggestions.length - 1 ? activeSuggestionIndex + 1 : 0;
          setActiveSuggestion(nextIndex);
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const nextIndex = activeSuggestionIndex > 0 ? activeSuggestionIndex - 1 : visibleCodeSuggestions.length - 1;
          setActiveSuggestion(nextIndex);
          return;
        }

        if (event.key === 'Enter' && activeSuggestionIndex >= 0) {
          event.preventDefault();
          applyCodeSuggestion(visibleCodeSuggestions[activeSuggestionIndex]);
          return;
        }

        if (event.key === 'Escape') {
          hideCodeSuggestions();
        }
      });

      codeInput.addEventListener('blur', () => {
        window.setTimeout(hideCodeSuggestions, 140);
      });

      codeSuggestions.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });

      codeSuggestions.addEventListener('click', (event) => {
        const option = event.target.closest('[data-typeahead-index]');
        if (!option) {
          return;
        }
        const suggestion = visibleCodeSuggestions[Number(option.dataset.typeaheadIndex)];
        applyCodeSuggestion(suggestion);
      });
    }

    if (designationInput) {
      designationInput.addEventListener('input', () => {
        clearDetailFormError();
        clearDetailFieldErrorState('designation');
        updateInputCharCounter(designationInput, designationInputCounter);
      });
      designationInput.addEventListener('beforeinput', (event) => {
        enforceMaxLengthOnBeforeInput(event, designationInput);
      });
      designationInput.addEventListener('paste', (event) => {
        enforceMaxLengthOnPaste(event, designationInput, designationInputCounter);
      });
    }

    requireElement('qteSortieInput')?.addEventListener('input', clearDetailFormError);
    requireElement('uniteInput')?.addEventListener('change', clearDetailFormError);

    if (detailSearchInput) {
      detailSearchInput.addEventListener('input', renderTable);
      const toggleClearButton = () => {
        if (!detailSearchInput || !clearSearchBtn) {
          return;
        }
        clearSearchBtn.style.display = detailSearchInput.value.trim() ? 'flex' : 'none';
      };
      detailSearchInput.addEventListener('input', toggleClearButton);
      clearSearchBtn?.addEventListener('click', () => {
        if (!detailSearchInput) {
          return;
        }
        detailSearchInput.value = '';
        toggleClearButton();
        renderTable();
        detailSearchInput.focus();
      });
      detailSearchInput.value = '';
      toggleClearButton();
    }

    if (exportButton) {
      exportButton.addEventListener('click', openDetailExportDialog);
    }

    if (detailExportCancelButton) {
      detailExportCancelButton.addEventListener('click', closeDetailExportDialog);
    }

    if (detailExportDialog) {
      detailExportDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDetailExportDialog();
      });
      detailExportDialog.addEventListener('click', (event) => {
        if (event.target === detailExportDialog) {
          closeDetailExportDialog();
        }
      });
    }

    if (detailExportFileNameInput) {
      detailExportFileNameInput.addEventListener('input', () => {
        updateDetailExportSubmitState();
      });
    }

    if (detailExportForm) {
      detailExportForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!detailExportSubmitButton || detailExportSubmitButton.disabled) {
          return;
        }
        const fileName = sanitizeExportFileName(detailExportFileNameInput?.value || '');
        if (!fileName) {
          updateDetailExportSubmitState();
          return;
        }
        detailExportSubmitButton.disabled = true;
        detailExportSubmitButton.classList.add('is-loading');
        try {
          exportDetails(fileName);
          closeDetailExportDialog();
        } catch (_error) {
          detailExportSubmitButton.disabled = false;
          detailExportSubmitButton.classList.remove('is-loading');
          UiService.showToast('Exportation impossible.');
        }
      });
    }

    function showDetailTableSkeleton() {
      if (hasResolvedInitialDetails || isDetailSkeletonVisible) {
        return;
      }
      isDetailSkeletonVisible = true;
      detailTableBody.innerHTML = Array.from({ length: 4 }, (_, rowIndex) => `
        <tr class="detail-skeleton-row" aria-hidden="true">
          ${Array.from({ length: 11 }, (_, columnIndex) => {
    const shouldUseShortBlock = (rowIndex + columnIndex) % 3 === 0;
    return `<td><span class="detail-skeleton-block${shouldUseShortBlock ? ' detail-skeleton-block--short' : ''}"></span></td>`;
  }).join('')}
        </tr>
      `).join('');
    }

    function hideDetailTableSkeleton() {
      if (!isDetailSkeletonVisible) {
        return;
      }
      isDetailSkeletonVisible = false;
      detailTableBody.innerHTML = '';
    }

    detailSkeletonTimerId = window.setTimeout(() => {
      showDetailTableSkeleton();
    }, 120);

    StorageService.subscribeSites((sites) => {
      currentSite = sites.find((site) => site.id === siteId) || currentSite;
      renderTitle();
      refreshCodeSuggestionSource();
    });

    StorageService.subscribeItems(siteId, (items) => {
      currentItem = items.find((item) => item.id === itemId) || currentItem;
      if (!currentItem) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }
      renderTitle();
      renderStoreLabel();
    });

    StorageService.subscribeDetails(
      siteId,
      itemId,
      (details) => {
        hasResolvedInitialDetails = true;
        if (detailSkeletonTimerId !== null) {
          window.clearTimeout(detailSkeletonTimerId);
          detailSkeletonTimerId = null;
        }
        animateNextTableRender = isDetailSkeletonVisible;
        hideDetailTableSkeleton();
        currentDetails = details;
        renderTable();
      },
      () => {
        UiService.showToast('Synchronisation  indisponible.');
      },
    );

    renderTitle();
    renderStoreLabel();
    updateDetailInputCounters();
    refreshCodeSuggestionSource();
  }



  async function initUsersPage(permissions) {
    if (!permissions.isAdmin && !permissions.isStandard) {
      UiService.navigate('index.html');
      return;
    }

    const tableBody = requireElement('usersTableBody');
    const backButton = requireElement('usersBackButton');
    const maintenanceToggle = requireElement('maintenanceToggle');
    const maintenanceStatusText = requireElement('maintenanceStatusText');
    backButton?.addEventListener('click', () => UiService.navigate('index.html'));

    const roleLabel = { standard: 'Standard', limite: 'Limité' };

    function cleanText(value) {
      return String(value || '').trim();
    }

    function resolveDisplayName(user) {
      const displayName = cleanText(user?.username || user?.displayName || user?.name);
      if (displayName) {
        return displayName;
      }
      const emailPrefix = cleanText(user?.email).split('@')[0];
      return emailPrefix || 'Utilisateur';
    }

    function resolveRole(user) {
      const role = cleanText(user?.role).toLowerCase();
      return role === 'standard' || role === 'adjoint' || role === 'admin' ? 'standard' : 'limite';
    }

    function resolveMaintenanceAuthorized(user) {
      if (typeof user?.maintenanceAuthorized === 'boolean') {
        return user.maintenanceAuthorized;
      }
      if (typeof user?.maintenanceAccess === 'boolean') {
        return user.maintenanceAccess;
      }
      return false;
    }

    function updateMaintenanceLabel(isEnabled) {
      if (maintenanceStatusText) {
        maintenanceStatusText.textContent = isEnabled ? 'Activé' : 'Désactivé';
      }
      if (maintenanceToggle) {
        maintenanceToggle.checked = Boolean(isEnabled);
      }
    }

    function renderUsers(users) {
      tableBody.innerHTML = users
        .map((user) => `
          <tr>
            <td>
              ${cleanText(user.avatarUrl)
      ? `<img class="table-avatar" src="${escapeHtml(user.avatarUrl)}" alt="Avatar de ${escapeHtml(resolveDisplayName(user))}" />`
      : `<span class="table-avatar table-avatar--fallback">${escapeHtml(getInitialsFromName(resolveDisplayName(user)).slice(0, 2))}</span>`}
            </td>
            <td>${escapeHtml(resolveDisplayName(user))}</td>
            <td class="users-email-cell">${escapeHtml(cleanText(user.email) || '-')}</td>
            <td>
              ${cleanText(user.email).toLowerCase() === 'andrainaaina@gmail.com' ? 'admin' : `
              <select data-user-role="${user.id}">
                <option value="standard" ${resolveRole(user) === 'standard' ? 'selected' : ''}>${roleLabel.standard}</option>
                <option value="limite" ${resolveRole(user) === 'limite' ? 'selected' : ''}>${roleLabel.limite}</option>
              </select>`}
            </td>
            <td class="maintenance-access-cell">
              <input
                type="checkbox"
                class="maintenance-access-checkbox"
                data-user-maintenance-access="${user.id}"
                ${resolveMaintenanceAuthorized(user) ? 'checked' : ''}
                aria-label="Autoriser ${escapeHtml(resolveDisplayName(user))} pendant la maintenance"
              />
            </td>
            <td>
              ${cleanText(user.email).toLowerCase() === 'andrainaaina@gmail.com'
      ? '<span class="table-action-disabled">-</span>'
      : `<button type="button" class="table-delete-icon-button" data-delete-user="${user.id}" aria-label="Supprimer" title="Supprimer"><img src="Icon/poubelle.png" alt="" aria-hidden="true" class="table-delete-icon-button__icon" /></button>`}
            </td>
          </tr>
        `)
        .join('');

      tableBody.querySelectorAll('[data-user-role]').forEach((select) => {
        select.addEventListener('change', async () => {
          await StorageService.updateUserRole(select.dataset.userRole, select.value);
          UiService.showToast('Rôle mis à jour.');
        });
      });

      tableBody.querySelectorAll('[data-user-maintenance-access]').forEach((checkbox) => {
        checkbox.addEventListener('change', async () => {
          const isAllowed = checkbox.checked;
          try {
            await StorageService.updateUserMaintenanceAccess(checkbox.dataset.userMaintenanceAccess, isAllowed);
            UiService.showToast('Accès maintenance mis à jour.');
          } catch (_error) {
            checkbox.checked = !isAllowed;
            UiService.showToast('Impossible de mettre à jour l’accès maintenance.');
          }
        });
      });

      tableBody.querySelectorAll('[data-delete-user]').forEach((button) => {
        button.addEventListener('click', async () => {
          const shouldDelete = window.confirm('Êtes-vous sûr de vouloir supprimer cet utilisateur ?');
          if (!shouldDelete) {
            return;
          }
          await StorageService.deleteUser(button.dataset.deleteUser);
          UiService.showToast('Utilisateur supprimé.');
        });
      });
    }

    let ignoreToggleEvent = false;
    StorageService.subscribeMaintenanceState(
      (maintenanceState) => {
        ignoreToggleEvent = true;
        updateMaintenanceLabel(Boolean(maintenanceState.enabled));
        ignoreToggleEvent = false;
      },
      () => {
        UiService.showToast('Impossible de synchroniser l’état de maintenance.');
      },
    );

    maintenanceToggle?.addEventListener('change', async () => {
      if (ignoreToggleEvent) {
        return;
      }
      const enabled = maintenanceToggle.checked;
      updateMaintenanceLabel(enabled);
      try {
        await StorageService.setMaintenanceState(enabled);
      } catch (_error) {
        updateMaintenanceLabel(!enabled);
        UiService.showToast('Échec de mise à jour de l’état de maintenance.');
      }
    });

    try {
      const initialUsers = await StorageService.listUsers();
      renderUsers(initialUsers);
    } catch (_error) {
      UiService.showToast('Impossible de charger les utilisateurs.');
    }

    StorageService.subscribeUsers(
      (users) => {
        console.log('[users] documents récupérés :', users.length);
        users.forEach((user) => {
          console.log('[users] doc:', user.id, {
            displayName: resolveDisplayName(user),
            email: cleanText(user.email),
            role: resolveRole(user),
            maintenanceAuthorized: resolveMaintenanceAuthorized(user),
          });
        });
        renderUsers(users);
      },
      () => {
        UiService.showToast('Synchronisation des utilisateurs indisponible.');
      },
    );
  }

  async function initHistoryPage() {
    const historyList = requireElement('historyList');
    if (!historyList) {
      return;
    }

    try {
      const users = await StorageService.listUsers();
      const usersById = users.reduce((accumulator, user) => {
        if (user?.id) {
          accumulator[user.id] = user;
        }
        return accumulator;
      }, {});
      const usersByName = users.reduce((accumulator, user) => {
        const usernameKey = String(user?.username || '').trim().toLowerCase();
        if (usernameKey && !accumulator[usernameKey]) {
          accumulator[usernameKey] = user;
        }
        return accumulator;
      }, {});
      const historiques = await StorageService.listHistoriques();
      if (!historiques.length) {
        UiService.renderEmptyState(historyList, 'Aucun historique enregistré pour le moment.');
        return;
      }

      historyList.innerHTML = `
        <ul class="history-list__items">
          ${historiques
            .map((history) => {
              const normalizedName = String(history.userName || '').trim().toLowerCase();
              const matchedUser = usersById[history.userId] || usersByName[normalizedName] || null;
              const avatarUrl = String(matchedUser?.avatarUrl || '').trim();
              const displayName = String(history.userName || 'Utilisateur inconnu').trim();
              const initials = getInitialsFromName(displayName);
              const avatarMarkup = avatarUrl
                ? `<img class="history-list__avatar-image" src="${escapeHtml(avatarUrl)}" alt="Avatar de ${escapeHtml(displayName)}" />`
                : `<span class="history-list__avatar-fallback" aria-hidden="true">${escapeHtml(initials)}</span>`;
              return `
              <li class="history-list__item" aria-label="Historique">
                <div class="history-list__avatar">
                  ${avatarMarkup}
                </div>
                <div class="history-list__content">
                  <p class="history-list__name">${escapeHtml(displayName)}</p>
                  <p class="history-list__title">${escapeHtml(history.action)}</p>
                  <p class="history-list__date">${escapeHtml(UiService.formatDate(history.createdAt?.toDate?.() || history.createdAt))}</p>
                </div>
              </li>
            `;
            })
            .join('')}
        </ul>
      `;
    } catch (_error) {
      UiService.renderEmptyState(historyList, "Impossible de charger l'historique.");
    }
  }
  function resolveConnectedProfile(profile, isAuthenticated) {
    const nextProfile = { ...(profile || {}) };
    const email = String(nextProfile?.email || '').trim().toLowerCase();

    if (!isAuthenticated) {
      return { role: 'lecture' };
    }

    if (email === 'andrainaaina@gmail.com') {
      nextProfile.role = 'admin';
      return nextProfile;
    }

    if (!String(nextProfile.role || '').trim()) {
      nextProfile.role = 'limite';
    }
    return nextProfile;
  }

  async function bootstrap() {
    UiService.bindDialogCloser();
    setupBackButtons();

    const authUser = await waitForAuthState();
    await StorageService.init();

    const isAuthenticated = Boolean(authUser);
    let profile = await StorageService.getCurrentUserProfile();

    if (isAuthenticated) {
      await StorageService.ensureCurrentUser();
      profile = await StorageService.getCurrentUserProfile();
    }

    profile = resolveConnectedProfile(profile, isAuthenticated);

    const permissions = buildPermissions(profile);

    initMaintenanceGate(permissions, profile);

    const page = document.body.dataset.page;
    if (page === 'home') {
      initHomePage(permissions, { isAuthenticated, authUser });
    }
    if (page === 'site-detail') {
      initSiteDetailPage(permissions);
    }
    if (page === 'item-detail') {
      initItemDetailPage(permissions);
    }
    if (page === 'users-management') {
      await initUsersPage(permissions);
    }
    if (page === 'history') {
      await initHistoryPage();
    }
  }


  bootstrap().finally(() => {
    UiService.markAppReady();
  });
})();
