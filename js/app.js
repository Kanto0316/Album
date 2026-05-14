import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseAuth, firebaseDb } from './firebase-core.js';

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


  function toFileSlug(value, fallback = 'intelcia-andranomena') {
    const normalized = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  function buildExportTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
  }

  function buildPage2ExportFileName(siteName, extension = 'xls') {
    const safeSiteName = toFileSlug(siteName);
    const timestamp = buildExportTimestamp();
    return `suivi-materiel-${safeSiteName}-${timestamp}.${extension}`;
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
    let normalizedDateValue = dateValue;
    if (typeof dateValue?.toDate === 'function') {
      normalizedDateValue = dateValue.toDate();
    } else if (dateValue instanceof Date) {
      normalizedDateValue = dateValue;
    } else if (typeof dateValue?.seconds === 'number') {
      normalizedDateValue = new Date(dateValue.seconds * 1000);
    }
    const parsedDate = new Date(normalizedDateValue);
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
    if (!value) {
      return null;
    }
    let normalizedValue = value;
    if (typeof value?.toDate === 'function') {
      normalizedValue = value.toDate();
    } else if (typeof value?.seconds === 'number') {
      normalizedValue = new Date(value.seconds * 1000);
    }
    const parsed = new Date(normalizedValue);
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
    const qteRebus = Number(detail?.qteRebus) || 0;

    if (qtePosee === 0 && qteRetour === 0 && qteRebus === 0) {
      return '';
    }

    return qteSortie - (qtePosee + qteRetour + qteRebus);
  }

  function formatReturnDate(dateValue) {
    const normalized = String(dateValue || '').trim();
    if (!normalized) {
      return '';
    }
    const [year, month, day] = normalized.split('-');
    if (!year || !month || !day) {
      return '';
    }
    return `${day}/${month}/${year}`;
  }

  function normalizeDetailStatut(value) {
    return String(value || '').trim().toUpperCase() === 'K.O' ? 'K.O' : 'OK';
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

  function formatExcelCellValue(value) {
    if (value === null || value === undefined) {
      return '-';
    }
    if (typeof value === 'string' && value.trim() === '') {
      return '-';
    }
    return value;
  }

  function buildDetailExcelContent(title, details) {
    const rows = details
      .map(
        (detail) => `
            <tr>
              <td>${escapeHtml(formatExcelCellValue(detail.champ))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.code))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.designation))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.qteSortie))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.unite))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.qtePosee))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.qteRebus))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.qteRetour))}</td>
              <td>${escapeHtml(formatExcelCellValue(formatReturnDate(detail.dateRetour)))}</td>
              <td>${escapeHtml(formatExcelCellValue(computeEcart(detail)))}</td>
              <td>${escapeHtml(formatExcelCellValue(detail.observation))}</td>
              <td>${escapeHtml(formatExcelCellValue(normalizeDetailStatut(detail.statut)))}</td>
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
      table { border-collapse: collapse; width: 100%; table-layout: fixed; }
      th, td {
        border: 1px solid #cfd8e3;
        padding: 8px 10px;
        vertical-align: middle;
        white-space: normal;
        word-break: break-word;
      }
      th {
        font-weight: 700;
        background: #f3f6fa;
        position: sticky;
        top: 0;
        z-index: 1;
        text-align: left;
      }
      td { text-align: left; }
      td:nth-child(4),
      td:nth-child(6),
      td:nth-child(7),
      td:nth-child(8),
      td:nth-child(10) {
        text-align: right;
      }
      td:nth-child(5),
      td:nth-child(12) {
        text-align: center;
      }
    </style>
  </head>
  <body>
    <table>
      <colgroup>
        <col style="width: 18ch;" />
        <col style="width: 18ch;" />
        <col style="width: 40ch;" />
        <col style="width: 14ch;" />
        <col style="width: 10ch;" />
        <col style="width: 14ch;" />
        <col style="width: 14ch;" />
        <col style="width: 14ch;" />
        <col style="width: 22ch;" />
        <col style="width: 12ch;" />
        <col style="width: 30ch;" />
        <col style="width: 12ch;" />
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>Code</th>
          <th>Désignation</th>
          <th>Qté Sortie</th>
          <th>Unité</th>
          <th>Qté posée</th>
          <th>Qté Rebus</th>
          <th>Qté Retour</th>
          <th>Date de retour</th>
          <th>Ecart</th>
          <th>Remarque</th>
          <th>Statut</th>
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
            <td>${escapeHtml(formatExcelCellValue(row.out))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.code))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.designation))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.qteSortie))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.unite))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.qtePosee))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.qteRebus))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.qteRetour))}</td>
            <td>${escapeHtml(formatExcelCellValue(formatReturnDate(row.dateRetour)))}</td>
            <td>${escapeHtml(formatExcelCellValue(computeEcart(row)))}</td>
            <td>${escapeHtml(formatExcelCellValue(row.observation))}</td>
            <td>${escapeHtml(formatExcelCellValue(normalizeDetailStatut(row.statut)))}</td>
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
      table { border-collapse: collapse; width: 100%; table-layout: fixed; }
      th, td {
        border: 1px solid #cfd8e3;
        padding: 8px 10px;
        vertical-align: middle;
        white-space: normal;
        word-break: break-word;
      }
      th {
        font-weight: 700;
        background: #f3f6fa;
        position: sticky;
        top: 0;
        z-index: 1;
        text-align: left;
      }
      td { text-align: left; }
      td:nth-child(4),
      td:nth-child(6),
      td:nth-child(7),
      td:nth-child(8),
      td:nth-child(10) {
        text-align: right;
      }
      td:nth-child(5),
      td:nth-child(12) {
        text-align: center;
      }
    </style>
  </head>
  <body>
    <table>
      <colgroup>
        <col style="width: 18ch;" />
        <col style="width: 18ch;" />
        <col style="width: 40ch;" />
        <col style="width: 14ch;" />
        <col style="width: 10ch;" />
        <col style="width: 14ch;" />
        <col style="width: 14ch;" />
        <col style="width: 14ch;" />
        <col style="width: 22ch;" />
        <col style="width: 12ch;" />
        <col style="width: 30ch;" />
        <col style="width: 12ch;" />
      </colgroup>
      <thead>
        <tr>
          <th>OUT</th>
          <th>Code</th>
          <th>Désignation</th>
          <th>Qté Sortie</th>
          <th>Unité</th>
          <th>Qté posée</th>
          <th>Qté Rebus</th>
          <th>Qté Retour</th>
          <th>Date de retour</th>
          <th>Ecart</th>
          <th>Remarque</th>
          <th>Statut</th>
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
    const openExportItems = requireElement('headerExportBtn');
    const siteExportDialog = requireElement('siteExportDialog');
    const siteExportForm = requireElement('siteExportForm');
    const siteExportFileNameInput = requireElement('siteExportFileNameInput');
    const siteExportLineFilterSelect = requireElement('siteExportLineFilterSelect');
    const siteExportFileNameError = requireElement('siteExportFileNameError');
    const siteExportSubmitButton = requireElement('siteExportSubmitButton');
    const siteExportCancelButton = requireElement('siteExportCancelButton');
    const purchaseModal = requireElement('purchaseModal');
    const purchaseForm = requireElement('purchaseForm');
    const purchaseDesignation = requireElement('purchaseDesignation');
    const purchaseDesignationCounter = requireElement('purchaseDesignationCounter');
    const purchaseQty = requireElement('purchaseQty');
    const purchaseUnit = requireElement('purchaseUnit');
    const purchaseStore = requireElement('purchaseStore');
    const purchasePhotoInput = requireElement('purchasePhotoInput');
    const purchasePhotoPreviewWrap = requireElement('purchasePhotoPreviewWrap');
    const purchasePhotoPreview = requireElement('purchasePhotoPreview');
    const purchaseFormError = requireElement('purchaseFormError');
    const purchaseDesignationError = requireElement('purchaseDesignationError');
    const purchaseQtyError = requireElement('purchaseQtyError');
    const purchaseUnitError = requireElement('purchaseUnitError');
    const cancelPurchaseBtn = requireElement('cancelPurchaseBtn');
    const savePurchaseBtn = requireElement('savePurchaseBtn');
    const editPurchaseModal = document.getElementById('editPurchaseModal');
    const editPurchaseForm = document.getElementById('editPurchaseForm');
    const editPurchaseNameInput = document.getElementById('editPurchaseNameInput');
    const editPurchaseNameCounter = document.getElementById('editPurchaseNameCounter');
    const editPurchaseFormError = document.getElementById('editPurchaseFormError');
    const cancelEditPurchaseBtn = document.getElementById('cancelEditPurchaseBtn');
    const saveEditPurchaseBtn = document.getElementById('saveEditPurchaseBtn');
    const editOutNameModal = document.getElementById('editOutNameModal');
    const editOutNameForm = document.getElementById('editOutNameForm');
    const editOutNameInput = document.getElementById('editOutNameInput');
    const editOutNameCounter = document.getElementById('editOutNameCounter');
    const editOutNameFormError = document.getElementById('editOutNameFormError');
    const cancelEditOutNameBtn = document.getElementById('cancelEditOutNameBtn');
    const saveEditOutNameBtn = document.getElementById('saveEditOutNameBtn');
    const itemSearchInput = requireElement('itemSearchInput');
    const itemDateFilter = requireElement('itemDateFilter');
    const itemDialogTitle = itemDialog?.querySelector('.modal-header h2');
    const itemNumberLabel = itemDialog?.querySelector('.input-group--item-create > span');

    let currentSite = StorageService.getSite(siteId);
    let currentItems = [];
    let currentPurchases = [];
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
    const searchReadIdsStorageKey = 'page2_search_read_ids';
    const cursorFilterReadOutsStorageKey = 'page2_cursor_filter_read_outs';
    const cursorFilterActiveStorageKey = 'page2_cursor_filter_active';
    const outPageScrollStorageKey = 'outPageScrollY';
    const filterChipButtons = Array.from(document.querySelectorAll('[data-filter-chip]'));
    const itemStatusFilterButton = document.getElementById('itemStatusFilterButton');
    const itemStatusFilterMenu = document.getElementById('itemStatusFilterMenu');
    const itemStatusFilterOptions = Array.from(document.querySelectorAll('[data-item-status-filter]'));
    let selectedDateFilter = window.localStorage.getItem(dateFilterStorageKey) || 'all';
    const statusFilterKeyByLabel = {
      'Tous': 'all',
      'À faire': 'todo',
      'À corriger': 'fix',
      'Complété': 'done',
      'K.O': 'ko',
    };
    const statusFilterLabelByKey = {
      all: 'Tous',
      todo: 'À faire',
      fix: 'À corriger',
      done: 'Complété',
      ko: 'K.O',
    };
    const storedCursorFilterLabel = window.localStorage.getItem(cursorFilterActiveStorageKey) || 'Tous';
    let activeStatusFilter = statusFilterKeyByLabel[storedCursorFilterLabel] || 'all';
    const readCursorFilterOuts = new Set();
    itemSearchInput.value = window.localStorage.getItem(searchStorageKey) || '';
    try {
      const initialPage2SearchValue = String(itemSearchInput.value || '');
      if (initialPage2SearchValue) {
        window.localStorage.setItem('page2_search_value', initialPage2SearchValue);
      } else {
        window.localStorage.removeItem('page2_search_value');
      }
    } catch (_error) {
      // Ignore localStorage restrictions.
    }
    let hasPendingOutScrollRestore = true;
    let selectedPurchasePhotoFile = null;
    let selectedPurchasePhotoPreviewUrl = '';

    function persistOutPageScrollPosition() {
      if (activeSiteTab !== 'outs') {
        return;
      }
      try {
        window.localStorage.setItem(outPageScrollStorageKey, String(Math.max(0, Math.round(window.scrollY || 0))));
      } catch (_error) {
        // Ignore localStorage restrictions.
      }
    }

    function restoreOutPageScrollPosition() {
      if (!hasPendingOutScrollRestore || activeSiteTab !== 'outs') {
        return;
      }
      hasPendingOutScrollRestore = false;
      let savedScrollY = 0;
      try {
        savedScrollY = Number.parseInt(window.localStorage.getItem(outPageScrollStorageKey) || '0', 10);
      } catch (_error) {
        savedScrollY = 0;
      }
      if (!Number.isFinite(savedScrollY) || savedScrollY <= 0) {
        return;
      }
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          window.scrollTo(0, savedScrollY);
        }, 40);
      });
    }

    siteTitle.textContent = currentSite ? currentSite.nom : 'Chargement...';

    function resetPurchaseForm() {
      purchaseForm?.reset();
      if (purchaseUnit) {
        purchaseUnit.value = 'Pcs';
      }
      if (purchaseFormError) {
        purchaseFormError.textContent = '';
      }
      clearPurchaseFieldError(purchaseDesignation, purchaseDesignationError);
      clearPurchaseFieldError(purchaseQty, purchaseQtyError);
      clearPurchaseFieldError(purchaseUnit, purchaseUnitError);
      selectedPurchasePhotoFile = null;
      if (selectedPurchasePhotoPreviewUrl) {
        URL.revokeObjectURL(selectedPurchasePhotoPreviewUrl);
        selectedPurchasePhotoPreviewUrl = '';
      }
      if (purchasePhotoPreview) {
        purchasePhotoPreview.src = '';
      }
      purchasePhotoPreviewWrap?.classList.add('hidden');
    }

    function getCloudinaryUploadConfig() {
      return {
        uploadPreset: 'Suivi_matériel',
        uploadUrl: 'https://api.cloudinary.com/v1_1/dskw13nem/image/upload',
      };
    }

    async function uploadPurchaseImageToCloudinary(file) {
      if (!file) {
        return '';
      }
      const { uploadPreset, uploadUrl } = getCloudinaryUploadConfig();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Erreur Cloudinary :', data);
        throw new Error(data.error?.message || 'Upload Cloudinary échoué');
      }

      const imageUrl = String(data?.secure_url || '').trim();
      if (!imageUrl) {
        console.error('Erreur Cloudinary :', data);
        throw new Error('Upload Cloudinary échoué');
      }

      return imageUrl;
    }

    function showPurchaseFieldError(field, errorElement, message) {
      if (errorElement) {
        errorElement.textContent = message;
      }
      field?.classList.remove('input-error', 'is-error', 'is-shaking', 'shake');
      void field?.offsetWidth;
      field?.classList.add('input-error', 'is-error', 'is-shaking', 'shake');
      field?.focus();
    }

    function clearPurchaseFieldError(field, errorElement) {
      if (errorElement) {
        errorElement.textContent = '';
      }
      field?.classList.remove('input-error', 'is-error', 'is-shaking', 'shake');
    }

    function setPurchaseSubmitLoadingState(isLoading) {
      if (!savePurchaseBtn) return;
      savePurchaseBtn.disabled = isLoading;
      savePurchaseBtn.classList.toggle('is-loading', isLoading);
    }

    function openCreatePurchaseModal() {
      resetPurchaseForm();
      updatePurchaseDesignationCounter();
      purchaseModal?.showModal();
      purchaseDesignation?.focus();
    }

    function updatePurchaseDesignationCounter() {
      if (!purchaseDesignation || !purchaseDesignationCounter) return;
      if (purchaseDesignation.value.length > 25) {
        purchaseDesignation.value = purchaseDesignation.value.slice(0, 25);
      }
      purchaseDesignationCounter.textContent = `${purchaseDesignation.value.length} / 25`;
    }

    function updateEditPurchaseCounter() {
      if (!editPurchaseNameInput || !editPurchaseNameCounter) return;
      if (editPurchaseNameInput.value.length > 25) {
        editPurchaseNameInput.value = editPurchaseNameInput.value.slice(0, 25);
      }
      editPurchaseNameCounter.textContent = `${editPurchaseNameInput.value.length} / 25`;
    }

    function showEditPurchaseFieldError(message) {
      if (!editPurchaseFormError) return;
      editPurchaseFormError.textContent = message;
      editPurchaseFormError.style.color = 'var(--danger)';
      editPurchaseNameInput?.classList.remove('is-shaking');
      void editPurchaseNameInput?.offsetWidth;
      editPurchaseNameInput?.classList.add('input-error', 'is-error', 'is-shaking', 'shake');
    }

    function clearEditPurchaseFieldError() {
      if (!editPurchaseFormError) return;
      editPurchaseFormError.textContent = '';
      editPurchaseFormError.style.color = '';
      editPurchaseNameInput?.classList.remove('input-error', 'is-error', 'is-shaking', 'shake');
    }

    function setEditPurchaseSubmitLoadingState(isLoading) {
      if (!saveEditPurchaseBtn) return;
      saveEditPurchaseBtn.disabled = isLoading;
      saveEditPurchaseBtn.classList.toggle('is-loading', isLoading);
    }

    function updateEditOutNameCounter() {
      if (!editOutNameInput || !editOutNameCounter) return;
      if (editOutNameInput.value.length > 25) {
        editOutNameInput.value = editOutNameInput.value.slice(0, 25);
      }
      editOutNameCounter.textContent = `${editOutNameInput.value.length} / 25`;
    }

    function showEditOutNameFieldError(message) {
      if (!editOutNameFormError) return;
      editOutNameFormError.textContent = message;
      editOutNameFormError.style.color = 'var(--danger)';
      editOutNameInput?.classList.remove('is-shaking');
      void editOutNameInput?.offsetWidth;
      editOutNameInput?.classList.add('input-error', 'is-error', 'is-shaking', 'shake');
    }

    function clearEditOutNameFieldError() {
      if (!editOutNameFormError) return;
      editOutNameFormError.textContent = '';
      editOutNameFormError.style.color = '';
      editOutNameInput?.classList.remove('input-error', 'is-error', 'is-shaking', 'shake');
    }

    function setEditOutNameSubmitLoadingState(isLoading) {
      if (!saveEditOutNameBtn) return;
      saveEditOutNameBtn.disabled = isLoading;
      saveEditOutNameBtn.classList.toggle('is-loading', isLoading);
    }

    function openEditOutNameModal(item) {
      if (!item || !editOutNameModal || !editOutNameInput) return;
      selectedOutItemId = item.id;
      editOutNameInput.value = normalizeItemNumberInput(item.numero || '');
      clearEditOutNameFieldError();
      updateEditOutNameCounter();
      editOutNameModal.showModal();
      window.setTimeout(() => editOutNameInput.focus(), 150);
    }

    function openEditPurchaseModal(purchase) {
      if (!purchase || !editPurchaseModal || !editPurchaseNameInput) return;
      selectedPurchaseId = purchase.id;
      selectedPurchaseData = purchase;
      editPurchaseNameInput.value = String(purchase.designation || '');
      clearEditPurchaseFieldError();
      updateEditPurchaseCounter();
      editPurchaseModal.showModal();
      window.setTimeout(() => editPurchaseNameInput.focus(), 150);
    }

    async function savePurchase() {
      clearPurchaseFieldError(purchaseDesignation, purchaseDesignationError);
      clearPurchaseFieldError(purchaseQty, purchaseQtyError);
      clearPurchaseFieldError(purchaseUnit, purchaseUnitError);
      if (purchaseFormError) {
        purchaseFormError.textContent = '';
      }
      const designation = String(purchaseDesignation?.value || '').trim();
      const qty = Number(purchaseQty?.value);
      const unit = String(purchaseUnit?.value || '').trim();
      const store = String(purchaseStore?.value || '').trim();
      if (!designation) {
        showPurchaseFieldError(purchaseDesignation, purchaseDesignationError, 'Désignation obligatoire');
        return;
      }
      if (!qty || qty <= 0) {
        showPurchaseFieldError(purchaseQty, purchaseQtyError, 'Quantité invalide');
        return;
      }
      if (!['Pcs', 'm'].includes(unit)) {
        showPurchaseFieldError(purchaseUnit, purchaseUnitError, 'Unité invalide');
        return;
      }
      const currentUserName = String(
        permissions?.username
        || firebaseAuth.currentUser?.displayName
        || firebaseAuth.currentUser?.email
        || '',
      ).trim();
      const currentUserEmail = String(firebaseAuth.currentUser?.email || '').trim();
      setPurchaseSubmitLoadingState(true);
      try {
        const imageUrl = selectedPurchasePhotoFile ? await uploadPurchaseImageToCloudinary(selectedPurchasePhotoFile) : '';
        const purchasePayload = {
          designation,
          qty,
          unit,
          store,
          magasin: store,
          createdAt: serverTimestamp(),
          createdBy: currentUserName || 'Utilisateur',
          createdByEmail: currentUserEmail || '',
          siteId,
          siteName: currentSite?.nom || '',
        };
        if (imageUrl) {
          purchasePayload.imageUrl = imageUrl;
        }
        await addDoc(
          collection(firebaseDb, 'sites', siteId, 'achatsMateriels'),
          purchasePayload,
        );
        purchaseModal?.close();
        resetPurchaseForm();
        await loadPurchasesForCurrentSite();
      } catch (_error) {
        if (purchaseFormError) {
          purchaseFormError.textContent = 'Erreur lors de l’enregistrement de l’achat';
        }
      } finally {
        setPurchaseSubmitLoadingState(false);
      }
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
      renderItems(options);
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
          qteRebus: detail.qteRebus,
          qteRetour: detail.qteRetour,
          dateRetour: detail.dateRetour || '',
          observation: detail.observation,
          statut: normalizeDetailStatut(detail.statut),
        })),
      );
    }

    async function exportItems(fileNameOverride, lineFilterOverride) {
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

      const selectedLineFilter = String(lineFilterOverride || siteExportLineFilterSelect?.value || 'all').trim() || 'all';
      const filteredRows = rows.filter((row) => matchesStatusClassification(row, selectedLineFilter));
      if (!filteredRows.length) {
        UiService.showToast('Aucune donnée');
        return;
      }

      const sortedRows = [...filteredRows].sort((a, b) => {
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
      const fileName = buildPage2ExportFileName(currentSite?.nom, 'xls');
      downloadExcelFile(fileName, 'Export Excel', workbook);
      saveExportFileNameToHistory(fileName);
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
      if (siteExportLineFilterSelect) {
        siteExportLineFilterSelect.value = '';
      }
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
        title.textContent = activeSiteTab === 'purchases' ? `Supprimer ${normalizedLabel} ?` : `Supprimer cet ${normalizedLabel} ?`;
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

    let selectedPurchaseId = null;
    let selectedPurchaseData = null;
    let selectedOutItemId = null;

    function openItemActionSheet(itemId) {
      const overlay = ensureItemActionBottomSheet();
      const sheet = overlay.querySelector('#itemActionSheet');
      const title = overlay.querySelector('#itemActionSheetTitle');
      const editNameButton = overlay.querySelector('#itemActionEditNameButton');
      const deleteButton = overlay.querySelector('#itemActionDeleteButton');
      if (!sheet || !title || !editNameButton || !deleteButton) {
        return;
      }

      const isPurchaseActions = activeSiteTab === 'purchases';
      const activeItem = isPurchaseActions
        ? currentPurchases.find((item) => item.id === itemId)
        : currentItems.find((item) => item.id === itemId);
      if (!activeItem) {
        return;
      }

      itemActionState.activeItemId = itemId;
      title.textContent = isPurchaseActions
        ? (String(activeItem.designation || '').trim() || 'Achat matériel')
        : (String(activeItem.numero || '').trim() || 'Actions');
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
      const openOutEditModal = (targetItem) => {
        openEditOutNameModal(targetItem);
      };
      editNameButton.onclick = async () => {
        await closeSheet();
        const targetItem = isPurchaseActions
          ? currentPurchases.find((item) => item.id === itemId)
          : currentItems.find((item) => item.id === itemId);
        if (!targetItem) {
          return;
        }
        if (isPurchaseActions) {
          openEditPurchaseModal(targetItem);
          return;
        }

        // Sécurise l'ordre de transition: fermeture complète du bottom-sheet avant ouverture du modal.
        document.body.classList.remove('sidebar-open');
        overlay.classList.remove('is-open');
        overlay.hidden = true;
        window.setTimeout(() => {
          openOutEditModal(targetItem);
        }, 30);
      };
      deleteButton.onclick = async () => {
        deleteButton.disabled = true;
        try {
          await closeSheet();
          selectedPurchaseId = isPurchaseActions ? itemId : null;
          selectedPurchaseData = isPurchaseActions ? activeItem : null;
          const shouldDelete = await askItemDeleteConfirmation(
            isPurchaseActions ? (activeItem.designation || 'achat matériel') : (activeItem.numero || 'cet élément'),
          );
          if (!shouldDelete) {
            return;
          }
          if (isPurchaseActions) {
            await deleteDoc(doc(firebaseDb, 'sites', siteId, 'achatsMateriels', selectedPurchaseId));
            await loadPurchasesForCurrentSite();
            setActiveSiteTab('purchases');
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

    function renderItems(options = {}) {
      const shouldFlashSearchMatches = Boolean(options?.flashSearchMatches);
      const query = itemSearchInput.value.trim().toUpperCase();
      const filteredItems = getFilteredOutItems(query);
      updateCursorFilterCounters();

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
          htmlParts.push(renderListSeparator(currentLabel));
        }
        previousLabel = currentLabel;
        const createdBy = resolveActorLabel(item?.createdBy, userNamesById, item?.createdByName);
        const createdLabel = buildDateAndTimeLabel(item?.dateCreation || item?.dateModification);
        const detailCountForCard = getOutDetailCountForActiveFilter(item.id, query);
        const isCursorFilterActive = activeStatusFilter !== 'all' && !query;
        const isSearchUnread = query && !readSearchResults.has(String(item.id));
        const isCursorFilterUnread = isCursorFilterActive && !readCursorFilterOuts.has(String(item.id));
        const unreadClassName = (isCursorFilterUnread || isSearchUnread) ? ' list-card--search-unread' : '';
        htmlParts.push(`
            <article class="list-card${unreadClassName}" data-search-match="true" data-item-id="${escapeHtml(item.id)}">
              ${permissions.canDelete && !permissions.isLecture ? `<button class="list-card__menu-button" type="button" data-item-menu="${item.id}" aria-label="Plus d'actions" title="Plus d'actions"><img src="Icon/Trois point.png" alt="" aria-hidden="true" class="list-card__menu-icon" /></button>` : ''}
              <button class="list-card__button" type="button" data-item-open="${item.id}">
                <h3 class="list-card__title">${escapeHtml(item.numero)}</h3>
                <div class="list-card__meta">
                  <span class="list-card__meta-item list-card__meta-item--article"><img src="Icon/Article.png" alt="" aria-hidden="true" class="icon" /><span class="outs-count"><span class="outs-number">${detailCountForCard}</span><span class="outs-label">Article${detailCountForCard > 1 ? 's' : ''}</span></span></span>
                  <span class="list-card__meta-item"><img src="Icon/Date et Heure.png" alt="" aria-hidden="true" class="icon" /><span>Créé le ${escapeHtml(createdLabel)}</span></span>
                  <span class="list-card__meta-item"><img src="Icon/Utilisateur.png" alt="" aria-hidden="true" class="icon" /><span>${escapeHtml(createdBy)}</span></span>
                </div>
              </button>
            </article>
          `);
      });
      itemList.innerHTML = htmlParts.join('');

      if (query && shouldFlashSearchMatches) {
        const matchedCards = itemList.querySelectorAll('[data-search-match="true"]');
        matchedCards.forEach((card) => {
          card.classList.remove('list-card--search-flash');
          void card.offsetWidth;
          card.classList.add('list-card--search-flash');
          window.setTimeout(() => {
            card.classList.remove('list-card--search-flash');
          }, 1800);
        });
      }

      itemList.querySelectorAll('[data-item-open]').forEach((button) => {
        button.addEventListener('click', () => {
          const openedItemId = String(button.dataset.itemOpen || '');
          if (query) {
            readSearchResults.add(openedItemId);
            persistSearchReadIdsToStorage(readSearchResults);
          }
          if (activeStatusFilter !== 'all' && !query) {
            readCursorFilterOuts.add(openedItemId);
            persistCursorFilterReadIdsToStorage(readCursorFilterOuts);
          }
          const card = button.closest('.list-card');
          card?.classList.remove('list-card--search-unread');
          UiService.navigate(`page3.html?siteId=${encodeURIComponent(siteId)}&itemId=${encodeURIComponent(button.dataset.itemOpen)}&search=${encodeURIComponent(query)}`);
        });
      });

      itemList.querySelectorAll('[data-item-menu]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          openItemActionSheet(button.dataset.itemMenu);
        });
      });

      restoreOutPageScrollPosition();
    }

    function outMatchesSearch(item, query) {
      if (!query) {
        return true;
      }
      const outMatches = String(item.numero || '').toUpperCase().includes(query);
      if (outMatches) {
        return true;
      }
      const itemDesignations = detailDesignationsByItem[item.id] || [];
      return itemDesignations.some((designation) => String(designation || '').toUpperCase().includes(query));
    }

    function matchesStatusClassification(detail, filterKey) {
      const isKoStatus = normalizeDetailStatut(detail.statut) === 'K.O';
      if (filterKey === 'ko') {
        return isKoStatus;
      }
      if (isKoStatus) {
        return filterKey === 'all';
      }
      const ecart = computeEcart(detail);
      const qteSortie = Number(detail?.qteSortie) || 0;
      const qtePosee = Number(detail?.qtePosee) || 0;
      const qteRetour = Number(detail?.qteRetour) || 0;
      const qteRebus = Number(detail?.qteRebus) || 0;
      const hasActivity = qtePosee !== 0 || qteRetour !== 0 || qteRebus !== 0;
      const isDone = ecart === 0 && (qteRebus <= qteSortie || qteRetour <= qteSortie);
      const isAttention = hasActivity && ecart !== 0;
      if (filterKey === 'done') {
        return isDone;
      }
      if (filterKey === 'fix') {
        return isAttention;
      }
      if (filterKey === 'todo') {
        return !isDone && !isAttention;
      }
      return true;
    }

    function itemMatchesStatusFilter(item, filterKey) {
      if (filterKey === 'all') {
        return true;
      }
      const detailRows = detailRowsByItem[item.id] || [];
      return detailRows.some((detail) => matchesStatusClassification(detail, filterKey));
    }

    function detailMatchesOutSearch(detail, query) {
      if (!query) {
        return true;
      }
      const designation = String(detail?.designation || '').toUpperCase();
      const code = String(detail?.code || '').toUpperCase();
      return designation.includes(query) || code.includes(query);
    }

    function detailMatchesOutCombinedFilters(detail, query, filterKey) {
      const matchSearch = detailMatchesOutSearch(detail, query);
      const matchFilter = matchesStatusClassification(detail, filterKey);
      return matchSearch && matchFilter;
    }

    function itemMatchesCombinedSearchAndStatus(item, query, filterKey) {
      const detailRows = detailRowsByItem[item.id] || [];
      return detailRows.some((detail) => detailMatchesOutCombinedFilters(detail, query, filterKey));
    }

    function getMatchingDetailCountForItem(item, searchText, filterKey) {
      const query = String(searchText || '').trim().toUpperCase();
      const normalizedFilterKey = filterKey || 'all';
      const detailRows = detailRowsByItem[item.id] || [];
      return detailRows.reduce((count, detail) => {
        const outMatchesQuery = query ? String(item.numero || '').toUpperCase().includes(query) : false;
        const matchSearch = !query || outMatchesQuery ? true : detailMatchesOutSearch(detail, query);
        const matchFilter = matchesStatusClassification(detail, normalizedFilterKey);
        return count + (matchSearch && matchFilter ? 1 : 0);
      }, 0);
    }

    function getOutDetailCountForActiveFilter(itemId, query) {
      const detailRows = detailRowsByItem[itemId] || [];
      if (activeStatusFilter === 'all' && !query) {
        return Number(detailCountsByItem[itemId] || 0);
      }
      const item = currentItems.find((entry) => String(entry?.id) === String(itemId));
      if (!item) {
        return detailRows.reduce((count, detail) => count + (detailMatchesOutCombinedFilters(detail, query, activeStatusFilter) ? 1 : 0), 0);
      }
      return getMatchingDetailCountForItem(item, query, activeStatusFilter);
    }

    function getMatchingOutArticles(articleList, searchText, cursorFilter) {
      const query = String(searchText || '').trim().toUpperCase();
      const filterKey = cursorFilter || 'all';
      return articleList.filter((item) => {
        const matchSearch = query ? outMatchesSearch(item, query) : true;
        let matchFilter = true;
        if (filterKey !== 'all') {
          if (!query) {
            matchFilter = itemMatchesStatusFilter(item, filterKey);
          } else {
            matchFilter = getMatchingDetailCountForItem(item, query, filterKey) > 0;
          }
        }
        return itemMatchesDateFilter(item, selectedDateFilter) && matchSearch && matchFilter;
      });
    }

    function getFilteredOutItems(query) {
      return getMatchingOutArticles(currentItems, query, activeStatusFilter);
    }

    function getTotalMatchingDetailCount(searchText, filterKey) {
      const query = String(searchText || '').trim().toUpperCase();
      const normalizedFilterKey = filterKey || 'all';
      return currentItems.reduce((total, item) => {
        if (!itemMatchesDateFilter(item, selectedDateFilter)) {
          return total;
        }
        if (!outMatchesSearch(item, query)) {
          return total;
        }

        const matchingDetailCount = getMatchingDetailCountForItem(item, query, normalizedFilterKey);

        return total + matchingDetailCount;
      }, 0);
    }

    function updateCursorFilterCounters() {
      const query = itemSearchInput.value;
      if (!itemStatusFilterOptions.length) {
        return;
      }
      itemStatusFilterOptions.forEach((option) => {
        const filterKey = option.dataset.itemStatusFilter || 'all';
        const count = getTotalMatchingDetailCount(query, filterKey);
        const countNode = option.querySelector('.page2-filter-option__count');
        if (countNode) {
          countNode.textContent = String(count);
        }
      });
    }

    function syncItemStatusFilterUi() {
      itemStatusFilterButton?.classList.toggle('is-filtered', activeStatusFilter !== 'all');
      itemStatusFilterOptions.forEach((option) => {
        const isActive = option.dataset.itemStatusFilter === activeStatusFilter;
        option.classList.toggle('is-active', isActive);
        option.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    }

    function closeItemStatusFilterMenu() {
      if (!itemStatusFilterMenu || !itemStatusFilterButton) return;
      itemStatusFilterMenu.hidden = true;
      itemStatusFilterButton.setAttribute('aria-expanded', 'false');
    }

    function openItemStatusFilterMenu() {
      if (!itemStatusFilterMenu || !itemStatusFilterButton) return;
      itemStatusFilterMenu.hidden = false;
      itemStatusFilterButton.setAttribute('aria-expanded', 'true');
    }

    function setItemStatusFilter(filterKey) {
      const nextFilter = filterKey || 'all';
      activeStatusFilter = nextFilter;
      try {
        window.localStorage.setItem(cursorFilterActiveStorageKey, statusFilterLabelByKey[activeStatusFilter] || 'Tous');
      } catch (_error) {
        // Ignore localStorage restrictions.
      }
      if (activeStatusFilter === 'all') {
        readCursorFilterOuts.clear();
        clearCursorFilterReadIdsStorage();
      }
      syncItemStatusFilterUi();
      renderItems();
    }

    const openCreateItem = document.querySelector('body[data-page="site-detail"] #openCreateItem');
    const createItemLabel = document.querySelector(
      'body[data-page="site-detail"] .site-detail-fab-label--create',
    );
    const siteDetailFabStack = document.querySelector('body[data-page="site-detail"] .site-detail-fab-stack');
    const siteTabButtons = Array.from(document.querySelectorAll('.bottom-nav-item'));
    const bottomNavigation = document.querySelector('.bottom-navigation');
    const outsTabContent = document.getElementById('outsTabContent');
    const purchasesTabContent = document.getElementById('purchasesTabContent');
    const purchasesTabButton = document.querySelector('[data-tab="purchases"]');
    const purchasesList = document.getElementById('purchasesList');
    const purchasesEmptyState = document.getElementById('purchasesEmptyState');
    let isAdminTabAllowed = Boolean(permissions?.isAdmin);
    let activeSiteTab = 'outs';
    const PURCHASE_SEARCH_PLACEHOLDER = 'Rechercher un achat matériel';
    const OUT_SEARCH_PLACEHOLDER = 'Rechercher (OUT ou article)';
    const activeTabStorageKey = `siteDetailActiveTab:${siteId || 'default'}`;
    let itemFormErrorTimeoutId = null;
    let itemNumberErrorClearTimer = null;
    let itemAvailabilityDebounceTimer = null;
    let hasBlockingItemNumberError = false;
    let itemStoreOtherHideTimer = null;
    const itemStoreOtherTransitionDurationMs = 200;
    const ITEM_DIALOG_MODE_CREATE = 'create';
    const ITEM_DIALOG_MODE_EDIT = 'edit';
    const ITEM_DIALOG_MODE_EDIT_PURCHASE = 'edit_purchase';
    let itemDialogMode = ITEM_DIALOG_MODE_CREATE;
    let editingItemId = null;
    let activeOutSearchQuery = (itemSearchInput.value || "").trim().toUpperCase();
    function readSearchReadIdsFromStorage() {
      try {
        const rawValue = window.localStorage.getItem(searchReadIdsStorageKey);
        const parsed = JSON.parse(rawValue || '[]');
        if (!Array.isArray(parsed)) {
          return new Set();
        }
        return new Set(parsed.map((value) => String(value || '')).filter(Boolean));
      } catch (_error) {
        return new Set();
      }
    }

    function persistSearchReadIdsToStorage(readIdsSet) {
      try {
        window.localStorage.setItem(searchReadIdsStorageKey, JSON.stringify(Array.from(readIdsSet)));
      } catch (_error) {
        // Ignore localStorage restrictions.
      }
    }

    function clearSearchReadIdsStorage() {
      try {
        window.localStorage.removeItem(searchReadIdsStorageKey);
      } catch (_error) {
        // Ignore localStorage restrictions.
      }
    }

    function readCursorFilterReadIdsFromStorage() {
      try {
        const rawValue = window.localStorage.getItem(cursorFilterReadOutsStorageKey);
        const parsed = JSON.parse(rawValue || '[]');
        if (!Array.isArray(parsed)) {
          return new Set();
        }
        return new Set(parsed.map((value) => String(value || '')).filter(Boolean));
      } catch (_error) {
        return new Set();
      }
    }

    function persistCursorFilterReadIdsToStorage(readIdsSet) {
      try {
        window.localStorage.setItem(cursorFilterReadOutsStorageKey, JSON.stringify(Array.from(readIdsSet)));
      } catch (_error) {
        // Ignore localStorage restrictions.
      }
    }

    function clearCursorFilterReadIdsStorage() {
      try {
        window.localStorage.removeItem(cursorFilterReadOutsStorageKey);
      } catch (_error) {
        // Ignore localStorage restrictions.
      }
    }

    readCursorFilterReadIdsFromStorage().forEach((id) => readCursorFilterOuts.add(id));
    const readSearchResults = readSearchReadIdsFromStorage();

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

    function updateTabsByRole() {
      isAdminTabAllowed = Boolean(permissions?.isAdmin);
      siteTabButtons.forEach((tabButton) => {
        tabButton.classList.toggle('hidden', !isAdminTabAllowed);
      });
      if (bottomNavigation) {
        bottomNavigation.classList.toggle('hidden', !isAdminTabAllowed);
      }
      if (purchasesTabButton) {
        purchasesTabButton.classList.toggle('hidden', !isAdminTabAllowed);
      }
      if (!isAdminTabAllowed && activeSiteTab === 'purchases') {
        setActiveSiteTab('outs');
      }
    }

    function formatPurchaseDateLabel(purchase) {
      return buildDateAndTimeLabel(purchase?.createdAt || purchase?.dateAchat || purchase?.date || purchase?.dateCreation || purchase?.dateModification);
    }

    function renderListSeparator(title) {
      return `
        <div class="list-separator" role="separator" aria-label="${escapeHtml(title)}">
          <span class="list-separator__label">${escapeHtml(title)}</span>
        </div>
      `;
    }

    function getSavedActiveSiteTab() {
      try {
        return window.localStorage.getItem(activeTabStorageKey);
      } catch (_error) {
        return null;
      }
    }

    function saveActiveSiteTab(tabName) {
      try {
        window.localStorage.setItem(activeTabStorageKey, tabName);
      } catch (_error) {
        // Ignore localStorage restrictions.
      }
    }

    function renderPurchases() {
      const query = itemSearchInput.value.trim().toUpperCase();
      const purchases = currentPurchases.filter((purchase) => {
        if (!itemMatchesDateFilter({ dateCreation: purchase?.createdAt || purchase?.dateAchat || purchase?.date || purchase?.dateCreation || purchase?.dateModification }, selectedDateFilter)) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [purchase?.designation, purchase?.store, purchase?.magasin]
          .some((value) => String(value || '').toUpperCase().includes(query));
      });

      if (activeSiteTab === 'purchases') {
        itemCount.innerHTML = `<span class="outs-number">${purchases.length}</span><span class="outs-label">${purchases.length > 1 ? 'Achats' : 'Achat'}</span>`;
      }

      if (!purchasesList) {
        console.error('#purchasesList introuvable');
        return;
      }

      if (!purchases.length) {
        purchasesList.innerHTML = '';
        purchasesEmptyState?.classList.remove('hidden');
        return;
      }

      purchasesEmptyState?.classList.add('hidden');
      const htmlParts = [];
      let previousLabel = null;
      purchases.forEach((purchase) => {
        const purchaseStore = String(purchase?.store || purchase?.magasin || '').trim();
        const currentLabel = resolveItemPeriodLabel({
          dateCreation: purchase?.createdAt || purchase?.dateAchat || purchase?.date || purchase?.dateCreation || purchase?.dateModification,
        });
        if (currentLabel && currentLabel !== previousLabel) {
          htmlParts.push(renderListSeparator(currentLabel));
        }
        previousLabel = currentLabel;
        htmlParts.push(`
          <article class="list-card purchase-card">
            ${permissions.canDelete && !permissions.isLecture ? `<button class="list-card__menu-button" type="button" data-purchase-menu="${purchase.id}" aria-label="Plus d'actions" title="Plus d'actions"><img src="Icon/Trois point.png" alt="" aria-hidden="true" class="list-card__menu-icon" /></button>` : ''}
            <div class="list-card__button">
              <div class="purchase-card__content">
                <div class="purchase-card__media" aria-hidden="true">
                  ${String(purchase?.imageUrl || '').trim()
                    ? `<img src="${escapeHtml(purchase.imageUrl)}" alt="Photo achat matériel" />`
                    : '🖼️'}
                </div>
                <div>
                  <h3 class="list-card__title">${escapeHtml(purchase?.designation || '-')}</h3>
                  <div class="list-card__meta purchase-card__meta" role="list" aria-label="Informations achat matériel">
                    <div class="purchase-info-row" role="listitem">
                      <div class="purchase-label"><img src="Icon/Article.png" alt="" aria-hidden="true" class="icon" /><span>Quantité</span></div>
                      <div class="purchase-value">${Number(purchase?.qty || 0)} ${escapeHtml(purchase?.unit || 'Pcs')}</div>
                    </div>
                    ${purchaseStore ? `
                    <div class="purchase-info-row" role="listitem">
                      <div class="purchase-label"><span aria-hidden="true" class="icon">🏪</span><span>Magasin</span></div>
                      <div class="purchase-value">${escapeHtml(purchaseStore)}</div>
                    </div>
                    ` : ''}
                    <div class="purchase-info-row" role="listitem">
                      <div class="purchase-label"><img src="Icon/Date et Heure.png" alt="" aria-hidden="true" class="icon" /><span>Date</span></div>
                      <div class="purchase-value">${escapeHtml(formatPurchaseDateLabel(purchase))}</div>
                    </div>
                    <div class="purchase-info-row" role="listitem">
                      <div class="purchase-label"><img src="Icon/Utilisateur.png" alt="" aria-hidden="true" class="icon" /><span>Utilisateur</span></div>
                      <div class="purchase-value">${escapeHtml(purchase?.createdBy || 'Utilisateur')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>
        `);
      });
      purchasesList.innerHTML = htmlParts.join('');
      purchasesList.querySelectorAll('[data-purchase-menu]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          openItemActionSheet(button.dataset.purchaseMenu);
        });
      });
    }

    async function loadPurchasesForCurrentSite() {
      currentPurchases = [];
      if (!siteId) {
        renderPurchases();
        return;
      }
      try {
        const purchasesQuery = query(
          collection(firebaseDb, 'sites', siteId, 'achatsMateriels'),
          orderBy('createdAt', 'desc'),
        );
        const snap = await getDocs(purchasesQuery);
        currentPurchases = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
      } catch (_error) {
        currentPurchases = [];
      }
      renderPurchases();
    }

    function renderActiveTabContent(options = {}) {
      if (activeSiteTab === 'purchases') {
        renderPurchases();
        return;
      }
      renderItems();
    }

    function updateFabByActiveTab(tabName) {
      if (openCreateItem) {
        openCreateItem.classList.remove('hidden');
        openCreateItem.onclick = tabName === 'outs'
          ? null
          : () => {
              openCreatePurchaseModal();
            };
        openCreateItem.setAttribute('aria-label', tabName === 'outs' ? 'Ajouter un numéro OUT' : 'Ajouter un achat matériel');
      }
      if (createItemLabel) {
        createItemLabel.classList.remove('hidden');
        createItemLabel.textContent = tabName === 'outs' ? 'Créer un OUT' : 'Ajouter un achat';
      }
      const createButtonRow = openCreateItem?.closest('[data-fab-row="create"]');
      if (createButtonRow) {
        createButtonRow.classList.remove('hidden');
      }
      if (siteDetailFabStack) {
        siteDetailFabStack.classList.remove('hidden');
      }
    }


    function updateHeaderExportButton(tabName) {
      const exportBtn = document.querySelector('#headerExportBtn');
      if (!exportBtn) {
        return;
      }
      exportBtn.classList.toggle('hidden', tabName === 'purchases');
    }

    function setActiveSiteTab(tabName) {
      const safeTabName = tabName === 'purchases' && isAdminTabAllowed ? 'purchases' : 'outs';
      activeSiteTab = safeTabName;
      siteTabButtons.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === safeTabName);
      });
      outsTabContent?.classList.toggle('hidden', safeTabName !== 'outs');
      purchasesTabContent?.classList.toggle('hidden', safeTabName !== 'purchases');
      itemSearchInput.placeholder = safeTabName === 'outs' ? OUT_SEARCH_PLACEHOLDER : PURCHASE_SEARCH_PLACEHOLDER;
      itemSearchInput.value = safeTabName === 'outs'
        ? (window.localStorage.getItem(searchStorageKey) || '')
        : '';
      if (safeTabName === 'outs') {
        const normalizedQuery = (itemSearchInput.value || '').trim().toUpperCase();
        activeOutSearchQuery = normalizedQuery;
        if (!normalizedQuery) {
          readSearchResults.clear();
          clearSearchReadIdsStorage();
        } else {
          readSearchResults.clear();
          readSearchReadIdsFromStorage().forEach((id) => readSearchResults.add(id));
        }
      }
      saveActiveSiteTab(safeTabName);
      if (safeTabName === 'outs') {
        itemCount.innerHTML = `<span class="outs-number">0</span><span class="outs-label">OUTS</span>`;
      } else {
        itemCount.innerHTML = `<span class="outs-number">0</span><span class="outs-label">Achat</span>`;
      }
      updateFabByActiveTab(safeTabName);
      updateHeaderExportButton(safeTabName);
      renderActiveTabContent();
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
      itemDialogMode = [ITEM_DIALOG_MODE_EDIT, ITEM_DIALOG_MODE_EDIT_PURCHASE].includes(mode) ? mode : ITEM_DIALOG_MODE_CREATE;
      editingItemId = itemDialogMode === ITEM_DIALOG_MODE_CREATE ? null : targetItem?.id || null;
      itemDialog.classList.toggle('edit-out-modal', itemDialogMode === ITEM_DIALOG_MODE_EDIT);
      if (itemDialogTitle) {
        itemDialogTitle.textContent = itemDialogMode === ITEM_DIALOG_MODE_EDIT
          ? 'Modifier le nom OUT'
          : itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE
            ? 'Modifier l’achat matériel'
            : 'Nouveau numéro OUT';
      }
      if (itemNumberLabel) {
        itemNumberLabel.textContent = itemDialogMode === ITEM_DIALOG_MODE_CREATE ? 'Numéro OUT' : 'Nom';
      }
      const defaultLabel = itemCreateSubmitButton?.querySelector('.btn-label-default');
      const loadingLabel = itemCreateSubmitButton?.querySelector('.btn-label-loading');
      const isEditMode = itemDialogMode === ITEM_DIALOG_MODE_EDIT || itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE;
      if (defaultLabel) {
        defaultLabel.textContent = isEditMode ? 'Enregistrer' : 'Créer';
      }
      if (loadingLabel) {
        loadingLabel.textContent = isEditMode ? 'Enregistrement...' : 'Création...';
      }
      if (itemDialogMode === ITEM_DIALOG_MODE_EDIT) {
        itemNumberInput.setAttribute('inputmode', 'numeric');
        itemNumberInput.setAttribute('pattern', '[0-9]*');
        itemNumberInput.placeholder = 'Exemple : 26050200';
        itemNumberInput.value = normalizeItemNumberInput(targetItem?.numero || '');
      } else if (itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE) {
        itemNumberInput.setAttribute('inputmode', 'text');
        itemNumberInput.removeAttribute('pattern');
        itemNumberInput.placeholder = 'Nom achat matériel';
        itemNumberInput.value = String(targetItem?.designation || '').trim();
      } else {
        itemNumberInput.setAttribute('inputmode', 'numeric');
        itemNumberInput.setAttribute('pattern', '[0-9]*');
        itemNumberInput.placeholder = 'Exemple : 26050200';
      }
      const isCreateMode = itemDialogMode === ITEM_DIALOG_MODE_CREATE;
      itemStoreSelect?.closest('.input-group')?.toggleAttribute('hidden', !isCreateMode);
      if (!isCreateMode) {
        hideItemStoreOtherField({ immediate: true });
      }
      itemStoreOtherGroup?.toggleAttribute('hidden', !isCreateMode);
      updateItemNumberCounter();
    }

    updateCreateItemButtonVisibility(firebaseAuth.currentUser);
    updateTabsByRole();
    const savedActiveTab = getSavedActiveSiteTab();
    setActiveSiteTab(savedActiveTab === 'purchases' ? 'purchases' : 'outs');
    loadPurchasesForCurrentSite();
    siteTabButtons.forEach((tab) => {
      tab.addEventListener('click', async () => {
        const targetTab = tab.dataset.tab;
        if (targetTab === 'purchases' && !isAdminTabAllowed) {
          setActiveSiteTab('outs');
          return;
        }
        if (targetTab === 'purchases') {
          await loadPurchasesForCurrentSite();
        }
        setActiveSiteTab(targetTab);
      });
    });
    onAuthStateChanged(firebaseAuth, (user) => {
      updateCreateItemButtonVisibility(user || null);
      updateTabsByRole();
    });

    openCreateItem?.addEventListener('click', (event) => {
      if (activeSiteTab === 'purchases') {
        event.preventDefault();
        openCreatePurchaseModal();
        return;
      }
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

    cancelPurchaseBtn?.addEventListener('click', () => {
      purchaseModal?.close();
    });

    purchaseDesignation?.addEventListener('input', () => {
      if (purchaseDesignation.value.length > 25) {
        purchaseDesignation.value = purchaseDesignation.value.slice(0, 25);
      }
      updatePurchaseDesignationCounter();
      if (String(purchaseDesignation.value || '').trim()) {
        clearPurchaseFieldError(purchaseDesignation, purchaseDesignationError);
      }
    });

    purchaseQty?.addEventListener('input', () => {
      if (parseInt(purchaseQty.value, 10) > 9999) {
        purchaseQty.value = 9999;
      }
      const qty = Number(purchaseQty.value);
      if (qty > 0) {
        clearPurchaseFieldError(purchaseQty, purchaseQtyError);
      }
    });

    purchaseUnit?.addEventListener('change', () => {
      const unit = String(purchaseUnit.value || '').trim();
      if (['Pcs', 'm'].includes(unit)) {
        clearPurchaseFieldError(purchaseUnit, purchaseUnitError);
      }
    });
    purchasePhotoInput?.addEventListener('change', () => {
      const file = purchasePhotoInput.files?.[0] || null;
      selectedPurchasePhotoFile = file;
      if (selectedPurchasePhotoPreviewUrl) {
        URL.revokeObjectURL(selectedPurchasePhotoPreviewUrl);
        selectedPurchasePhotoPreviewUrl = '';
      }
      if (!file) {
        purchasePhotoPreviewWrap?.classList.add('hidden');
        if (purchasePhotoPreview) {
          purchasePhotoPreview.src = '';
        }
        return;
      }
      selectedPurchasePhotoPreviewUrl = URL.createObjectURL(file);
      if (purchasePhotoPreview) {
        purchasePhotoPreview.src = selectedPurchasePhotoPreviewUrl;
      }
      purchasePhotoPreviewWrap?.classList.remove('hidden');
    });

    editPurchaseNameInput?.addEventListener('input', () => {
      clearEditPurchaseFieldError();
      if (editPurchaseNameInput.value.length > 25) {
        editPurchaseNameInput.value = editPurchaseNameInput.value.slice(0, 25);
      }
      updateEditPurchaseCounter();
    });

    cancelEditPurchaseBtn?.addEventListener('click', () => {
      editPurchaseModal?.close();
    });

    editPurchaseForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!selectedPurchaseId || !editPurchaseNameInput) return;
      const newName = String(editPurchaseNameInput.value || '').trim();
      if (!newName) {
        showEditPurchaseFieldError('Nom obligatoire');
        editPurchaseNameInput.focus();
        return;
      }
      clearEditPurchaseFieldError();
      setEditPurchaseSubmitLoadingState(true);
      try {
        await updateDoc(
          doc(firebaseDb, 'sites', siteId, 'achatsMateriels', selectedPurchaseId),
          { designation: newName },
        );
        editPurchaseModal?.close();
        await loadPurchasesForCurrentSite();
        setActiveSiteTab('purchases');
      } finally {
        setEditPurchaseSubmitLoadingState(false);
      }
    });

    editOutNameInput?.addEventListener('input', () => {
      clearEditOutNameFieldError();
      if (editOutNameInput.value.length > 25) {
        editOutNameInput.value = editOutNameInput.value.slice(0, 25);
      }
      const normalized = normalizeItemNumberInput(editOutNameInput.value);
      if (editOutNameInput.value !== normalized) {
        editOutNameInput.value = normalized;
      }
      updateEditOutNameCounter();
    });

    cancelEditOutNameBtn?.addEventListener('click', () => {
      editOutNameModal?.close();
    });

    editOutNameForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!selectedOutItemId || !editOutNameInput) return;
      const newName = normalizeItemNumberInput(editOutNameInput.value || '');
      editOutNameInput.value = newName;
      if (!newName) {
        showEditOutNameFieldError('Nom obligatoire');
        editOutNameInput.focus();
        return;
      }
      if (newName.length < 4) {
        showEditOutNameFieldError('Le nom doit contenir au moins 4 caractères.');
        editOutNameInput.focus();
        return;
      }
      clearEditOutNameFieldError();
      setEditOutNameSubmitLoadingState(true);
      try {
        const result = await StorageService.updateItemName(siteId, selectedOutItemId, newName);
        if (!result?.ok) {
          showEditOutNameFieldError(result?.reason === 'duplicate_out' ? 'Ce N° OUT existe déjà pour ce site.' : 'Modification impossible.');
          return;
        }
        editOutNameModal?.close();
        UiService.showToast('Nom OUT mis à jour.');
      } finally {
        setEditOutNameSubmitLoadingState(false);
      }
    });

    purchaseForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await savePurchase();
    });

    updatePurchaseDesignationCounter();

    itemStoreSelect?.addEventListener('change', () => {
      updateItemStoreOtherVisibility();
      setItemCreateButtonState();
    });

    itemStoreOtherInput?.addEventListener('input', () => {
      setItemCreateButtonState();
    });

    itemNumberInput.addEventListener('beforeinput', (event) => {
      if (itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE) {
        return;
      }
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
      if (itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE) {
        return;
      }
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
      if (itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE) {
        updateItemNumberCounter();
        return;
      }
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
        const selectedLineFilter = String(siteExportLineFilterSelect?.value || 'all').trim() || 'all';
        siteExportSubmitButton.disabled = true;
        siteExportSubmitButton.classList.add('is-loading');
        try {
          await exportItems(fileName, selectedLineFilter);
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
      siteDetailFabStack.classList.remove('is-scroll-hidden');
      siteDetailScrollContainer?.addEventListener('scroll', persistOutPageScrollPosition, { passive: true });
    }

    itemSearchInput.addEventListener('input', () => {
      const isOutSearchInput = activeSiteTab === 'outs';
      if (isOutSearchInput) {
        const searchValue = itemSearchInput.value;
        if (searchValue) {
          window.localStorage.setItem(searchStorageKey, searchValue);
          window.localStorage.setItem('page2_search_value', searchValue);
        } else {
          window.localStorage.removeItem(searchStorageKey);
          window.localStorage.removeItem('page2_search_value');
        }
        const normalizedQuery = (searchValue || '').trim().toUpperCase();
        const hasQueryChanged = normalizedQuery !== activeOutSearchQuery;
        activeOutSearchQuery = normalizedQuery;
        if (!normalizedQuery) {
          readSearchResults.clear();
          clearSearchReadIdsStorage();
        } else if (hasQueryChanged) {
          readSearchResults.clear();
          clearSearchReadIdsStorage();
        }
      }
      renderActiveTabContent({
        flashSearchMatches: isOutSearchInput,
      });
    });

    if (itemStatusFilterButton && itemStatusFilterMenu && itemStatusFilterOptions.length) {
      syncItemStatusFilterUi();
      itemStatusFilterButton.addEventListener('click', () => {
        if (itemStatusFilterMenu.hidden) {
          openItemStatusFilterMenu();
        } else {
          closeItemStatusFilterMenu();
        }
      });
      itemStatusFilterOptions.forEach((option) => {
        option.addEventListener('click', () => {
          setItemStatusFilter(option.dataset.itemStatusFilter || 'all');
          closeItemStatusFilterMenu();
        });
      });
      document.addEventListener('click', (event) => {
        if (!itemStatusFilterMenu.hidden && !event.target.closest('.page2-filter-menu-wrap')) {
          closeItemStatusFilterMenu();
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !itemStatusFilterMenu.hidden) {
          closeItemStatusFilterMenu();
          itemStatusFilterButton.focus();
        }
      });
    }

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
          renderActiveTabContent();
        });
      });
      itemDateFilter.addEventListener('change', () => {
        selectedDateFilter = itemDateFilter.value || 'all';
        window.localStorage.setItem(dateFilterStorageKey, selectedDateFilter);
        updateFilterChipsState();
        renderActiveTabContent();
      });
    }

    itemForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (itemCreateSubmitButton.disabled) {
        return;
      }
      const value = itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE
        ? String(itemNumberInput.value || '').trim()
        : normalizeItemNumberInput(itemNumberInput.value.trim());
      itemNumberInput.value = value;
      const maxLength = getItemNumberMaxLength();
      if (itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE) {
        if (!value) {
          showItemFormError('Veuillez entrer un nom d’achat matériel.');
          return;
        }
      } else if (itemDialogMode === ITEM_DIALOG_MODE_EDIT) {
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
          : itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE
            ? (await updateDoc(doc(firebaseDb, 'sites', siteId, 'achatsMateriels', editingItemId), { designation: value }), { ok: true })
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
        if (itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE) {
          await loadPurchasesForCurrentSite();
          setActiveSiteTab('purchases');
        }
        UiService.showToast(itemDialogMode === ITEM_DIALOG_MODE_EDIT ? 'Nom OUT mis à jour.' : itemDialogMode === ITEM_DIALOG_MODE_EDIT_PURCHASE ? 'Achat matériel mis à jour.' : 'N° OUT ajouté .');
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
        renderActiveTabContent();
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
        renderActiveTabContent();
      },
      () => {},
    );

    StorageService.subscribeDetailDesignations(
      siteId,
      (designationsByItem) => {
        detailDesignationsByItem = designationsByItem;
        renderActiveTabContent();
      },
      () => {},
    );

    StorageService.subscribeDetailRows(
      siteId,
      (rowsByItem) => {
        detailRowsByItem = rowsByItem;
        if (activeSiteTab === 'outs') {
          updateCursorFilterCounters();
          renderItems();
        }
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
    const detailFilterButton = document.querySelector('#detailFilterButton');
    const detailFilterMenu = document.querySelector('#detailFilterMenu');
    const detailFilterOptions = Array.from(document.querySelectorAll('[data-detail-filter]'));
    detailFilterOptions.forEach((option) => {
      option.dataset.filterLabel = option.querySelector('.page3-filter-option__label')?.textContent.trim() || option.textContent.trim();
    });
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
    const cursorFilterActiveStorageKey = 'page2_cursor_filter_active';
    const detailFilterKeyByPage2Label = {
      'Tous': 'all',
      'À faire': 'todo',
      'À corriger': 'fix',
      'Complété': 'done',
      'K.O': 'ko',
    };
    let activeDetailFilter = 'all';
    const page2SearchStorageKey = 'page2_search_value';
    let page2SearchValue = '';
    let page2CursorFilterLabel = 'Tous';
    try {
      page2SearchValue = String(window.localStorage.getItem(page2SearchStorageKey) || '').trim();
      page2CursorFilterLabel = window.localStorage.getItem(cursorFilterActiveStorageKey) || 'Tous';
    } catch (_error) {
      page2SearchValue = '';
      page2CursorFilterLabel = 'Tous';
    }
    const hasPage2CursorFilterContext = page2CursorFilterLabel !== 'Tous';
    const page2CursorFilterKey = hasPage2CursorFilterContext
      ? (detailFilterKeyByPage2Label[page2CursorFilterLabel] || 'all')
      : 'all';
    activeDetailFilter = page2CursorFilterKey;

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
      requireElement('statutInput').value = 'OK';
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

    function matchesSearchQuery(detail, query) {
      if (!query) {
        return true;
      }
      const normalizedQuery = String(query || '').trim().toLowerCase();
      const designation = String(detail?.designation || '').toLowerCase();
      const code = String(detail?.code || '').toLowerCase();
      return designation.includes(normalizedQuery) || code.includes(normalizedQuery);
    }

    function isDetailCompleted(detail) {
      const qteSortie = Number(detail?.qteSortie) || 0;
      const qtePosee = Number(detail?.qtePosee) || 0;
      const qteRetour = Number(detail?.qteRetour) || 0;
      const qteRebus = Number(detail?.qteRebus) || 0;
      const ecart = computeEcart(detail);

      return (qtePosee > 0 && ecart === 0)
        || qteSortie === qteRebus
        || qteSortie === qteRetour;
    }

    function matchesDetailFilter(detail, filterKey) {
      const isKoStatus = normalizeDetailStatut(detail.statut) === 'K.O';
      if (filterKey === 'ko') {
        return isKoStatus;
      }
      if (isKoStatus) {
        return filterKey === 'all';
      }

      const ecart = computeEcart(detail);
      const qtePosee = Number(detail?.qtePosee) || 0;
      const qteRetour = Number(detail?.qteRetour) || 0;
      const qteRebus = Number(detail?.qteRebus) || 0;
      const hasActivity = qtePosee !== 0 || qteRetour !== 0 || qteRebus !== 0;
      const isDone = isDetailCompleted(detail);
      const isAttention = hasActivity && ecart !== 0;

      if (filterKey === 'done') {
        return isDone;
      }
      if (filterKey === 'fix') {
        return isAttention;
      }
      if (filterKey === 'todo') {
        return !isDone && !isAttention;
      }
      return true;
    }

    function getFilteredDetails(details) {
      const query = getSearchQuery();
      return details.filter((detail) => matchesSearchQuery(detail, query) && matchesDetailFilter(detail, activeDetailFilter));
    }

    function updateDetailFilterCounters(details) {
      if (!detailFilterOptions.length) {
        return;
      }

      detailFilterOptions.forEach((option) => {
        const filterKey = option.dataset.detailFilter || 'all';
        const count = details.filter((detail) => matchesDetailFilter(detail, filterKey)).length;
        const countNode = option.querySelector('.page3-filter-option__count');
        if (countNode) {
          countNode.textContent = String(count);
        }
      });
    }

    function syncDetailFilterUi() {
      detailFilterButton?.classList.toggle('is-filtered', activeDetailFilter !== 'all');
      detailFilterOptions.forEach((option) => {
        const isActive = option.dataset.detailFilter === activeDetailFilter;
        option.classList.toggle('is-active', isActive);
        option.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    }

    function setDetailFilter(filterKey) {
      activeDetailFilter = filterKey;
      syncDetailFilterUi();
      renderTable();
    }

    function closeDetailFilterMenu() {
      if (!detailFilterMenu || !detailFilterButton) {
        return;
      }
      detailFilterMenu.hidden = true;
      detailFilterButton.setAttribute('aria-expanded', 'false');
    }

    function openDetailFilterMenu() {
      if (!detailFilterMenu || !detailFilterButton) {
        return;
      }
      detailFilterMenu.hidden = false;
      detailFilterButton.setAttribute('aria-expanded', 'true');
    }

    function updateCount(filteredCount, totalCount) {
      const countNumber = detailCount?.querySelector('.count-number');
      const countLabel = detailCount?.querySelector('.count-label');
      if (!countNumber || !countLabel) {
        return;
      }

      if (!hasResolvedInitialDetails || filteredCount === null || totalCount === null) {
        countNumber.textContent = '...';
        countLabel.textContent = 'Chargement...';
        return;
      }

      countNumber.textContent = String(filteredCount);
      if (filteredCount === totalCount) {
        countLabel.textContent = filteredCount > 1 ? 'Articles' : 'Article';
        return;
      }
      countLabel.textContent = `${filteredCount > 1 ? 'Articles' : 'Article'} / ${totalCount}`;
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

      const workbook = buildDetailExcelContent(`${currentSite.nom} · ${currentItem.numero}`, filteredDetails);
      const fileName = buildPage2ExportFileName(currentSite?.nom, 'xls');
      downloadExcelFile(fileName, 'Export Excel', workbook);
      saveExportFileNameToHistory(fileName);
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

    function setRowKoInteractionState(row, isKoStatus) {
      if (!row) {
        return;
      }

      const editableFields = row.querySelectorAll('[data-field]');
      editableFields.forEach((field) => {
        const fieldName = field.dataset.field;
        const shouldDisable = !canEditDetails || (isKoStatus && fieldName !== 'statut');
        field.disabled = shouldDisable;
        field.readOnly = shouldDisable && field.tagName === 'INPUT';
        field.tabIndex = shouldDisable ? -1 : 0;
        field.classList.toggle('cell-input--soft-disabled', shouldDisable);
        field.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');
      });
    }

    function applyDetailRowSemanticState(row) {
      if (!row) {
        return;
      }

      const isKoStatus = normalizeDetailStatut(row.querySelector('[data-field="statut"]')?.value) === 'K.O';
      const qteSortie = Number(row.querySelector('[data-field="qteSortie"]')?.value ?? 0);
      const qtePosee = Number(row.querySelector('[data-field="qtePosee"]')?.value ?? 0);
      const qteRetour = Number(row.querySelector('[data-field="qteRetour"]')?.value ?? 0);
      const qteRebus = Number(row.querySelector('[data-field="qteRebus"]')?.value ?? 0);
      const ecart = Number(row.querySelector('[data-col-key="ecart"]')?.value ?? 0);
      const hasActivity = qtePosee !== 0 || qteRetour !== 0 || qteRebus !== 0;
      const isDone = (qtePosee > 0 && ecart === 0)
        || qteSortie === qteRebus
        || qteSortie === qteRetour;

      row.classList.toggle('detail-row--done', !isKoStatus && isDone);
      row.classList.toggle('detail-row--attention', !isKoStatus && hasActivity && ecart !== 0);
    }

    function renderTable() {
      if (!hasResolvedInitialDetails) {
        updateCount(null, null);
        detailTableBody.innerHTML = `<tr><td colspan="14"><div class="empty-state">Chargement...</div></td></tr>`;
        return;
      }

      if (!currentItem) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(currentDetails);
      updateCount(filteredDetails.length, currentDetails.length);
      updateDetailFilterCounters(currentDetails);

      if (!filteredDetails.length) {
        detailTableBody.innerHTML = `<tr><td colspan="14"><div class="empty-state">${currentDetails.length ? 'Aucune  désignation ne correspond à votre recherche.' : 'Aucune article enregistrée.'}</div></td></tr>`;
        return;
      }

      detailTableBody.innerHTML = filteredDetails
        .map(
          (detail, index) => {
            const ecart = computeEcart(detail);
            const ecartClassName = typeof ecart === 'number' && ecart !== 0 ? ' cell-input--ecart-alert' : '';
            const enterAnimationStyle = animateNextTableRender ? ` style="--detail-row-enter-delay:${Math.min(index, 5) * 40}ms"` : '';
            const isKoStatus = normalizeDetailStatut(detail.statut) === 'K.O';
            const rowClasses = [
              animateNextTableRender ? 'detail-row-enter' : '',
              isKoStatus ? 'detail-row--ko' : '',
            ].filter(Boolean).join(' ');
            return `
            <tr data-detail-id="${detail.id}" class="${rowClasses}"${enterAnimationStyle}>
              <td><span class="field-badge">${detail.champ}</span></td>
              <td><input class="cell-input cell-input--autosize cell-input--left" data-field="code" value="${escapeHtml(detail.code)}" size="${Math.max(String(detail.code || '').length + 1, 10)}" /></td>
              <td><input class="cell-input cell-input--autosize cell-input--designation cell-input--left" data-field="designation" value="${escapeHtml(detail.designation)}" size="${Math.max(String(detail.designation || '').length + 1, 20)}" /></td>
              <td>
                <div class="qte-sortie-field">
                  <input class="cell-input cell-input--compact-dynamic" data-col-key="qteSortie" data-field="qteSortie" type="number" min="0" step="1" maxlength="120" value="${escapeHtml(detail.qteSortie)}" />
                  <span class="meta-value meta-value--inline">${escapeHtml(detail.unite)}</span>
                </div>
              </td>
              <td><input class="cell-input cell-input--compact-dynamic" data-col-key="qtePosee" data-field="qtePosee" type="number" min="0" step="1" maxlength="120" value="${detail.qtePosee}" /></td>
              <td><input class="cell-input cell-input--compact-dynamic" data-col-key="qteRebus" data-field="qteRebus" type="number" min="0" step="1" maxlength="120" value="${detail.qteRebus ?? 0}" /></td>
              <td><input class="cell-input cell-input--compact-dynamic" data-col-key="qteRetour" data-field="qteRetour" type="number" min="0" step="1" maxlength="120" value="${detail.qteRetour}" /></td>
              <td><input class="cell-input cell-input--compact-dynamic" data-col-key="dateRetour" data-field="dateRetour" type="date" value="${escapeHtml(detail.dateRetour || '')}" /></td>
              <td><input class="cell-input cell-input--compact-dynamic${ecartClassName}" data-col-key="ecart" type="number" maxlength="120" value="${ecart}" readonly aria-label="Ecart" /></td>
              <td><input class="cell-input cell-input--compact-dynamic" data-col-key="observation" data-field="observation" type="text" maxlength="120" value="${escapeHtml(detail.observation)}" /></td>
              <td>
                <div class="detail-status-field detail-status-field--${isKoStatus ? 'ko' : 'ok'}">
                  <select class="cell-input cell-input--compact-dynamic detail-status-select" data-col-key="statut" data-field="statut" aria-label="Statut">
                    <option value="OK" ${!isKoStatus ? 'selected' : ''}>OK</option>
                    <option value="K.O" ${isKoStatus ? 'selected' : ''}>K.O</option>
                  </select>
                </div>
              </td>
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

      detailTableBody.querySelectorAll('tr[data-detail-id]').forEach((row) => {
        const statusSelect = row.querySelector('[data-field="statut"]');
        const isKoStatus = normalizeDetailStatut(statusSelect?.value) === 'K.O';
        setRowKoInteractionState(row, isKoStatus);
        applyDetailRowSemanticState(row);
      });

      detailTableBody.querySelectorAll('[data-field]').forEach((field) => {
        field.addEventListener('change', async (event) => {
          const row = event.target.closest('tr');
          const fieldName = event.target.dataset.field;
          const currentDetail = currentDetails.find((detail) => detail.id === row.dataset.detailId);

          if (!currentDetail) {
            return;
          }

          const isKoRow = normalizeDetailStatut(currentDetail.statut) === 'K.O';
          if (fieldName !== 'statut' && isKoRow) {
            return;
          }

          const nextValue = fieldName === 'statut' ? normalizeDetailStatut(event.target.value) : event.target.value;
          if (String(currentDetail[fieldName] ?? '') === String(nextValue ?? '')) {
            return;
          }

          await StorageService.updateDetail(siteId, itemId, row.dataset.detailId, {
            [fieldName]: nextValue,
          });
          if (fieldName === 'statut') {
            const statusField = event.target.closest('.detail-status-field');
            const row = event.target.closest('tr');
            if (statusField) {
              statusField.classList.toggle('detail-status-field--ok', nextValue === 'OK');
              statusField.classList.toggle('detail-status-field--ko', nextValue === 'K.O');
            }
            if (row) {
              row.classList.toggle('detail-row--ko', nextValue === 'K.O');
              setRowKoInteractionState(row, nextValue === 'K.O');
              applyDetailRowSemanticState(row);
            }
          }
          if (fieldName === 'qtePosee' || fieldName === 'qteSortie' || fieldName === 'qteRebus' || fieldName === 'qteRetour') {
            const ecartField = row.querySelector('[data-col-key="ecart"]');
            if (ecartField) {
              const nextEcart = computeEcart({
                ...currentDetail,
                [fieldName]: nextValue,
              });
              ecartField.value = Number.isFinite(nextEcart) ? String(nextEcart) : '0';
              ecartField.classList.toggle('cell-input--ecart-alert', typeof nextEcart === 'number' && nextEcart !== 0);
            }
            applyDetailRowSemanticState(row);
          }
          applyCompactColumnWidths();
        });

        if (field.classList.contains('cell-input--compact-dynamic')) {
          field.addEventListener('input', () => {
            if (field.disabled) {
              return;
            }
            if (field.value.length > 120) {
              field.value = field.value.slice(0, 120);
            }
            if (field.dataset.field === 'qtePosee' || field.dataset.field === 'qteSortie' || field.dataset.field === 'qteRebus' || field.dataset.field === 'qteRetour' || field.dataset.field === 'statut') {
              const row = field.closest('tr');
              if (row) {
                if (field.dataset.field !== 'statut') {
                  const qteSortie = Number(row.querySelector('[data-field="qteSortie"]')?.value ?? 0);
                  const qtePosee = Number(row.querySelector('[data-field="qtePosee"]')?.value ?? 0);
                  const qteRebus = Number(row.querySelector('[data-field="qteRebus"]')?.value ?? 0);
                  const qteRetour = Number(row.querySelector('[data-field="qteRetour"]')?.value ?? 0);
                  const ecart = qteSortie - qtePosee - qteRebus - qteRetour;
                  const ecartField = row.querySelector('[data-col-key="ecart"]');
                  if (ecartField) {
                    ecartField.value = String(ecart);
                    ecartField.classList.toggle('cell-input--ecart-alert', ecart !== 0);
                  }
                }
                applyDetailRowSemanticState(row);
              }
            }
            applyCompactColumnWidths();
          });
        }
      });

      detailTableBody.querySelectorAll('[data-detail-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          await askDetailDeleteConfirmation(button.dataset.detailDelete);
        });
      });

      applyCompactColumnWidths();
    }

    function applyCompactColumnWidths() {
      const autoFields = detailTableBody.querySelectorAll('.cell-input--compact-dynamic[data-col-key]');
      if (!autoFields.length) {
        return;
      }

      const columns = new Map();
      autoFields.forEach((input) => {
        const key = input.dataset.colKey;
        if (!columns.has(key)) {
          columns.set(key, []);
        }
        columns.get(key).push(input);
      });

      const measurer = document.createElement('span');
      measurer.className = 'cell-input-measurer';
      document.body.appendChild(measurer);

      const minWidthByColumn = {
        qteSortie: 48,
        qtePosee: 48,
        qteRebus: 0,
        qteRetour: 48,
        dateRetour: 140,
        ecart: 48,
        observation: 48,
        statut: 84,
      };

      columns.forEach((inputs, key) => {
        let maxWidth = minWidthByColumn[key] || 48;

        inputs.forEach((input) => {
          const computed = window.getComputedStyle(input);
          measurer.style.font = computed.font;
          measurer.style.letterSpacing = computed.letterSpacing;
          measurer.textContent = String(input.value ?? '');
          const contentWidth = Math.ceil(measurer.getBoundingClientRect().width);
          const horizontalPadding = parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight);
          const horizontalBorder = parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth);
          const minWidth = Math.max(parseFloat(computed.minWidth) || 0, minWidthByColumn[key] || 48);
          const width = Math.max(minWidth, contentWidth + horizontalPadding + horizontalBorder + 10);
          maxWidth = Math.max(maxWidth, width);
        });

        inputs.forEach((input) => {
          input.style.width = `${Math.ceil(maxWidth)}px`;
        });
      });

      measurer.remove();
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
          statut: requireElement('statutInput')?.value || 'OK',
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
        requireElement('statutInput').value = 'OK';
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
      detailSearchInput.addEventListener('input', () => {
        renderTable();
      });
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
      detailSearchInput.value = page2SearchValue;
      toggleClearButton();
    }

    if (detailFilterButton && detailFilterMenu && detailFilterOptions.length) {
      syncDetailFilterUi();
      detailFilterButton.addEventListener('click', () => {
        if (detailFilterMenu.hidden) {
          openDetailFilterMenu();
          return;
        }
        closeDetailFilterMenu();
      });

      detailFilterOptions.forEach((option) => {
        option.addEventListener('click', () => {
          setDetailFilter(option.dataset.detailFilter || 'all');
          closeDetailFilterMenu();
        });
      });

      document.addEventListener('click', (event) => {
        if (!detailFilterMenu.hidden && !event.target.closest('.page3-filter-menu-wrap')) {
          closeDetailFilterMenu();
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !detailFilterMenu.hidden) {
          closeDetailFilterMenu();
        }
      });
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

    updateCount(null, null);

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
