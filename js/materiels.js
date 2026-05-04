import { collectionGroup, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseDb } from './firebase-core.js';

(function () {
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
    const tbody = requireElement('materialsTableBody');
    const emptyState = requireElement('materialsEmptyState');
    const table = requireElement('materialsDataTable');
    const countNumber = document.querySelector('#materialsCount .count-number');

    if (!tbody || !emptyState || !table || !countNumber) {
      console.error('materialsTableBody introuvable');
      return;
    }

    countNumber.textContent = String(materials.length);

    if (!materials.length) {
      tbody.innerHTML = '<tr><td colspan="2">Aucun matériel disponible.</td></tr>';
      table.hidden = false;
      emptyState.hidden = true;
      return;
    }

    emptyState.hidden = true;
    table.hidden = false;
    tbody.innerHTML = materials
      .map(
        (item) => `\n          <tr>\n            <td>${escapeHtml(item.code)}</td>\n            <td>${escapeHtml(item.designation || '-')}</td>\n          </tr>\n        `,
      )
      .join('');
  }

  async function loadAllMaterials() {
    console.log('Chargement tous matériels...');
    const snap = await getDocs(collectionGroup(firebaseDb, 'page3'));
    console.log('Nombre documents articles :', snap.size);

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

  async function init() {
    const backButton = requireElement('materialsBackButton');
    const searchInput = requireElement('materialsSearchInput');
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

    try {
      allMaterials = await loadAllMaterials();
      renderMaterials(allMaterials);
    } catch (error) {
      console.error('Erreur chargement matériels :', error);
      renderMaterials([]);
    } finally {
      window.hideGlobalSkeleton?.();
      document.body.classList.remove('loading');
    }
  }

  init();
})();
