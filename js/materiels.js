import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseDb } from './firebase-core.js';

(function () {
  const isMaterialsPage = location.pathname.includes('materiels.html');
  const CART_KEY = 'materialRequestCart';
  let materialCart = [];

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
      materialCart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch (_error) {
      materialCart = [];
    }
  }

  function saveMaterialCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(materialCart));
  }

  function updateMaterialCartBadge() {
    const badge = document.querySelector('#materialCartBadge');
    const fab = document.querySelector('#materialCartFab');

    if (!badge || !fab) {
      return;
    }

    const count = materialCart.length;
    badge.textContent = String(count);

    if (count > 0) {
      badge.classList.add('visible');
      fab.classList.remove('hidden');
      return;
    }

    badge.classList.remove('visible');
    fab.classList.add('hidden');
  }

  function editQtyDirectly(code) {
    const item = materialCart.find((cartItem) => cartItem.code === code);
    if (!item) {
      return;
    }

    const currentQty = Number(item.qty) || 1;
    const value = window.prompt('Entrer la quantité demandée :', String(currentQty));

    if (value === null) {
      return;
    }

    const qty = parseInt(value, 10);

    if (!Number.isFinite(qty) || qty < 1) {
      window.UiService?.showToast?.('Quantité invalide');
      return;
    }

    item.qty = qty;
    saveMaterialCart();
    updateMaterialCartBadge();
    renderMaterialCart();
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
      });
    }

    saveMaterialCart();
    updateMaterialCartBadge();
    renderMaterialCart();
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

  function renderMaterialCart() {
    const list = document.querySelector('#materialCartList');
    if (!list) {
      return;
    }

    if (!materialCart.length) {
      list.innerHTML = '<p class="empty-state">Aucun matériel dans la demande.</p>';
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
  }

  function exportMaterialRequest() {
    if (!materialCart.length) {
      window.UiService?.showToast?.('Aucun matériel à exporter');
      return;
    }

    const rows = [
      ['Code', 'Désignation', 'Quantité demandée'],
      ...materialCart.map((item) => [item.code, item.designation || '', item.qty || 1]),
    ];

    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });

    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `demande-materiel-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    window.UiService?.showToast?.('Demande exportée');
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

  function openMaterialRequestPreviewModal() {
    openDialogById('materialRequestPreviewModal');
  }

  function closeMaterialRequestPreviewModal() {
    closeDialogById('materialRequestPreviewModal');
  }


  function renderMaterialRequestPreview() {
    const tbody = requireElement('materialRequestPreviewBody');
    const table = requireElement('materialRequestPreviewTable');
    const emptyState = requireElement('materialRequestPreviewEmptyState');

    if (!tbody || !table || !emptyState) {
      return;
    }

    if (!materialCart.length) {
      tbody.innerHTML = '';
      table.hidden = true;
      emptyState.hidden = false;
      return;
    }

    tbody.innerHTML = materialCart
      .map((item) => `
      <tr>
        <td>${escapeHtml(item.code || '-')}</td>
        <td>${escapeHtml(item.designation || '-')}</td>
        <td>${escapeHtml(item.qty || 1)}</td>
      </tr>
    `)
      .join('');

    table.hidden = false;
    emptyState.hidden = true;
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

    loadMaterialCart();
    updateMaterialCartBadge();

    requireElement('materialCartFab')?.addEventListener('click', () => {
      renderMaterialCart();
      openMaterialCartModal();
    });

    requireElement('materialCartModal')?.addEventListener('click', (event) => {
      const modal = event.currentTarget;
      if (event.target === modal) {
        closeMaterialCartModal();
      }
    });

    requireElement('materialRequestPreviewModal')?.addEventListener('click', (event) => {
      const modal = event.currentTarget;
      if (event.target === modal) {
        closeMaterialRequestPreviewModal();
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
      renderMaterialRequestPreview();
      openMaterialRequestPreviewModal();
    });

    requireElement('backToMaterialCartBtn')?.addEventListener('click', () => {
      closeMaterialRequestPreviewModal();
      renderMaterialCart();
      openMaterialCartModal();
    });

    requireElement('exportMaterialRequestBtn')?.addEventListener('click', exportMaterialRequest);

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
