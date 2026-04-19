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

  function setCountText(element, count, singular, plural) {
    element.textContent = `${count} ${count === 1 ? singular : plural}`;
  }

  function resolveActorLabel(userId, userMap) {
    const username = userMap?.[String(userId || '')];
    return username || 'N/A';
  }

  function buildCreatedModifiedLabels(item, userMap) {
    const createdBy = resolveActorLabel(item?.createdBy, userMap);
    const modifiedBy = resolveActorLabel(item?.modifiedBy || item?.updatedBy || item?.createdBy, userMap);
    return {
      createdLabel: `Créé par ${createdBy} le ${UiService.formatDate(item?.dateCreation)}`,
      modifiedLabel: `Modifié par ${modifiedBy} le ${UiService.formatDate(item?.dateModification)}`,
    };
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
      return 'Il y a longtemps';
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

  const HOME_MODES = {
    LECTURE: 'lecture',
    FULL: 'full',
    ADMIN: 'admin',
  };

  const ADMIN_EMAIL = 'andrainaaina@gmail.com';

  function resolveHomeModeFromAuthUser(user) {
    if (!user) {
      return HOME_MODES.LECTURE;
    }
    const email = String(user?.email || '').trim().toLowerCase();
    if (email === ADMIN_EMAIL) {
      return HOME_MODES.ADMIN;
    }
    return HOME_MODES.FULL;
  }

  function buildHomePermissionsByMode(mode) {
    if (mode === HOME_MODES.ADMIN) {
      return { canCreate: true, canEdit: true, canDelete: true, isAdmin: true };
    }
    if (mode === HOME_MODES.FULL) {
      return { canCreate: true, canEdit: true, canDelete: true, isAdmin: false };
    }
    return { canCreate: false, canEdit: false, canDelete: false, isAdmin: false };
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
    const role = String(profile?.role || 'full').toLowerCase();
    const isAdmin = username === 'Admin' || role === 'admin';
    const isLecture = role === 'lecture';
    if (isAdmin) {
      return { canCreate: true, canEdit: true, canDelete: true, isAdmin: true, isLecture: false };
    }
    return { canCreate: true, canEdit: true, canDelete: true, isAdmin: false, isLecture };
  }

  function ensureMaintenanceOverlay() {
    let overlay = document.getElementById('maintenanceOverlay');
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement('div');
    overlay.id = 'maintenanceOverlay';
    overlay.className = 'maintenance-overlay';
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

  function initMaintenanceGate(permissions) {
    if (permissions?.isAdmin) {
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
    overlay.className = 'maintenance-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <article class="maintenance-card" role="alertdialog" aria-modal="true" aria-labelledby="logoutConfirmTitle">
        <h3 id="logoutConfirmTitle">Déconnexion</h3>
        <p>Voulez-vous vraiment vous déconnecter ?</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="logoutConfirmCancel">Annuler</button>
          <button type="button" class="btn btn-danger" id="logoutConfirmSubmit">Déconnexion</button>
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
      const cleanup = () => {
        overlay.hidden = true;
        overlay.onclick = null;
        cancelButton.onclick = null;
        submitButton.onclick = null;
      };
      const close = (value) => {
        cleanup();
        resolve(value);
      };

      cancelButton.onclick = () => close(false);
      submitButton.onclick = () => close(true);
      overlay.onclick = (event) => {
        if (event.target === overlay) {
          close(false);
        }
      };
      overlay.hidden = false;
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
    const closeSheet = () => {
      if (overlay.hidden) {
        return;
      }
      overlay.classList.remove('is-open');
      overlay.__closeTransitionHandler = (event) => {
        if (event.target !== overlay && event.target !== sheet) {
          return;
        }
        finalizeClose();
      };
      overlay.addEventListener('transitionend', overlay.__closeTransitionHandler);
      overlay.__closeTimerId = window.setTimeout(finalizeClose, closeTransitionDurationMs);
    };

    logoutButton.onclick = async () => {
      const shouldLogout = await askLogoutConfirmation();
      if (!shouldLogout) {
        return;
      }
      try {
        await signOut(firebaseAuth);
        closeSheet();
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
    const searchInput = requireElement('searchInput');
    const siteList = requireElement('siteList');
    const siteCount = requireElement('siteCount');
    const siteDialog = requireElement('siteDialog');
    const siteForm = requireElement('siteForm');
    const siteNameInput = requireElement('siteNameInput');
    const siteFormError = requireElement('siteFormError');
    const homeMenuButton = requireElement('homeMenuButton');
    const homeMenuPanel = requireElement('homeMenuPanel');
    const importDataButton = requireElement('importDataButton');
    const exportDataButton = requireElement('exportDataButton');
    const manageUsersButton = requireElement('manageUsersButton');
    const historyButton = requireElement('historyButton');

    let currentSites = [];
    let itemCountsBySite = {};
    let userNamesById = {};
    let currentPermissions = permissions;

    async function loadUserNames() {
      try {
        const users = await StorageService.listUsers();
        userNamesById = users.reduce((accumulator, user) => {
          if (user?.id) {
            accumulator[user.id] = user.username || 'N/A';
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

    function closeHomeMenu() {
      if (!homeMenuPanel || !homeMenuButton) {
        return;
      }
      homeMenuPanel.hidden = true;
      homeMenuButton.setAttribute('aria-expanded', 'false');
    }

    function openHomeMenu() {
      if (!homeMenuPanel || !homeMenuButton) {
        return;
      }
      homeMenuPanel.hidden = false;
      homeMenuButton.setAttribute('aria-expanded', 'true');
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
      closeHomeMenu();

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

    function renderSites() {
      const query = searchInput.value.trim().toUpperCase();
      const sites = currentSites.filter((site) => String(site.nom || '').toUpperCase().includes(query));
      setCountText(siteCount, sites.length, 'site', 'sites');

      if (!sites.length) {
        UiService.renderEmptyState(
          siteList,
          query ? 'Aucun site ne correspond à votre recherche.' : 'Aucun site enregistré pour le moment.',
        );
        return;
      }

      siteList.innerHTML = sites
        .map((site) => {
          const labels = buildCreatedModifiedLabels(site, userNamesById);
          return `
            <article class="list-card">
              ${currentPermissions.canDelete ? `<button class="list-card__delete-button" type="button" data-site-delete="${site.id}" aria-label="Supprimer" title="Supprimer">×</button>` : ''}
              <button class="list-card__button" type="button" data-site-open="${site.id}">
                <h3 class="list-card__title">${escapeHtml(site.nom)}</h3>
                <div class="list-card__meta">
                  <span>${itemCountsBySite[site.id] || 0} OUT${(itemCountsBySite[site.id] || 0) > 1 ? 'S' : ''}</span>
                  <span>${escapeHtml(labels.createdLabel)}</span>
                  <small>${escapeHtml(labels.modifiedLabel)}</small>
                </div>
              </button>
            </article>
          `;
        })
        .join('');

      siteList.querySelectorAll('[data-site-open]').forEach((button) => {
        button.addEventListener('click', () => {
          UiService.navigate(`page2.html?siteId=${encodeURIComponent(button.dataset.siteOpen)}`);
        });
      });

      siteList.querySelectorAll('[data-site-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          const removedSnapshot = await StorageService.removeSite(button.dataset.siteDelete);
          if (!removedSnapshot) {
            UiService.showToast('Suppression impossible.');
            return;
          }
          UiService.showUndoSnackbar('Site supprimé.', async () => {
            const restored = await StorageService.restoreSite(removedSnapshot);
            UiService.showToast(restored ? 'Suppression annulée.' : 'Restauration impossible.');
          });
        });
      });
    }

    if (homeMenuButton && homeMenuPanel) {
      homeMenuButton.addEventListener('click', () => {
        if (homeMenuPanel.hidden) {
          openHomeMenu();
          return;
        }
        closeHomeMenu();
      });

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.header-menu')) {
          closeHomeMenu();
        }
      });
    }

    if (exportDataButton) {
      exportDataButton.addEventListener('click', () => {
        closeHomeMenu();
        exportAllData();
      });
    }

    if (importDataButton) {
      importDataButton.addEventListener('click', () => {
        openImportFilePicker();
      });
    }
    if (manageUsersButton) {
      manageUsersButton.addEventListener('click', () => {
        closeHomeMenu();
        UiService.navigate('users.html');
      });
    }

    if (historyButton) {
      historyButton.addEventListener('click', () => {
        closeHomeMenu();
        UiService.navigate('historiques.html');
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

    function mettreAJourPermissionsUI(mode) {
      currentPermissions = buildHomePermissionsByMode(mode);

      if (openCreateSite) {
        openCreateSite.hidden = !currentPermissions.canCreate;
      }

      if (importDataButton) {
        importDataButton.hidden = mode !== HOME_MODES.ADMIN;
      }

      if (exportDataButton) {
        exportDataButton.hidden = mode !== HOME_MODES.ADMIN;
      }

      if (manageUsersButton) {
        manageUsersButton.hidden = !currentPermissions.isAdmin;
      }

      closeHomeMenu();
      renderSites();
    }

    function appliquerModeLecture() {
      mettreAJourPermissionsUI(HOME_MODES.LECTURE);
    }

    function appliquerModeFull() {
      mettreAJourPermissionsUI(HOME_MODES.FULL);
    }

    function appliquerModeAdmin() {
      mettreAJourPermissionsUI(HOME_MODES.ADMIN);
    }

    function appliquerModeParUtilisateur(authUser) {
      mettreAJourHeaderUtilisateur(authUser || null);
      const mode = resolveHomeModeFromAuthUser(authUser);
      if (mode === HOME_MODES.ADMIN) {
        appliquerModeAdmin(authUser);
        return;
      }
      if (mode === HOME_MODES.FULL) {
        appliquerModeFull(authUser);
        return;
      }
      appliquerModeLecture();
    }

    appliquerModeParUtilisateur(authState?.authUser || null);
    onAuthStateChanged(firebaseAuth, (user) => {
      renderUserAvatar(user || null);
      appliquerModeParUtilisateur(user || null);
    });

    openCreateSite?.addEventListener('click', () => {
      if (!currentPermissions.canCreate) {
        UiService.showToast('Action non autorisée.');
        return;
      }
      siteForm.reset();
      siteFormError.textContent = '';
      siteDialog.showModal();
      siteNameInput.focus();
    });

    searchInput.addEventListener('input', renderSites);

    siteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = siteNameInput.value.trim();
      if (!name) {
        siteFormError.textContent = 'Veuillez remplir ce champ';
        return;
      }

      if (!currentPermissions.canCreate) {
        siteFormError.textContent = 'Action non autorisée.';
        return;
      }

      try {
        const result = await StorageService.createSite(name);
        if (!result?.ok) {
          siteFormError.textContent =
            result?.reason === 'duplicate_site'
              ? 'Ce nom de site existe déjà.'
              : 'Création impossible. Vérifiez le nom du site.';
          return;
        }

        siteDialog.close();
        UiService.showToast('Site créé avec succés.');
      } catch (error) {
        console.error('Erreur lors de la création du site :', error);
        siteFormError.textContent = "Impossible d'enregistrer le site. Vérifiez Firestore et réessayez.";
      }
    });

    StorageService.subscribeSites(
      (sites) => {
        currentSites = sites;
        renderSites();
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
    const itemFormError = requireElement('itemFormError');
    const openExportItems = requireElement('openExportItems');
    const itemSearchInput = requireElement('itemSearchInput');
    const itemDateFilter = requireElement('itemDateFilter');

    let currentSite = StorageService.getSite(siteId);
    let currentItems = [];
    let detailCountsByItem = {};
    let detailDesignationsByItem = {};
    let detailRowsByItem = {};
    let userNamesById = {};
    const dateFilterStorageKey = `site-detail:item-date-filter:${siteId}`;
    const searchStorageKey = `site-detail:item-search:${siteId}`;
    let selectedDateFilter = window.localStorage.getItem(dateFilterStorageKey) || 'all';
    itemSearchInput.value = window.localStorage.getItem(searchStorageKey) || '';

    siteTitle.textContent = currentSite ? currentSite.nom : 'Chargement...';

    async function loadUserNames() {
      try {
        const users = await StorageService.listUsers();
        userNamesById = users.reduce((accumulator, user) => {
          if (user?.id) {
            accumulator[user.id] = user.username || 'N/A';
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

    async function exportItems() {
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

      const title = `SUIVI MATERIEL . ${currentSite.nom}`;
      const workbook = buildSiteExcelContent(title, rows);
      downloadExcelFile(`${title}.xls`, 'Export Excel', workbook);
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

      setCountText(itemCount, filteredItems.length, 'élément', 'éléments');

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
        const labels = buildCreatedModifiedLabels(item, userNamesById);
        htmlParts.push(`
            <article class="list-card">
              ${permissions.canDelete && !permissions.isLecture ? `<button class="list-card__delete-button" type="button" data-item-delete="${item.id}" aria-label="Supprimer" title="Supprimer">×</button>` : ''}
              <button class="list-card__button" type="button" data-item-open="${item.id}">
                <h3 class="list-card__title">${escapeHtml(item.numero)}</h3>
                <div class="list-card__meta">
                  <span>${detailCountsByItem[item.id] || 0} Article${(detailCountsByItem[item.id] || 0) > 1 ? 's' : ''}</span>
                  <span>${escapeHtml(labels.createdLabel)}</span>
                  <small>${escapeHtml(labels.modifiedLabel)}</small>
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

      itemList.querySelectorAll('[data-item-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          const removedSnapshot = await StorageService.removeItem(siteId, button.dataset.itemDelete);
          if (!removedSnapshot) {
            UiService.showToast('Suppression impossible.');
            return;
          }
          UiService.showUndoSnackbar('Élément supprimé.', async () => {
            const restored = await StorageService.restoreItem(removedSnapshot);
            UiService.showToast(restored ? 'Suppression annulée.' : 'Restauration impossible.');
          });
        });
      });
    }

    const openCreateItem = requireElement('openCreateItem');
    if (!permissions.canCreate && openCreateItem) {
      openCreateItem.hidden = true;
    }

    openCreateItem?.addEventListener('click', () => {
      itemForm.reset();
      itemFormError.textContent = '';
      itemDialog.showModal();
      itemNumberInput.focus();
    });

    itemNumberInput.addEventListener('input', () => {
      const digitsOnly = itemNumberInput.value.replace(/\D/g, '');
      if (itemNumberInput.value !== digitsOnly) {
        itemNumberInput.value = digitsOnly;
      }
    });

    if (openExportItems) {
      openExportItems.addEventListener('click', exportItems);
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
      itemDateFilter.addEventListener('change', () => {
        selectedDateFilter = itemDateFilter.value || 'all';
        window.localStorage.setItem(dateFilterStorageKey, selectedDateFilter);
        renderItems();
      });
    }

    itemForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = itemNumberInput.value.trim();
      if (!value) {
        itemFormError.textContent = 'Veuillez remplir ce champ';
        return;
      }
      if (!/^\d+$/.test(value)) {
        itemFormError.textContent = 'Veuillez saisir des chiffres uniquement.';
        return;
      }
      if (value.length < 4) {
        itemFormError.textContent = 'Veuillez saisir au moins 4 chiffres.';
        return;
      }
      if (!permissions.canCreate) {
        itemFormError.textContent = 'Action non autorisée.';
        return;
      }
      const result = await StorageService.createItem(siteId, value);
      if (!result?.ok) {
        itemFormError.textContent =
          result?.reason === 'duplicate_out'
            ? 'Ce N° OUT existe déjà pour ce site.'
            : 'Veuillez saisir au moins 4 chiffres.';
        return;
      }
      itemDialog.close();
      UiService.showToast('N° OUT ajouté .');
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
    const detailCount = requireElement('detailCount');
    const detailTableBody = requireElement('detailTableBody');
    const detailSearchInput = requireElement('detailSearchInput');
    const exportButton = requireElement('exportDetailsButton');
    const codeInput = requireElement('codeInput');
    const designationInput = requireElement('designationInput');
    const codeSuggestions = requireElement('codeSuggestions');

    setupZoomableDetailTable();

    let currentSite = StorageService.getSite(siteId);
    let currentItem = StorageService.getItem(siteId, itemId);
    let currentDetails = [];
    let codeSuggestionSource = [];
    let visibleCodeSuggestions = [];
    let activeSuggestionIndex = -1;

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

    if (!permissions.canCreate || permissions.isLecture) {
      detailFormSection.hidden = true;
    }

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
      if (filteredCount === totalCount) {
        setCountText(detailCount, totalCount, 'Article', 'Article');
        return;
      }
      detailCount.textContent = `${filteredCount} Article${filteredCount > 1 ? 's' : ''} affichée${filteredCount > 1 ? 's' : ''} / ${totalCount}`;
    }

    function exportDetails() {
      if (!currentItem || !currentSite) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(currentDetails);
      if (!filteredDetails.length) {
        UiService.showToast('Aucune Article à exporter.');
        return;
      }

      const fileName = `${currentSite.nom} · ${currentItem.numero}.xls`;
      const workbook = buildDetailExcelContent(`${currentSite.nom} · ${currentItem.numero}`, filteredDetails);
      downloadExcelFile(fileName, 'Export Excel', workbook);
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
          (detail) => {
            const ecart = computeEcart(detail);
            const ecartClassName = typeof ecart === 'number' && ecart !== 0 ? ' cell-input--ecart-alert' : '';
            return `
            <tr data-detail-id="${detail.id}">
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

      detailTableBody.querySelectorAll('[data-field]').forEach((field) => {
        if (!permissions.canEdit) {
          field.disabled = true;
        }
        if (!permissions.canEdit) {
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
          const removed = await StorageService.removeDetail(siteId, itemId, button.dataset.detailDelete);
          UiService.showToast(removed ? 'Article supprimée.' : 'Suppression impossible.');
        });
      });
    }

    detailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      detailFormError.textContent = '';
      if (!designationInput.value.trim()) {
        detailFormError.textContent = 'Veuillez remplir le champ.';
        return;
      }
      if (!permissions.canCreate) {
        detailFormError.textContent = 'Action non autorisée.';
        return;
      }

      const result = await StorageService.createDetail(siteId, itemId, {
        code: requireElement('codeInput').value,
        designation: designationInput.value,
        qteSortie: requireElement('qteSortieInput').value,
        unite: requireElement('uniteInput').value,
      });
      if (!result?.ok) {
        detailFormError.textContent =
          result?.reason === 'duplicate_designation'
            ? 'Cette désignation existe déjà pour ce N° OUT.'
            : 'Création impossible. Vérifiez la désignation.';
        return;
      }
      detailForm.reset();
      requireElement('uniteInput').value = 'm';
      hideCodeSuggestions();
      UiService.showToast('Article ajoutée .');
    });

    if (codeInput && codeSuggestions) {
      codeInput.addEventListener('focus', () => {
        if (!String(codeInput.value || '').trim()) {
          hideCodeSuggestions();
          return;
        }
        renderCodeSuggestions(codeInput.value);
      });

      codeInput.addEventListener('input', () => {
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

    if (detailSearchInput) {
      detailSearchInput.addEventListener('input', renderTable);
    }

    if (exportButton) {
      exportButton.addEventListener('click', exportDetails);
    }

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
    });

    StorageService.subscribeDetails(
      siteId,
      itemId,
      (details) => {
        currentDetails = details;
        renderTable();
      },
      () => {
        UiService.showToast('Synchronisation  indisponible.');
      },
    );

    renderTitle();
    refreshCodeSuggestionSource();
  }



  async function initUsersPage(permissions) {
    if (!permissions.isAdmin) {
      UiService.navigate('index.html');
      return;
    }

    const tableBody = requireElement('usersTableBody');
    const backButton = requireElement('usersBackButton');
    const maintenanceToggle = requireElement('maintenanceToggle');
    const maintenanceStatusText = requireElement('maintenanceStatusText');
    backButton?.addEventListener('click', () => UiService.navigate('index.html'));

    const roleLabel = { lecture: 'Lecture seule', ecriture: 'Écriture seule', full: 'Tout accès' };

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
              ${user.avatarUrl
      ? `<img class="table-avatar" src="${escapeHtml(user.avatarUrl)}" alt="Avatar de ${escapeHtml(user.username)}" />`
      : `<span class="table-avatar table-avatar--fallback">${escapeHtml(getInitialsFromName(user.username))}</span>`}
            </td>
            <td>${escapeHtml(user.username)}</td>
            <td>
              ${user.username === 'Admin' ? 'Admin' : `
              <select data-user-role="${user.id}">
                <option value="lecture" ${user.role === 'lecture' ? 'selected' : ''}>${roleLabel.lecture}</option>
                <option value="ecriture" ${user.role === 'ecriture' ? 'selected' : ''}>${roleLabel.ecriture}</option>
                <option value="full" ${user.role === 'full' ? 'selected' : ''}>${roleLabel.full}</option>
              </select>`}
            </td>
            <td class="maintenance-access-cell">
              <input
                type="checkbox"
                class="maintenance-access-checkbox"
                data-user-maintenance-access="${user.id}"
                ${user.maintenanceAccess ? 'checked' : ''}
                aria-label="Autoriser ${escapeHtml(user.username)} pendant la maintenance"
              />
            </td>
            <td>
              ${user.username === 'Admin'
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

    nextProfile.role = 'full';
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

    initMaintenanceGate(permissions);

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
