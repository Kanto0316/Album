import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseDb } from './firebase-core.js';

(function () {
  const isMaterialsPage = location.pathname.includes('materiels.html');

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
    <tr>
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
