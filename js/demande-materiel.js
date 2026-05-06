const CART_KEY = 'materialRequestCart';

let materialCart = [];

console.log('demande-materiel.js chargé');

document.addEventListener('DOMContentLoaded', () => {
  initPage();
});

function initPage() {
  console.log('Init page demande');

  loadCart();

  renderPage();

  hideSkeleton();

  bindActions();
}

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);

    console.log('RAW CART =', raw);

    materialCart = JSON.parse(raw || '[]');

    console.log('PANIER =', materialCart);
  } catch (error) {
    console.error('Erreur lecture panier :', error);

    materialCart = [];
  }
}

function renderPage() {
  const tbody = document.querySelector('#requestTableBody');
  const count = document.querySelector('#requestCount');
  const empty = document.querySelector('#requestEmptyState');
  const tableWrap = document.querySelector('#requestTableWrap');

  console.log('tbody =', tbody);

  if (!tbody) {
    console.error('requestTableBody introuvable');
    return;
  }

  if (count) {
    count.textContent = String(materialCart.length);
  }

  if (!materialCart.length) {
    if (empty) {
      empty.classList.remove('hidden');
    }

    if (tableWrap) {
      tableWrap.classList.add('hidden');
    }

    tbody.innerHTML = '';
    return;
  }

  if (empty) {
    empty.classList.add('hidden');
  }

  if (tableWrap) {
    tableWrap.classList.remove('hidden');
  }

  tbody.innerHTML = materialCart
    .map(
      (item) => `
    <tr>
      <td>${item.code || '-'}</td>
      <td>${item.designation || '-'}</td>
      <td>${item.qty || 1}</td>
      <td>${item.unit || 'Pcs'}</td>
    </tr>
  `,
    )
    .join('');
}

function hideSkeleton() {
  console.log('hideSkeleton');

  document.body.classList.remove('loading');

  document.querySelectorAll('.skeleton, .global-skeleton, .page-skeleton, .shimmer').forEach((el) => {
    el.remove();
  });

  const content = document.querySelector('.page-content');

  if (content) {
    content.classList.remove('hidden');
  }
}

function bindActions() {
  const backBtn = document.querySelector('#requestBackButton');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'materiels.html';
    });
  }

  const clearBtn = document.querySelector('#clearRequestBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      materialCart = [];
      localStorage.setItem(CART_KEY, JSON.stringify(materialCart));
      renderPage();
    });
  }
}
