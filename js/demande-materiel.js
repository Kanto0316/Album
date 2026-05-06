const CART_KEY = 'materialRequestCart';
let materialCart = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function saveRequestCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(materialCart));
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

async function downloadRequestAsPng() {
  if (!materialCart.length) {
    window.UiService?.showToast?.('Aucune demande à télécharger');
    return;
  }

  if (typeof window.html2canvas !== 'function') {
    window.UiService?.showToast?.('Export PNG indisponible');
    return;
  }

  const exportArea = buildRequestExportArea(materialCart);

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

function loadRequestCart() {
  try {
    materialCart = JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch (error) {
    console.error('Erreur lecture panier :', error);
    materialCart = [];
  }

  console.log('Panier lu dans demande :', localStorage.getItem('materialRequestCart'));
  console.log('Demande récupérée :', materialCart);
}

function renderRequestPage() {
  const count = document.querySelector('#requestCount');
  const tbody = document.querySelector('#requestTableBody');
  const empty = document.querySelector('#requestEmptyState');
  const tableWrap = document.querySelector('#requestTableWrap');

  if (count) count.textContent = String(materialCart.length);

  if (!tbody) {
    console.error('#requestTableBody introuvable');
    return;
  }

  if (!materialCart.length) {
    renderEmptyRequest();
    return;
  }

  empty?.classList.add('hidden');
  tableWrap?.classList.remove('hidden');

  tbody.innerHTML = materialCart.map((item) => `
    <tr>
      <td>${escapeHtml(item.code || '-')}</td>
      <td>${escapeHtml(item.designation || '-')}</td>
      <td>${escapeHtml(item.qty || 1)}</td>
      <td>${escapeHtml(item.unit || 'Pcs')}</td>
    </tr>
  `).join('');
}

function renderEmptyRequest() {
  const count = document.querySelector('#requestCount');
  const tbody = document.querySelector('#requestTableBody');
  const empty = document.querySelector('#requestEmptyState');
  const tableWrap = document.querySelector('#requestTableWrap');

  if (count) count.textContent = '0';
  if (tbody) tbody.innerHTML = '';
  empty?.classList.remove('hidden');
  tableWrap?.classList.add('hidden');
}

function hideRequestSkeleton() {
  document.body.classList.remove('loading');

  document.querySelectorAll(
    '.skeleton, .skeleton-container, .global-skeleton, .page-skeleton, .shimmer',
  ).forEach((el) => {
    el.style.display = 'none';
    el.remove();
  });

  document.querySelector('.page-content')?.classList.remove('hidden');
}

function initDemandeMaterielPage() {
  try {
    loadRequestCart();
    renderRequestPage();
  } catch (error) {
    console.error('Erreur demande matériel :', error);
    renderEmptyRequest();
  } finally {
    hideRequestSkeleton();
  }

  document.querySelector('#requestBackButton')?.addEventListener('click', () => {
    window.location.href = 'materiels.html';
  });

  document.querySelector('#clearRequestBtn')?.addEventListener('click', () => {
    materialCart = [];
    saveRequestCart();
    renderEmptyRequest();
    window.UiService?.showToast?.('Demande vidée');
  });

  document.querySelector('#downloadRequestPngBtn')?.addEventListener('click', downloadRequestAsPng);
}

document.addEventListener('DOMContentLoaded', () => {
  initDemandeMaterielPage();
});
