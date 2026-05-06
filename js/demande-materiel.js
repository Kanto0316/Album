(function () {
  const CART_KEY = 'materialRequestCart';

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

  function loadMaterialCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch (_error) {
      return [];
    }
  }

  function saveMaterialCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }

  function buildRequestExportArea(items) {
    const exportArea = document.createElement('div');

    exportArea.style.position = 'fixed';
    exportArea.style.left = '-9999px';
    exportArea.style.top = '0';
    exportArea.style.width = '900px';
    exportArea.style.background = '#ffffff';
    exportArea.style.padding = '32px';
    exportArea.style.fontFamily = 'Arial, sans-serif';
    exportArea.style.color = '#111827';

    exportArea.innerHTML = `
      <h2 style="margin:0 0 20px;font-size:28px;font-weight:800;">Demande de matériel</h2>
      <table style="width:100%;border-collapse:collapse;font-size:20px;">
        <thead>
          <tr style="background:#eef5fb;">
            <th style="text-align:left;padding:16px;border:1px solid #cbd5e1;">Code</th>
            <th style="text-align:left;padding:16px;border:1px solid #cbd5e1;">Désignation</th>
            <th style="text-align:center;padding:16px;border:1px solid #cbd5e1;">Quantité</th>
            <th style="text-align:center;padding:16px;border:1px solid #cbd5e1;">Unité</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td style="padding:14px;border:1px solid #cbd5e1;">${escapeHtml(item.code || '-')}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;">${escapeHtml(item.designation || '-')}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;text-align:center;">${escapeHtml(item.qty || 1)}</td>
              <td style="padding:14px;border:1px solid #cbd5e1;text-align:center;">${escapeHtml(item.unit || 'Pcs')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    document.body.appendChild(exportArea);
    return exportArea;
  }

  async function downloadRequestAsPng(items) {
    if (!items.length) {
      window.UiService?.showToast?.('Aucune demande à télécharger');
      return;
    }

    if (typeof window.html2canvas !== 'function') {
      window.UiService?.showToast?.('Export PNG indisponible');
      return;
    }

    const exportArea = buildRequestExportArea(items);

    try {
      const canvas = await window.html2canvas(exportArea, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        width: exportArea.scrollWidth,
        height: exportArea.scrollHeight,
        windowWidth: exportArea.scrollWidth,
        windowHeight: exportArea.scrollHeight,
      });

      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.download = `demande-materiel-${date}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();

      window.UiService?.showToast?.('Image PNG téléchargée ✔');
    } catch (error) {
      console.error('Erreur export PNG :', error);
      window.UiService?.showToast?.('Erreur téléchargement PNG');
    } finally {
      exportArea.remove();
    }
  }

  function render(items) {
    const tbody = requireElement('materialRequestBody');
    const table = requireElement('materialRequestTable');
    const emptyState = requireElement('materialRequestEmptyState');
    const count = requireElement('requestCount')?.querySelector('.count-number');

    if (!tbody || !table || !emptyState || !count) {
      return;
    }

    count.textContent = String(items.length);

    if (!items.length) {
      tbody.innerHTML = '';
      table.hidden = true;
      emptyState.hidden = false;
      return;
    }

    tbody.innerHTML = items.map((item) => `
      <tr>
        <td>${escapeHtml(item.code || '-')}</td>
        <td>${escapeHtml(item.designation || '-')}</td>
        <td>${escapeHtml(item.qty || 1)}</td>
        <td>${escapeHtml(item.unit || 'Pcs')}</td>
      </tr>
    `).join('');

    table.hidden = false;
    emptyState.hidden = true;
  }

  function init() {
    let items = loadMaterialCart();
    render(items);

    requireElement('requestBackButton')?.addEventListener('click', () => {
      window.location.assign('materiels.html');
    });

    requireElement('clearMaterialRequestBtn')?.addEventListener('click', () => {
      items = [];
      saveMaterialCart(items);
      render(items);
      window.UiService?.showToast?.('Demande vidée');
    });

    requireElement('downloadRequestPngBtn')?.addEventListener('click', () => downloadRequestAsPng(items));
  }

  init();
})();
