const CART_KEY = "materialRequestCart";
let materialCart = [];

console.log("✅ demande-materiel.js chargé");

document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ DOM demande-materiel prêt");
  initDemandePage();
});

function initDemandePage() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    console.log("RAW materialRequestCart =", raw);

    materialCart = JSON.parse(raw || "[]");

    if (!Array.isArray(materialCart)) {
      materialCart = [];
    }

    renderDemande();
  } catch (error) {
    console.error("Erreur init demande :", error);
    materialCart = [];
    renderDemande();
  } finally {
    forceShowPage();
  }
}

function renderDemande() {
  const count = document.querySelector("#requestCount");
  const empty = document.querySelector("#requestEmptyState");
  const tableWrap = document.querySelector("#requestTableWrap");
  const tbody = document.querySelector("#requestTableBody");

  if (!tbody) {
    console.error("❌ #requestTableBody introuvable");
    return;
  }

  if (count) count.textContent = materialCart.length;

  if (!materialCart.length) {
    empty?.classList.remove("hidden");
    tableWrap?.classList.add("hidden");
    tbody.innerHTML = "";
    return;
  }

  empty?.classList.add("hidden");
  tableWrap?.classList.remove("hidden");

  tbody.innerHTML = materialCart.map(item => `
    <tr>
      <td>${item.code || "-"}</td>
      <td>${item.designation || "-"}</td>
      <td>${item.qty || 1}</td>
      <td>${item.unit || "Pcs"}</td>
    </tr>
  `).join("");
}

function forceShowPage() {
  document.body.classList.remove("loading");

  document.querySelectorAll(
    ".skeleton, .skeleton-container, .global-skeleton, .page-skeleton, .shimmer"
  ).forEach(el => el.remove());

  const content = document.querySelector("#demandeContent");
  if (content) {
    content.hidden = false;
    content.classList.remove("hidden");
    content.style.display = "block";
    content.style.opacity = "1";
    content.style.visibility = "visible";
  }

  console.log("✅ page demande affichée");
}
