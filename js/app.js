(function () {
  const { StorageService, UiService } = window;

  function requireElement(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setCountText(element, count, singular, plural) {
    element.textContent = `${count} ${count > 1 ? plural : singular}`;
  }

  function setupBackButtons() {
    document.querySelectorAll("[data-back]").forEach((button) => {
      button.addEventListener("click", () => {
        UiService.navigate(button.dataset.back);
      });
    });
  }

  function downloadExcelFile(fileName, title, workbook) {
    const blob = new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    UiService.showToast(`${title} lancé.`);
  }

  function buildDetailExcelContent(title, details) {
    const rows = details
      .map(
        (detail) => `
            <tr>
              <td>${escapeHtml(detail.champ)}</td>
              <td>${escapeHtml(detail.code)}</td>
              <td>${escapeHtml(detail.designation)}</td>
              <td>${escapeHtml(detail.qteSortie)}</td>
              <td>${escapeHtml(detail.unite)}</td>
              <td>${escapeHtml(detail.qtePosee)}</td>
              <td>${escapeHtml(detail.qteRetour)}</td>
              <td>${escapeHtml(detail.observation)}</td>
            </tr>
          `,
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>Champ</th>
          <th>Code</th>
          <th>Désignation</th>
          <th>Qté Sortie</th>
          <th>Unité</th>
          <th>Qté posée</th>
          <th>Qté Retour</th>
          <th>Observation</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
  }

  function buildSiteExcelContent(title, rows) {
    const bodyRows = rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.out)}</td>
            <td>${escapeHtml(row.champ)}</td>
            <td>${escapeHtml(row.code)}</td>
            <td>${escapeHtml(row.designation)}</td>
            <td>${escapeHtml(row.qteSortie)}</td>
            <td>${escapeHtml(row.unite)}</td>
            <td>${escapeHtml(row.qtePosee)}</td>
            <td>${escapeHtml(row.qteRetour)}</td>
            <td>${escapeHtml(row.observation)}</td>
          </tr>
        `,
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>OUT</th>
          <th>Champ</th>
          <th>Code</th>
          <th>Désignation</th>
          <th>Qté Sortie</th>
          <th>Unité</th>
          <th>Qté posée</th>
          <th>Qté Retour</th>
          <th>Observation</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body>
</html>`;
  }

  function initHomePage() {
    const searchInput = requireElement("searchInput");
    const siteList = requireElement("siteList");
    const siteCount = requireElement("siteCount");
    const siteDialog = requireElement("siteDialog");
    const siteForm = requireElement("siteForm");
    const siteNameInput = requireElement("siteNameInput");
    const siteFormError = requireElement("siteFormError");
    const homeMenuButton = requireElement("homeMenuButton");
    const homeMenuPanel = requireElement("homeMenuPanel");
    const importDataButton = requireElement("importDataButton");
    const mergeDataButton = requireElement("mergeDataButton");
    const exportDataButton = requireElement("exportDataButton");
    const quitButton = requireElement("quitButton");
    const importDataInput = requireElement("importDataInput");
    let importMode = "replace";

    function setImportMode(mode) {
      importMode = mode === "merge" ? "merge" : "replace";
      if (importDataInput) {
        importDataInput.dataset.importMode = importMode;
      }
    }

    function resetImportMode() {
      setImportMode("replace");
    }

    function formatExportFileName() {
      const now = new Date();
      const datePart = now.toISOString().replace(/[:]/g, "-").replace(/\..+/, "").replace("T", "_");
      return `Exporter.${datePart}.su`;
    }

    function closeHomeMenu() {
      if (!homeMenuPanel || !homeMenuButton) {
        return;
      }
      homeMenuPanel.hidden = true;
      homeMenuButton.setAttribute("aria-expanded", "false");
    }

    function openHomeMenu() {
      if (!homeMenuPanel || !homeMenuButton) {
        return;
      }
      homeMenuPanel.hidden = false;
      homeMenuButton.setAttribute("aria-expanded", "true");
    }

    function downloadSuFile(fileName, content) {
      const blob = new Blob([content], { type: "application/octet-stream" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }

    async function handleImportFile(event) {
      const [file] = Array.from(event.target.files || []);
      if (!file) {
        resetImportMode();
        return;
      }

      const activeImportMode = event.target.dataset.importMode === "merge" ? "merge" : importMode;

      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const action =
          activeImportMode === "merge" ? StorageService.mergeImportData : StorageService.importData;
        const imported = action(payload);
        if (!imported) {
          UiService.showToast("Fichier .su invalide.");
          return;
        }
        renderSites();
        UiService.showToast(activeImportMode === "merge" ? "Données fusionnées." : "Données importées.");
      } catch (error) {
        UiService.showToast("Importation impossible.");
      } finally {
        event.target.value = "";
        resetImportMode();
      }
    }

    function exportAllData() {
      const payload = StorageService.exportData();
      const serialized = JSON.stringify(payload, null, 2);
      downloadSuFile(formatExportFileName(), serialized);
      UiService.showToast("Exportation lancée.");
    }

    function openImportFilePicker(mode) {
      if (!importDataInput) {
        return;
      }

      closeHomeMenu();
      setImportMode(mode);
      importDataInput.value = "";

      try {
        if (typeof importDataInput.showPicker === "function") {
          importDataInput.showPicker();
          return;
        }
      } catch (error) {
        // Certains navigateurs refusent showPicker sur un input fichier masqué.
      }

      importDataInput.click();
    }

    function renderSites() {
      const query = searchInput.value.trim().toUpperCase();
      const sites = StorageService.getSites().filter((site) => site.nom.toUpperCase().includes(query));
      setCountText(siteCount, sites.length, "site", "sites");

      if (!sites.length) {
        UiService.renderEmptyState(
          siteList,
          query ? "Aucun site ne correspond à votre recherche." : "Aucun site enregistré pour le moment.",
        );
        return;
      }

      siteList.innerHTML = sites
        .map(
          (site) => `
            <article class="list-card">
              <button class="list-card__button" type="button" data-site-open="${site.id}">
                <h3 class="list-card__title">${escapeHtml(site.nom)}</h3>
                <div class="list-card__meta">
                  <span>Créé le ${UiService.formatDate(site.dateCreation)}</span>
                  <small>Modifié le ${UiService.formatDate(site.dateModification)}</small>
                  <small>${site.items.length} sous-élément(s)</small>
                </div>
              </button>
              <div class="list-card__actions">
                <button class="btn-danger" type="button" data-site-delete="${site.id}">Supprimer</button>
              </div>
            </article>
          `,
        )
        .join("");

      siteList.querySelectorAll("[data-site-open]").forEach((button) => {
        button.addEventListener("click", () => {
          UiService.navigate(`page2.html?siteId=${encodeURIComponent(button.dataset.siteOpen)}`);
        });
      });

      siteList.querySelectorAll("[data-site-delete]").forEach((button) => {
        button.addEventListener("click", () => {
          StorageService.removeSite(button.dataset.siteDelete);
          UiService.showToast("Site supprimé.");
          renderSites();
        });
      });
    }

    if (homeMenuButton && homeMenuPanel) {
      homeMenuButton.addEventListener("click", () => {
        if (homeMenuPanel.hidden) {
          openHomeMenu();
          return;
        }
        closeHomeMenu();
      });

      document.addEventListener("click", (event) => {
        if (!event.target.closest(".header-menu")) {
          closeHomeMenu();
        }
      });
    }

    if (exportDataButton) {
      exportDataButton.addEventListener("click", () => {
        closeHomeMenu();
        exportAllData();
      });
    }

    if (importDataButton && importDataInput) {
      importDataButton.addEventListener("click", () => {
        openImportFilePicker("replace");
      });
    }

    if (mergeDataButton && importDataInput) {
      mergeDataButton.addEventListener("click", () => {
        openImportFilePicker("merge");
      });
    }

    if (importDataInput) {
      importDataInput.addEventListener("change", handleImportFile);
      importDataInput.addEventListener("cancel", resetImportMode);
    }

    if (quitButton) {
      quitButton.addEventListener("click", () => {
        closeHomeMenu();
        window.confirm("Voulez vous vraiment quiter?");
      });
    }

    requireElement("openCreateSite").addEventListener("click", () => {
      siteForm.reset();
      siteFormError.textContent = "";
      siteDialog.showModal();
      siteNameInput.focus();
    });

    searchInput.addEventListener("input", renderSites);

    siteForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = siteNameInput.value.trim();
      if (!name) {
        siteFormError.textContent = "Veuillez remplir ce champ";
        return;
      }
      StorageService.createSite(name);
      siteDialog.close();
      UiService.showToast("Site créé avec succès.");
      renderSites();
    });

    renderSites();
  }

  function initSiteDetailPage() {
    const params = UiService.getQueryParams();
    const siteId = params.get("siteId");
    const site = StorageService.getSite(siteId);
    if (!site) {
      UiService.navigate("index.html");
      return;
    }

    const siteTitle = requireElement("siteTitle");
    const itemList = requireElement("itemList");
    const itemCount = requireElement("itemCount");
    const itemDialog = requireElement("itemDialog");
    const itemForm = requireElement("itemForm");
    const itemNumberInput = requireElement("itemNumberInput");
    const itemFormError = requireElement("itemFormError");
    const openExportItems = requireElement("openExportItems");
    const itemSearchInput = requireElement("itemSearchInput");

    siteTitle.textContent = site.nom;

    function formatSiteExportUnit(unit) {
      const normalizedUnit = String(unit || "").trim().toLowerCase();
      if (normalizedUnit === "pcs") {
        return "pcs";
      }
      return normalizedUnit || "m";
    }

    function buildSiteExportRows() {
      const currentSite = StorageService.getSite(siteId);
      if (!currentSite) {
        return [];
      }

      return currentSite.items.flatMap((item) => {
        if (!item.details.length) {
          return [];
        }

        return item.details.map((detail) => ({
          out: item.numero,
          champ: detail.champ,
          code: detail.code,
          designation: detail.designation,
          qteSortie: detail.qteSortie,
          unite: formatSiteExportUnit(detail.unite),
          qtePosee: detail.qtePosee,
          qteRetour: detail.qteRetour,
          observation: detail.observation,
        }));
      });
    }

    function exportItems() {
      const currentSite = StorageService.getSite(siteId);
      if (!currentSite) {
        UiService.navigate("index.html");
        return;
      }

      const rows = buildSiteExportRows();
      if (!rows.length) {
        UiService.showToast("Aucun sous-élément avec des données à exporter.");
        return;
      }

      const title = `${currentSite.nom}.SUIVI MATERIEL`;
      const workbook = buildSiteExcelContent(title, rows);
      downloadExcelFile(`${title}.xls`, "Export Excel", workbook);
    }

    function renderItems() {
      const nextSite = StorageService.getSite(siteId);
      if (!nextSite) {
        UiService.navigate("index.html");
        return;
      }

      const query = itemSearchInput.value.trim().toUpperCase();
      const filteredItems = nextSite.items.filter((item) => item.numero.toUpperCase().includes(query));

      setCountText(itemCount, filteredItems.length, "élément", "éléments");

      if (!filteredItems.length) {
        UiService.renderEmptyState(
          itemList,
          query ? "Aucun N° OUT ne correspond à votre recherche." : "Aucun sous-élément pour cette liste.",
        );
        return;
      }

      itemList.innerHTML = filteredItems
        .map(
          (item) => `
            <article class="list-card">
              <button class="list-card__button" type="button" data-item-open="${item.id}">
                <h3 class="list-card__title">${escapeHtml(item.numero)}</h3>
                <div class="list-card__meta">
                  <span>Créé le ${UiService.formatDate(item.dateCreation)}</span>
                  <small>Modifié le ${UiService.formatDate(item.dateModification)}</small>
                  <small>${item.details.length} ligne(s)</small>
                </div>
              </button>
              <div class="list-card__actions">
                <button class="btn-danger" type="button" data-item-delete="${item.id}">Supprimer</button>
              </div>
            </article>
          `,
        )
        .join("");

      itemList.querySelectorAll("[data-item-open]").forEach((button) => {
        button.addEventListener("click", () => {
          UiService.navigate(
            `page3.html?siteId=${encodeURIComponent(siteId)}&itemId=${encodeURIComponent(button.dataset.itemOpen)}`,
          );
        });
      });

      itemList.querySelectorAll("[data-item-delete]").forEach((button) => {
        button.addEventListener("click", () => {
          StorageService.removeItem(siteId, button.dataset.itemDelete);
          UiService.showToast("Élément supprimé.");
          renderItems();
        });
      });
    }

    requireElement("openCreateItem").addEventListener("click", () => {
      itemForm.reset();
      itemFormError.textContent = "";
      itemDialog.showModal();
      itemNumberInput.focus();
    });

    itemNumberInput.addEventListener("input", () => {
      const digitsOnly = itemNumberInput.value.replace(/\D/g, "");
      if (itemNumberInput.value !== digitsOnly) {
        itemNumberInput.value = digitsOnly;
      }
    });

    if (openExportItems) {
      openExportItems.addEventListener("click", exportItems);
    }

    itemSearchInput.addEventListener("input", renderItems);

    itemForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = itemNumberInput.value.trim();
      if (!value) {
        itemFormError.textContent = "Veuillez remplir ce champ";
        return;
      }
      if (!/^\d+$/.test(value)) {
        itemFormError.textContent = "Veuillez saisir des chiffres uniquement.";
        return;
      }
      if (value.length < 4) {
        itemFormError.textContent = "Veuillez saisir au moins 4 chiffres.";
        return;
      }
      const createdItem = StorageService.createItem(siteId, value);
      if (!createdItem) {
        itemFormError.textContent = "Veuillez saisir au moins 4 chiffres.";
        return;
      }
      itemDialog.close();
      UiService.showToast("Numéro OUT ajouté.");
      renderItems();
    });

    renderItems();
  }

  function initItemDetailPage() {
    const params = UiService.getQueryParams();
    const siteId = params.get("siteId");
    const itemId = params.get("itemId");
    const site = StorageService.getSite(siteId);
    const item = StorageService.getItem(siteId, itemId);

    if (!site || !item) {
      UiService.navigate("index.html");
      return;
    }

    requireElement("itemTitle").textContent = `${site.nom} · ${item.numero}`;
    requireElement("itemBackButton").addEventListener("click", () => {
      UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
    });

    const detailForm = requireElement("detailForm");
    const detailFormError = requireElement("detailFormError");
    const detailCount = requireElement("detailCount");
    const detailTableBody = requireElement("detailTableBody");
    const detailSearchInput = requireElement("detailSearchInput");
    const exportButton = requireElement("exportDetailsButton");
    const designationInput = requireElement("designationInput");

    function getSearchQuery() {
      return detailSearchInput ? detailSearchInput.value.trim().toLowerCase() : "";
    }

    function getFilteredDetails(details) {
      const query = getSearchQuery();
      if (!query) {
        return details;
      }
      return details.filter((detail) => String(detail.designation || "").toLowerCase().includes(query));
    }

    function updateCount(filteredCount, totalCount) {
      if (filteredCount === totalCount) {
        setCountText(detailCount, totalCount, "ligne", "lignes");
        return;
      }
      detailCount.textContent = `${filteredCount} ligne${filteredCount > 1 ? "s" : ""} affichée${filteredCount > 1 ? "s" : ""} / ${totalCount}`;
    }

    function exportDetails() {
      const currentItem = StorageService.getItem(siteId, itemId);
      if (!currentItem) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(currentItem.details);
      if (!filteredDetails.length) {
        UiService.showToast("Aucune ligne à exporter.");
        return;
      }

      const fileName = `${site.nom} · ${currentItem.numero}.xls`;
      const workbook = buildDetailExcelContent(`${site.nom} · ${currentItem.numero}`, filteredDetails);
      downloadExcelFile(fileName, "Export Excel", workbook);
    }

    function renderTable() {
      const nextItem = StorageService.getItem(siteId, itemId);
      if (!nextItem) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(nextItem.details);
      updateCount(filteredDetails.length, nextItem.details.length);

      if (!filteredDetails.length) {
        detailTableBody.innerHTML = `<tr><td colspan="10"><div class="empty-state">${nextItem.details.length ? "Aucune désignation ne correspond à votre recherche." : "Aucune ligne enregistrée."}</div></td></tr>`;
        return;
      }

      detailTableBody.innerHTML = filteredDetails
        .map(
          (detail) => `
            <tr data-detail-id="${detail.id}">
              <td><span class="field-badge">${detail.champ}</span></td>
              <td><input class="cell-input" data-field="code" value="${escapeHtml(detail.code)}" /></td>
              <td><input class="cell-input" data-field="designation" value="${escapeHtml(detail.designation)}" /></td>
              <td>
                <div>
                  <input class="cell-input" data-field="qteSortie" type="number" min="0" step="1" value="${escapeHtml(detail.qteSortie)}" />
                  <small class="meta-value">${escapeHtml(detail.unite)}</small>
                </div>
              </td>
              <td><input class="cell-input" data-field="qtePosee" type="number" min="0" max="${escapeHtml(detail.qteSortie)}" step="1" value="${detail.qtePosee}" /></td>
              <td><input class="cell-input" data-field="qteRetour" type="number" min="0" max="${escapeHtml(detail.qteSortie)}" step="1" value="${detail.qteRetour}" /></td>
              <td><span class="meta-value">${UiService.formatDate(detail.dateCreation)}</span></td>
              <td><span class="meta-value">${UiService.formatDate(detail.dateModification)}</span></td>
              <td><textarea class="cell-textarea" data-field="observation">${escapeHtml(detail.observation)}</textarea></td>
              <td><button class="btn-danger" type="button" data-detail-delete="${detail.id}">Supprimer</button></td>
            </tr>
          `,
        )
        .join("");

      detailTableBody.querySelectorAll("[data-field]").forEach((field) => {
        field.addEventListener("change", (event) => {
          const row = event.target.closest("tr");
          const fieldName = event.target.dataset.field;
          const currentDetail = nextItem.details.find((detail) => detail.id === row.dataset.detailId);

          if (!currentDetail) {
            return;
          }

          let nextValue = event.target.value;

          if (fieldName === "qteRetour") {
            const qteSortie = Number(currentDetail.qteSortie) || 0;
            const qteRetour = Number(nextValue) || 0;
            if (qteRetour > qteSortie) {
              nextValue = String(qteSortie);
              UiService.showToast("La Qté Retour ne peut pas dépasser la Qté Sortie.");
            }
          }

          if (fieldName === "qtePosee") {
            const qteSortie = Number(currentDetail.qteSortie) || 0;
            const qtePosee = Number(nextValue) || 0;
            if (qtePosee > qteSortie) {
              nextValue = String(qteSortie);
              UiService.showToast("La Qté posée ne peut pas dépasser la Qté Sortie.");
            }
          }

          if (fieldName === "qteSortie") {
            const qteSortie = Number(nextValue) || 0;
            if ((Number(currentDetail.qteRetour) || 0) > qteSortie) {
              UiService.showToast("La Qté Retour a été ajustée à la Qté Sortie.");
            } else if ((Number(currentDetail.qtePosee) || 0) > qteSortie) {
              UiService.showToast("La Qté posée a été ajustée à la Qté Sortie.");
            }
          }

          StorageService.updateDetail(siteId, itemId, row.dataset.detailId, {
            [fieldName]: nextValue,
          });

          renderTable();
        });
      });

      detailTableBody.querySelectorAll("[data-detail-delete]").forEach((button) => {
        button.addEventListener("click", () => {
          StorageService.removeDetail(siteId, itemId, button.dataset.detailDelete);
          UiService.showToast("Ligne supprimée.");
          renderTable();
        });
      });
    }

    detailForm.addEventListener("submit", (event) => {
      event.preventDefault();
      detailFormError.textContent = "";
      if (!designationInput.value.trim()) {
        detailFormError.textContent = "Veuillez remplir la désignation.";
        return;
      }
      StorageService.createDetail(siteId, itemId, {
        code: requireElement("codeInput").value,
        designation: designationInput.value,
        qteSortie: requireElement("qteSortieInput").value,
        unite: requireElement("uniteInput").value,
      });
      detailForm.reset();
      requireElement("uniteInput").value = "m";
      UiService.showToast("Ligne ajoutée.");
      renderTable();
    });

    if (detailSearchInput) {
      detailSearchInput.addEventListener("input", renderTable);
    }

    if (exportButton) {
      exportButton.addEventListener("click", exportDetails);
    }

    renderTable();
  }

  function registerOfflineSupport() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // Le support hors connexion reste optionnel si l'enregistrement échoue.
      });
    });
  }

  async function bootstrap() {
    UiService.bindDialogCloser();
    setupBackButtons();
    await StorageService.init();

    const page = document.body.dataset.page;
    if (page === "home") {
      initHomePage();
    }
    if (page === "site-detail") {
      initSiteDetailPage();
    }
    if (page === "item-detail") {
      initItemDetailPage();
    }
  }

  registerOfflineSupport();
  bootstrap();
})();
