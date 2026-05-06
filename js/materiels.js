import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseDb } from './firebase-core.js';

(function () {
  const isMaterialsPage = location.pathname.includes('materiels.html');
  const CART_KEY = 'materialRequestCart';
  const HINT_KEY = 'materialsHintSeen';
  let materialCart = [];
  let currentEditingQtyCode = null;

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

  function normalizeMaterialRow(data) {
    const code = String(data?.code || data?.ref || data?.reference || data?.Code || '').trim();
    const designation = String(
      data?.designation || data?.Designation || data?.désignation || data?.['Désignation'] || data?.name || '',
    ).trim();
    return { code, designation };
  }

  function loadMaterialCart() {
    try {
      const savedCart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
      materialCart = savedCart.map((item) => ({
        ...item,
        unit: item.unit || getDefaultMaterialUnit(item.designation || ''),
      }));
    } catch (_error) {
      materialCart = [];
    }
  }

  function saveMaterialCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(materialCart));
  }

  function getDefaultMaterialUnit(designation = '') {
    const text = designation.toLowerCase();

    if (
      text.includes('cable')
      || text.includes('câble')
      || text.includes('cuivre')
      || text.includes('fil')
      || text.includes('gaine')
    ) {
      return 'm';
    }

    return 'Pcs';
  }

  function initMaterialsHint() {
    const hint = document.querySelector('#materialsHint');
    const closeBtn = document.querySelector('#closeMaterialsHint');

    if (!hint) {
      return;
    }

    const alreadySeen = localStorage.getItem(HINT_KEY) === 'true';

    if (!alreadySeen) {
      hint.classList.remove('hidden');
    }

    closeBtn?.addEventListener('click', () => {
      localStorage.setItem(HINT_KEY, 'true');
      hint.classList.add('hidden');
    });
  }

  function markMaterialsHintSeen() {
    localStorage.setItem(HINT_KEY, 'true');
    document.querySelector('#materialsHint')?.classList.add('hidden');
  }

  function updateMaterialCartBadge() {
    const badge = document.querySelector('#materialCartBadge');

    if (!badge) {
      return;
    }

    const count = materialCart.length;
    badge.textContent = String(count);

    if (count > 0) {
      badge.classList.add('visible');
      return;
    }

    badge.classList.remove('visible');
  }

  function editQtyDirectly(code) {
    const item = materialCart.find((cartItem) => cartItem.code === code);
    if (!item) {
      return;
    }

    currentEditingQtyCode = code;

    const input = requireElement('editQtyInput');
    const error = requireElement('editQtyError');
    if (input) {
      input.value = String(item.qty || 1);
      input.classList.remove('is-error', 'is-shaking');
    }
    if (error) {
      error.textContent = '';
    }

    openEditQtyModal();
  }

  function addMaterialToCart(material) {
    const existing = materialCart.find((item) => item.code === material.code);

    if (existing) {
      existing.qty = (Number(existing.qty) || 1) + 1;
    } else {
      materialCart.push({
        code: material.code,
        designation: material.designation,
        qty: 1,
        unit: getDefaultMaterialUnit(material.designation),
      });
    }

    saveMaterialCart();
    updateMaterialCartBadge();
    renderMaterialCart();
    markMaterialsHintSeen();
    window.UiService?.showToast?.('Matériel ajouté au panier');
  }

  function removeMaterialFromCart(code) {
    materialCart = materialCart.filter((item) => item.code !== code);
    saveMaterialCart();
    updateMaterialCartBadge();
    renderMaterialCart();
  }

  function increaseQty(code) {
    const item = materialCart.find((cartItem) => cartItem.code === code);
    if (!item) {
      return;
    }
    item.qty = (Number(item.qty) || 1) + 1;
    saveMaterialCart();
    updateMaterialCartBadge();
    renderMaterialCart();
  }

  function decreaseQty(code) {
    const item = materialCart.find((cartItem) => cartItem.code === code);
    if (!item) {
      return;
    }
    item.qty = Math.max(1, (Number(item.qty) || 1) - 1);
    saveMaterialCart();
    updateMaterialCartBadge();
    renderMaterialCart();
  }

  function updateMaterialUnit(code, newUnit) {
    materialCart = materialCart.map((item) => {
      if (item.code === code) {
        return { ...item, unit: newUnit };
      }
      return item;
    });

    saveMaterialCart();
    renderMaterialCart();
  }


  function syncMaterialCartActionsState() {
    const isEmpty = materialCart.length === 0;
    const clearBtn = requireElement('clearMaterialCartBtn');
    const viewBtn = requireElement('viewMaterialRequestBtn');

    [clearBtn, viewBtn].forEach((btn) => {
      if (!btn) {
        return;
      }
      btn.disabled = isEmpty;
      btn.classList.toggle('is-disabled-soft', isEmpty);
    });
  }

  function renderMaterialCart() {
    const list = document.querySelector('#materialCartList');
    if (!list) {
      return;
    }

    if (!materialCart.length) {
      list.innerHTML = `
        <div class="empty-cart">
          <p>Aucun matériel dans la demande.</p>
          <p class="empty-cart-hint">💡 Ajoutez des matériels depuis la liste pour créer une demande</p>
        </div>
      `;
      syncMaterialCartActionsState();
      return;
    }

    list.innerHTML = materialCart
      .map((item) => `
      <div class="material-cart-card">
        <div class="material-cart-info">
          <strong>${escapeHtml(item.code)}</strong>
          <p>${escapeHtml(item.designation || '-')}</p>
          <div class="qty-control">
            <button class="btn btn-secondary qty-minus" data-code="${escapeHtml(item.code)}" type="button" aria-label="Diminuer la quantité de ${escapeHtml(item.code)}">−</button>
            <button class="qty-value qty-edit-btn" data-code="${escapeHtml(item.code)}" type="button">${escapeHtml(item.qty || 1)}</button>
            <button class="btn btn-secondary qty-plus" data-code="${escapeHtml(item.code)}" type="button" aria-label="Augmenter la quantité de ${escapeHtml(item.code)}">+</button>
            <select class="unit-select" data-code="${escapeHtml(item.code)}">
              <option value="Pcs" ${item.unit === 'Pcs' ? 'selected' : ''}>Pcs</option>
              <option value="m" ${item.unit === 'm' ? 'selected' : ''}>m</option>
            </select>
          </div>
        </div>
        <button class="remove-cart-item-btn" data-code="${escapeHtml(item.code)}" type="button" aria-label="Retirer ${escapeHtml(item.code)}">×</button>
      </div>
    `)
      .join('');

    list.querySelectorAll('.remove-cart-item-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        removeMaterialFromCart(btn.dataset.code || '');
      });
    });

    list.querySelectorAll('.qty-plus').forEach((btn) => {
      btn.addEventListener('click', () => increaseQty(btn.dataset.code || ''));
    });

    list.querySelectorAll('.qty-minus').forEach((btn) => {
      btn.addEventListener('click', () => decreaseQty(btn.dataset.code || ''));
    });

    document.querySelectorAll('.qty-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        editQtyDirectly(btn.dataset.code || '');
      });
    });

    list.querySelectorAll('.unit-select').forEach((select) => {
      select.addEventListener('change', () => {
        updateMaterialUnit(select.dataset.code || '', select.value);
      });
    });

    syncMaterialCartActionsState();
  }

  function formatMaterialRequestText() {
    if (!materialCart || materialCart.length === 0) {
      return 'Aucune demande de matériel.';
    }

    let text = '📦 DEMANDE DE MATÉRIEL\n\n';
    text += 'Code | Désignation | Qté | Unité\n';
    text += '----------------------------------\n';

    materialCart.forEach((item) => {
      const code = item.code || '';
      const designation = item.designation || '';
      const qty = item.qty || 1;
      const unit = item.unit || 'Pcs';

      text += `${code} | ${designation} | ${qty} | ${unit}\n`;
    });

    return text;
  }

  function copyMaterialRequest() {
    const text = formatMaterialRequestText();
    const showToast = window.UiService?.showToast;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => showToast?.('Demande copiée ✔'))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    window.UiService?.showToast?.('Demande copiée ✔');
  }

  function buildRequestExportArea() {
    const exportArea = document.createElement('div');
    exportArea.id = 'requestExportArea';

    exportArea.style.position = 'fixed';
    exportArea.style.left = '-9999px';
    exportArea.style.top = '0';
    exportArea.style.width = '900px';
    exportArea.style.background = '#ffffff';
    exportArea.style.padding = '32px';
    exportArea.style.fontFamily = 'Arial, sans-serif';
    exportArea.style.color = '#111827';

    exportArea.innerHTML = `
      <h2 style="margin:0 0 20px;font-size:28px;font-weight:800;">
        Demande de matériel
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:20px;">
        <thead>
          <tr style="background:#eef5fb;">
            <th style="text-align:left;padding:16px;border:1px solid #cbd5e1;">Code</th>
            <th style="text-align:left;padding:16px;border:1px solid #cbd5e1;">Désignation</th>
            <th style="text-align:center;padding:16px;border:1px solid #cbd5e1;">Qté</th>
            <th style="text-align:center;padding:16px;border:1px solid #cbd5e1;">Unité</th>
          </tr>
        </thead>
        <tbody>
          ${materialCart.map((item) => `
            <tr>
              <td style="padding:14px;border:1px solid #cbd5e1;">${item.code || '-'}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;">${item.designation || '-'}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;text-align:center;">${item.qty || 1}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;text-align:center;">${item.unit || 'Pcs'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.body.appendChild(exportArea);
    return exportArea;
  }

  async function downloadRequestAsPng() {
    const showToast = window.UiService?.showToast;

    if (!materialCart || materialCart.length === 0) {
      showToast?.('Aucune demande à télécharger');
      return;
    }

    if (typeof window.html2canvas !== 'function') {
      showToast?.('Export PNG indisponible');
      return;
    }

    const exportArea = buildRequestExportArea();

    try {
      const canvas = await window.html2canvas(exportArea, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        width: exportArea.scrollWidth,
        height: exportArea.scrollHeight,
        windowWidth: exportArea.scrollWidth,
        windowHeight: exportArea.scrollHeight
      });

      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.download = `demande-materiel-${date}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      showToast?.('Image PNG téléchargée ✔');
    } catch (error) {
      console.error('Erreur export PNG :', error);
      showToast?.('Erreur téléchargement PNG');
    } finally {
      exportArea.remove();
    }
  }

  function openDialogById(id) {
    const modal = requireElement(id);
    if (!modal || typeof modal.showModal !== 'function') {
      return;
    }
    if (!modal.open) {
      modal.showModal();
    }
  }

  function closeDialogById(id) {
    const modal = requireElement(id);
    if (!modal || typeof modal.close !== 'function') {
      return;
    }
    if (modal.open) {
      modal.close();
    }
  }

  function openMaterialCartModal() {
    openDialogById('materialCartModal');
  }

  function closeMaterialCartModal() {
    closeDialogById('materialCartModal');
  }

      function openEditQtyModal() {
    openDialogById('editQtyModal');
    window.setTimeout(() => {
      requireElement('editQtyInput')?.focus();
    }, 150);
  }

  function closeEditQtyModal() {
    closeDialogById('editQtyModal');
    currentEditingQtyCode = null;
  }


    function renderMaterials(materials) {
    const tbody = document.querySelector('#materialsTableBody');

    if (!tbody) {
      console.error('#materialsTableBody introuvable');
      return;
    }

    const safeMaterials = Array.isArray(materials) ? materials : [];
    const countNumber = document.querySelector('#materialsCount .count-number');
    const emptyState = requireElement('materialsEmptyState');
    const table = requireElement('materialsDataTable');

    if (countNumber) {
      countNumber.textContent = String(safeMaterials.length);
    }

    if (!safeMaterials.length) {
      tbody.innerHTML = '\n      <tr>\n        <td colspan="2">Aucun matériel disponible.</td>\n      </tr>\n    ';
      if (table) {
        table.hidden = false;
      }
      if (emptyState) {
        emptyState.hidden = true;
      }
      return;
    }

    if (emptyState) {
      emptyState.hidden = true;
    }
    if (table) {
      table.hidden = false;
    }

    tbody.innerHTML = safeMaterials.map((item) => `
    <tr class="material-row" data-code="${escapeHtml(item.code || '')}" data-designation="${escapeHtml(item.designation || '')}">
      <td>${escapeHtml(item.code || '-')}</td>
      <td>${escapeHtml(item.designation || '-')}</td>
    </tr>
  `).join('');
  }

  async function loadAllMaterials() {
    console.log('Chargement tous matériels...');
    const snap = await getDocs(collection(firebaseDb, 'pages', 'page3', 'items'));
    console.log('Documents articles trouvés :', snap.size);

    const uniqueMaterials = new Map();
    snap.forEach((docSnap) => {
      const row = normalizeMaterialRow(docSnap.data());
      if (!row.code) {
        return;
      }
      if (!uniqueMaterials.has(row.code)) {
        uniqueMaterials.set(row.code, row);
      }
    });

    const materials = Array.from(uniqueMaterials.values()).sort((a, b) =>
      String(a.designation).localeCompare(String(b.designation), 'fr', { sensitivity: 'base' }),
    );

    console.log('Matériels uniques :', materials.length);
    return materials;
  }

  async function initMaterialsPage() {
    console.log('Init materiels.html');

    const backButton = requireElement('materialsBackButton');
    const searchInput = requireElement('materialsSearchInput');
    const clearSearchBtn = requireElement('materialsClearSearchBtn');
    let allMaterials = [];

    backButton?.addEventListener('click', () => {
      window.location.assign('index.html');
    });

    const applySearch = () => {
      const query = String(searchInput?.value || '').trim().toLowerCase();
      if (!query) {
        renderMaterials(allMaterials);
        return;
      }
      const filtered = allMaterials.filter((material) => {
        const code = String(material.code || '').toLowerCase();
        const designation = String(material.designation || '').toLowerCase();
        return code.includes(query) || designation.includes(query);
      });
      renderMaterials(filtered);
    };

    searchInput?.addEventListener('input', applySearch);

    const toggleClearButton = () => {
      if (!searchInput || !clearSearchBtn) {
        return;
      }
      clearSearchBtn.style.display = searchInput.value.trim() ? 'flex' : 'none';
    };

    searchInput?.addEventListener('input', toggleClearButton);
    clearSearchBtn?.addEventListener('click', () => {
      if (!searchInput) {
        return;
      }
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.focus();
    });

    toggleClearButton();

    initMaterialsHint();

    loadMaterialCart();
    updateMaterialCartBadge();
    syncMaterialCartActionsState();

    requireElement('materialCartFab')?.addEventListener('click', () => {
      const fab = requireElement('materialCartFab');
      if (!materialCart.length && fab) {
        fab.classList.add('bounce');
        window.setTimeout(() => {
          fab.classList.remove('bounce');
        }, 300);
      }
      renderMaterialCart();
      openMaterialCartModal();
    });

    requireElement('materialCartModal')?.addEventListener('click', (event) => {
      const modal = event.currentTarget;
      if (event.target === modal) {
        closeMaterialCartModal();
      }
    });

    requireElement('clearMaterialCartBtn')?.addEventListener('click', () => {
      materialCart = [];
      saveMaterialCart();
      updateMaterialCartBadge();
      renderMaterialCart();
    });

    requireElement('viewMaterialRequestBtn')?.addEventListener('click', () => {
      closeMaterialCartModal();
      window.location.href = 'demande-materiel.html';
    });
    requireElement('saveEditQtyBtn')?.addEventListener('click', () => {
      const input = requireElement('editQtyInput');
      const error = requireElement('editQtyError');
      const qty = parseInt(input?.value ?? '', 10);

      if (!Number.isFinite(qty) || qty < 1) {
        if (error) {
          error.textContent = 'Veuillez entrer une quantité valide.';
        }
        input?.classList.remove('is-shaking');
        void input?.offsetWidth;
        input?.classList.add('is-error', 'is-shaking');
        return;
      }

      const item = materialCart.find((cartItem) => cartItem.code === currentEditingQtyCode);
      if (!item) {
        return;
      }

      item.qty = qty;
      saveMaterialCart();
      updateMaterialCartBadge();
      renderMaterialCart();
      closeEditQtyModal();
    });
    requireElement('cancelEditQtyBtn')?.addEventListener('click', closeEditQtyModal);
    requireElement('editQtyInput')?.addEventListener('input', () => {
      const input = requireElement('editQtyInput');
      const error = requireElement('editQtyError');
      input?.classList.remove('is-error', 'is-shaking');
      if (error) {
        error.textContent = '';
      }
    });
    requireElement('editQtyModal')?.addEventListener('click', (event) => {
      const modal = event.currentTarget;
      if (event.target === modal) {
        closeEditQtyModal();
      }
    });

    requireElement('materialsTableBody')?.addEventListener('click', (event) => {
      const row = event.target.closest('tr.material-row');
      if (!row) {
        return;
      }
      const code = String(row.dataset.code || '').trim();
      if (!code) {
        return;
      }
      const designation = String(row.dataset.designation || '').trim();
      addMaterialToCart({ code, designation });
    });

    try {
      allMaterials = await loadAllMaterials();
      renderMaterials(allMaterials);
    } catch (error) {
      console.error('Erreur chargement tous matériels :', error);
      renderMaterials([]);
    } finally {
      window.UiService?.markAppReady?.();
      document.body.classList.remove('loading');
      document.querySelector('.global-skeleton')?.remove();
      document.querySelector('.skeleton-container')?.remove();
      document.querySelector('#skeleton')?.remove();
    }
  }

  if (isMaterialsPage) {
    initMaterialsPage();
  }
})();
