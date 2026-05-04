(function () {
  const { StorageService } = window;

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

  function normalizeMaterials(details) {
    const map = new Map();

    details.forEach((item) => {
      const code = String(item?.code || item?.ref || item?.reference || '').trim();
      const designation = String(item?.designation || item?.['désignation'] || item?.name || '').trim();

      if (code && !map.has(code)) {
        map.set(code, {
          code,
          designation,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      String(a.designation).localeCompare(String(b.designation), 'fr', { sensitivity: 'base' }),
    );
  }

  function renderRows(rows) {
    const tbody = requireElement('materialsTableBody');
    const emptyState = requireElement('materialsEmptyState');
    const table = requireElement('materialsDataTable');
    const countNumber = document.querySelector('#materialsCount .count-number');

    if (!tbody || !emptyState || !table || !countNumber) {
      return;
    }

    countNumber.textContent = String(rows.length);

    if (!rows.length) {
      tbody.innerHTML = '';
      table.hidden = true;
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;
    table.hidden = false;
    tbody.innerHTML = rows
      .map(
        (material) => `\n          <tr>\n            <td>${escapeHtml(material.code)}</td>\n            <td>${escapeHtml(material.designation)}</td>\n          </tr>\n        `,
      )
      .join('');
  }

  async function init() {
    const backButton = requireElement('materialsBackButton');
    const searchInput = requireElement('materialsSearchInput');

    backButton?.addEventListener('click', () => {
      window.location.assign('index.html');
    });

    await StorageService.init();
    const details = await StorageService.getAllDetails();
    const materials = normalizeMaterials(details);

    const applySearch = () => {
      const query = String(searchInput?.value || '').trim().toLowerCase();
      if (!query) {
        renderRows(materials);
        return;
      }
      const filtered = materials.filter((material) => {
        const code = String(material.code || '').toLowerCase();
        const designation = String(material.designation || '').toLowerCase();
        return code.includes(query) || designation.includes(query);
      });
      renderRows(filtered);
    };

    searchInput?.addEventListener('input', applySearch);
    renderRows(materials);
  }

  init();
})();
