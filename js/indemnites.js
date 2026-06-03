import { addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseDb } from './firebase-core.js';

(function () {
  const isIndemnitiesPage = location.pathname.includes('indemnites.html');
  const STORAGE_KEY = 'indemnityRequestEntries';
  const MAX_DAYS = 999;
  let indemnityEntries = [];
  let editingId = null;
  let isExporting = false;

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

  function sanitizeText(value) {
    return String(value || '').normalize('NFC').trim();
  }

  function sanitizeDays(value) {
    let days = parseInt(value, 10);
    if (!Number.isFinite(days) || days < 1) {
      days = 1;
    }
    if (days > MAX_DAYS) {
      days = MAX_DAYS;
    }
    return days;
  }

  function getTodayInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatRequestDateTime(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} • ${hours}:${minutes}`;
  }

  function formatWorkDate(dateValue) {
    if (!dateValue) {
      return '-';
    }
    const [year, month, day] = String(dateValue).split('-');
    if (!year || !month || !day) {
      return String(dateValue);
    }
    return `${day}/${month}/${year}`;
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

  function loadEntries() {
    try {
      const savedEntries = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      indemnityEntries = Array.isArray(savedEntries)
        ? savedEntries.map((entry) => ({
          id: String(entry.id || `indemnity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
          name: sanitizeText(entry.name),
          workDate: String(entry.workDate || ''),
          days: sanitizeDays(entry.days),
        })).filter((entry) => entry.name && entry.workDate)
        : [];
    } catch (_error) {
      indemnityEntries = [];
    }
  }

  function saveEntries() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(indemnityEntries));
  }

  function getTotalDays() {
    return indemnityEntries.reduce((total, entry) => total + sanitizeDays(entry.days), 0);
  }

  function updateSummary() {
    const peopleTotal = requireElement('indemnityPeopleTotal');
    const daysTotal = requireElement('indemnityDaysTotal');
    const listCount = requireElement('indemnityListCount');
    const exportBtn = requireElement('exportIndemnityImageBtn');
    const count = indemnityEntries.length;

    if (peopleTotal) {
      peopleTotal.textContent = String(count);
    }
    if (daysTotal) {
      daysTotal.textContent = String(getTotalDays());
    }
    if (listCount) {
      listCount.textContent = `${count} personne${count > 1 ? 's' : ''}`;
    }
    if (exportBtn) {
      exportBtn.disabled = count === 0 || isExporting;
    }
  }

  function renderEntries() {
    const list = requireElement('indemnityList');
    if (!list) {
      return;
    }

    if (!indemnityEntries.length) {
      list.innerHTML = '<p class="indemnity-empty">Aucune personne enregistrée pour le moment.</p>';
      updateSummary();
      return;
    }

    list.innerHTML = indemnityEntries.map((entry) => `
      <article class="indemnity-person-card">
        <div class="indemnity-person-main">
          <strong>${escapeHtml(entry.name)}</strong>
          <span>Nom de la personne</span>
        </div>
        <div class="indemnity-person-meta">
          <strong>${escapeHtml(formatWorkDate(entry.workDate))}</strong>
          <span>Date de travail</span>
        </div>
        <div class="indemnity-person-meta">
          <strong>${sanitizeDays(entry.days)}</strong>
          <span>Nombre de jours</span>
        </div>
        <div class="indemnity-card-actions">
          <button class="indemnity-icon-btn" type="button" data-edit-id="${escapeHtml(entry.id)}" aria-label="Modifier ${escapeHtml(entry.name)}">
            <i class="fa-solid fa-pen" aria-hidden="true"></i>
          </button>
          <button class="indemnity-icon-btn indemnity-icon-btn--delete" type="button" data-delete-id="${escapeHtml(entry.id)}" aria-label="Supprimer ${escapeHtml(entry.name)}">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </div>
      </article>
    `).join('');

    list.querySelectorAll('[data-edit-id]').forEach((button) => {
      button.addEventListener('click', () => startEditEntry(button.dataset.editId || ''));
    });

    list.querySelectorAll('[data-delete-id]').forEach((button) => {
      button.addEventListener('click', () => deleteEntry(button.dataset.deleteId || ''));
    });

    updateSummary();
  }

  function showFormError(message = '') {
    const errorEl = requireElement('indemnityFormError');
    if (!errorEl) {
      return;
    }
    errorEl.textContent = message;
    errorEl.classList.toggle('visible', Boolean(message));
  }

  function resetForm() {
    editingId = null;
    requireElement('indemnityForm')?.reset();
    const dateInput = requireElement('indemnityDateInput');
    const daysInput = requireElement('indemnityDaysInput');
    const submitButton = requireElement('indemnitySubmitButton');
    if (dateInput) {
      dateInput.value = getTodayInputValue();
    }
    if (daysInput) {
      daysInput.value = '1';
    }
    if (submitButton) {
      submitButton.textContent = 'Ajouter';
    }
    showFormError('');
  }

  function readFormEntry() {
    const nameInput = requireElement('indemnityNameInput');
    const dateInput = requireElement('indemnityDateInput');
    const daysInput = requireElement('indemnityDaysInput');
    const name = sanitizeText(nameInput?.value);
    const workDate = String(dateInput?.value || '').trim();
    const days = sanitizeDays(daysInput?.value);

    if (!name) {
      showFormError('Le nom de la personne est obligatoire.');
      nameInput?.focus();
      return null;
    }
    if (!workDate) {
      showFormError('La date de travail est obligatoire.');
      dateInput?.focus();
      return null;
    }

    return { name, workDate, days };
  }

  function saveFormEntry(event) {
    event.preventDefault();
    const formEntry = readFormEntry();
    if (!formEntry) {
      return;
    }

    if (editingId) {
      indemnityEntries = indemnityEntries.map((entry) => (
        entry.id === editingId ? { ...entry, ...formEntry } : entry
      ));
      window.UiService?.showToast?.('Personne modifiée.');
    } else {
      indemnityEntries.push({
        id: `indemnity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...formEntry,
      });
      window.UiService?.showToast?.('Personne ajoutée.');
    }

    saveEntries();
    renderEntries();
    resetForm();
  }

  function startEditEntry(id) {
    const entry = indemnityEntries.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    editingId = id;
    requireElement('indemnityNameInput').value = entry.name;
    requireElement('indemnityDateInput').value = entry.workDate;
    requireElement('indemnityDaysInput').value = String(sanitizeDays(entry.days));
    requireElement('indemnitySubmitButton').textContent = 'Modifier';
    requireElement('indemnityNameInput')?.focus();
    showFormError('');
  }

  function deleteEntry(id) {
    indemnityEntries = indemnityEntries.filter((entry) => entry.id !== id);
    if (editingId === id) {
      resetForm();
    }
    saveEntries();
    renderEntries();
    window.UiService?.showToast?.('Personne supprimée.');
  }

  async function createIndemnityRequestRecord(exportDateLabel) {
    const people = indemnityEntries.map((entry) => ({
      name: String(entry.name || ''),
      workDate: String(entry.workDate || ''),
      days: sanitizeDays(entry.days),
    }));

    await addDoc(collection(firebaseDb, 'indemnityRequests'), {
      title: 'Demande d\'indemnités',
      createdAt: serverTimestamp(),
      exportDateLabel,
      totalPeople: people.length,
      totalDays: getTotalDays(),
      people,
    });
  }

  function buildExportArea(exportDateLabel) {
    const exportArea = document.createElement('div');
    exportArea.id = 'indemnityExportArea';
    exportArea.style.position = 'fixed';
    exportArea.style.left = '-9999px';
    exportArea.style.top = '0';
    exportArea.style.width = '900px';
    exportArea.style.background = '#ffffff';
    exportArea.style.padding = '32px';
    exportArea.style.fontFamily = "'Segoe UI', Roboto, Arial, sans-serif";
    exportArea.style.color = '#111827';

    exportArea.innerHTML = `
      <h1 style="margin:0;font-size:28px;font-weight:800;">Demande d'indemnités</h1>
      <p style="margin:6px 0 20px;font-size:18px;color:#334155;">Date d'export : ${escapeHtml(exportDateLabel)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:20px;">
        <thead>
          <tr style="background:#eef5fb;">
            <th style="text-align:center;padding:16px;border:1px solid #cbd5e1;width:52px;">#</th>
            <th style="text-align:left;padding:16px;border:1px solid #cbd5e1;">Nom de la personne</th>
            <th style="text-align:center;padding:16px;border:1px solid #cbd5e1;">Date de travail</th>
            <th style="text-align:center;padding:16px;border:1px solid #cbd5e1;">Nombre de jours</th>
          </tr>
        </thead>
        <tbody>
          ${indemnityEntries.map((entry, index) => `
            <tr>
              <td style="padding:14px;border:1px solid #cbd5e1;text-align:center;width:52px;">${index + 1}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;">${escapeHtml(entry.name)}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;text-align:center;">${escapeHtml(formatWorkDate(entry.workDate))}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;text-align:center;">${sanitizeDays(entry.days)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:22px;padding:18px 20px;border-radius:18px;background:#eef5fb;display:flex;justify-content:space-between;gap:16px;font-size:22px;font-weight:800;">
        <span>Total général des jours travaillés</span>
        <span>${getTotalDays()}</span>
      </div>
    `;

    document.body.appendChild(exportArea);
    return exportArea;
  }

  function openPreviewModal(dataUrl) {
    const image = requireElement('indemnityPreviewImage');
    if (image) {
      image.src = String(dataUrl || '');
    }
    const modal = requireElement('indemnityPreviewModal');
    if (modal && typeof modal.showModal === 'function' && !modal.open) {
      modal.showModal();
    }
  }

  function closePreviewModal() {
    const modal = requireElement('indemnityPreviewModal');
    if (modal && typeof modal.close === 'function' && modal.open) {
      modal.close();
    }
  }

  async function exportAsImage() {
    const showToast = window.UiService?.showToast;
    if (!indemnityEntries.length) {
      showToast?.('Aucune personne à exporter');
      return;
    }
    if (typeof window.html2canvas !== 'function') {
      showToast?.('Export PNG indisponible');
      return;
    }
    if (isExporting) {
      return;
    }

    isExporting = true;
    updateSummary();
    let exportArea = null;

    try {
      const exportDateLabel = formatRequestDateTime(new Date());
      await createIndemnityRequestRecord(exportDateLabel);
      exportArea = buildExportArea(exportDateLabel);
      const canvas = await window.html2canvas(exportArea, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        width: exportArea.scrollWidth,
        height: exportArea.scrollHeight,
        windowWidth: exportArea.scrollWidth,
        windowHeight: exportArea.scrollHeight,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `demande-indemnites-${buildExportTimestamp()}.png`;
      link.href = dataUrl;
      link.click();
      openPreviewModal(dataUrl);
    } catch (error) {
      console.error('Erreur export indemnités PNG :', error);
      showToast?.('Erreur téléchargement PNG');
    } finally {
      exportArea?.remove();
      isExporting = false;
      updateSummary();
    }
  }

  function initIndemnitiesPage() {
    requireElement('indemnitiesBackButton')?.addEventListener('click', () => {
      window.location.assign('index.html');
    });

    loadEntries();
    resetForm();
    renderEntries();

    requireElement('indemnityForm')?.addEventListener('submit', saveFormEntry);
    requireElement('exportIndemnityImageBtn')?.addEventListener('click', exportAsImage);
    requireElement('indemnityPreviewOkBtn')?.addEventListener('click', closePreviewModal);
    requireElement('indemnityPreviewModal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closePreviewModal();
      }
    });
  }

  if (isIndemnitiesPage) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initIndemnitiesPage);
    } else {
      initIndemnitiesPage();
    }
  }
}());
