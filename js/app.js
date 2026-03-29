(function () {
  const { StorageService, UiService } = window;

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

  function setCountText(element, count, singular, plural) {
    element.textContent = `${count} ${count === 1 ? singular : plural}`;
  }

  function computeEcart(detail) {
    const qteSortie = Number(detail?.qteSortie) || 0;
    const qtePosee = Number(detail?.qtePosee) || 0;
    const qteRetour = Number(detail?.qteRetour) || 0;

    if (qtePosee === 0 && qteRetour === 0) {
      return '';
    }

    return qteSortie - (qtePosee + qteRetour);
  }

  function setupBackButtons() {
    document.querySelectorAll('[data-back]').forEach((button) => {
      button.addEventListener('click', () => {
        UiService.navigate(button.dataset.back);
      });
    });
  }

  function downloadExcelFile(fileName, title, workbook) {
    const blob = new Blob(['\ufeff', workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
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
              <td>${escapeHtml(computeEcart(detail))}</td>
              <td>${escapeHtml(detail.observation)}</td>
            </tr>
          `,
      )
      .join('');

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
          <th>Ecart</th>
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
      .join('');

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
    const searchInput = requireElement('searchInput');
    const siteList = requireElement('siteList');
    const siteCount = requireElement('siteCount');
    const siteDialog = requireElement('siteDialog');
    const siteForm = requireElement('siteForm');
    const siteNameInput = requireElement('siteNameInput');
    const siteFormError = requireElement('siteFormError');
    const homeMenuButton = requireElement('homeMenuButton');
    const homeMenuPanel = requireElement('homeMenuPanel');
    const importDataButton = requireElement('importDataButton');
    const exportDataButton = requireElement('exportDataButton');

    let currentSites = [];
    let itemCountsBySite = {};

    function formatExportFileName() {
      const now = new Date();
      const datePart = now.toISOString().replace(/[:]/g, '-').replace(/\..+/, '').replace('T', '_');
      return `Exporter.${datePart}.su`;
    }

    function closeHomeMenu() {
      if (!homeMenuPanel || !homeMenuButton) {
        return;
      }
      homeMenuPanel.hidden = true;
      homeMenuButton.setAttribute('aria-expanded', 'false');
    }

    function openHomeMenu() {
      if (!homeMenuPanel || !homeMenuButton) {
        return;
      }
      homeMenuPanel.hidden = false;
      homeMenuButton.setAttribute('aria-expanded', 'true');
    }

    function downloadSuFile(fileName, content) {
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }

    async function handleImportFile(fileInput) {
      const [file] = Array.from(fileInput.files || []);
      if (!file) {
        fileInput.remove();
        return;
      }

      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const imported = await StorageService.importData(payload);
        if (!imported) {
          UiService.showToast('Fichier .su invalide.');
          return;
        }
        UiService.showToast('Données importées et synchronisées.');
      } catch (_error) {
        UiService.showToast('Importation impossible.');
      } finally {
        fileInput.value = '';
        fileInput.remove();
      }
    }

    function exportAllData() {
      const payload = StorageService.exportData();
      const serialized = JSON.stringify(payload, null, 2);
      downloadSuFile(formatExportFileName(), serialized);
      UiService.showToast('Exportation lancée.');
    }

    function openImportFilePicker() {
      closeHomeMenu();

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.su,.json,application/json';
      fileInput.hidden = true;
      fileInput.tabIndex = -1;
      fileInput.setAttribute('aria-hidden', 'true');
      fileInput.addEventListener(
        'change',
        () => {
          handleImportFile(fileInput);
        },
        { once: true },
      );
      document.body.appendChild(fileInput);

      try {
        if (typeof fileInput.showPicker === 'function') {
          fileInput.showPicker();
          return;
        }
      } catch (_error) {
        // Certains navigateurs refusent showPicker sur certains contextes.
      }

      fileInput.click();
    }

    function renderSites() {
      const query = searchInput.value.trim().toUpperCase();
      const sites = currentSites.filter((site) => String(site.nom || '').toUpperCase().includes(query));
      setCountText(siteCount, sites.length, 'site', 'sites');

      if (!sites.length) {
        UiService.renderEmptyState(
          siteList,
          query ? 'Aucun site ne correspond à votre recherche.' : 'Aucun site enregistré pour le moment.',
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
                  <span>${itemCountsBySite[site.id] || 0} OUT${(itemCountsBySite[site.id] || 0) > 1 ? 'S' : ''}</span>
                  <span>Créé le ${UiService.formatDate(site.dateCreation)}</span>
                  <small>Modifié le ${UiService.formatDate(site.dateModification)}</small>
                </div>
              </button>
              <div class="list-card__actions">
                <button class="btn-danger" type="button" data-site-delete="${site.id}">Supprimer</button>
              </div>
            </article>
          `,
        )
        .join('');

      siteList.querySelectorAll('[data-site-open]').forEach((button) => {
        button.addEventListener('click', () => {
          UiService.navigate(`page2.html?siteId=${encodeURIComponent(button.dataset.siteOpen)}`);
        });
      });

      siteList.querySelectorAll('[data-site-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          const removedSnapshot = await StorageService.removeSite(button.dataset.siteDelete);
          if (!removedSnapshot) {
            UiService.showToast('Suppression impossible.');
            return;
          }
          UiService.showUndoSnackbar('Site supprimé.', async () => {
            const restored = await StorageService.restoreSite(removedSnapshot);
            UiService.showToast(restored ? 'Suppression annulée.' : 'Restauration impossible.');
          });
        });
      });
    }

    if (homeMenuButton && homeMenuPanel) {
      homeMenuButton.addEventListener('click', () => {
        if (homeMenuPanel.hidden) {
          openHomeMenu();
          return;
        }
        closeHomeMenu();
      });

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.header-menu')) {
          closeHomeMenu();
        }
      });
    }

    if (exportDataButton) {
      exportDataButton.addEventListener('click', () => {
        closeHomeMenu();
        exportAllData();
      });
    }

    if (importDataButton) {
      importDataButton.addEventListener('click', () => {
        openImportFilePicker();
      });
    }

    requireElement('openCreateSite').addEventListener('click', () => {
      siteForm.reset();
      siteFormError.textContent = '';
      siteDialog.showModal();
      siteNameInput.focus();
    });

    searchInput.addEventListener('input', renderSites);

    siteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = siteNameInput.value.trim();
      if (!name) {
        siteFormError.textContent = 'Veuillez remplir ce champ';
        return;
      }

      try {
        const result = await StorageService.createSite(name);
        if (!result?.ok) {
          siteFormError.textContent =
            result?.reason === 'duplicate_site'
              ? 'Ce nom de site existe déjà.'
              : 'Création impossible. Vérifiez le nom du site.';
          return;
        }

        siteDialog.close();
        UiService.showToast('Site créé et partagé en temps réel.');
      } catch (error) {
        console.error('Erreur lors de la création du site :', error);
        siteFormError.textContent = "Impossible d'enregistrer le site. Vérifiez Firestore et réessayez.";
      }
    });

    StorageService.subscribeSites(
      (sites) => {
        currentSites = sites;
        renderSites();
      },
      () => {
        UiService.showToast('Synchronisation Firefox indisponible.');
      },
    );

    StorageService.subscribeItemCounts(
      (counts) => {
        itemCountsBySite = counts;
        renderSites();
      },
      () => {
        UiService.showToast('Comptage des sous-éléments indisponible.');
      },
    );
  }

  function initSiteDetailPage() {
    const params = UiService.getQueryParams();
    const siteId = params.get('siteId');
    if (!siteId) {
      UiService.navigate('index.html');
      return;
    }

    const siteTitle = requireElement('siteTitle');
    const itemList = requireElement('itemList');
    const itemCount = requireElement('itemCount');
    const itemDialog = requireElement('itemDialog');
    const itemForm = requireElement('itemForm');
    const itemNumberInput = requireElement('itemNumberInput');
    const itemFormError = requireElement('itemFormError');
    const openExportItems = requireElement('openExportItems');
    const itemSearchInput = requireElement('itemSearchInput');

    let currentSite = StorageService.getSite(siteId);
    let currentItems = [];
    let detailCountsByItem = {};
    let detailDesignationsByItem = {};
    let detailRowsByItem = {};

    siteTitle.textContent = currentSite ? currentSite.nom : 'Chargement...';

    function formatSiteExportUnit(unit) {
      const normalizedUnit = String(unit || '').trim().toLowerCase();
      if (normalizedUnit === 'pcs') {
        return 'pcs';
      }
      return normalizedUnit || 'm';
    }

    function buildSiteExportRows() {
      const itemsWithLines = currentItems.filter((item) => Number(detailCountsByItem[item.id] || 0) > 0);
      return itemsWithLines.flatMap((item) =>
        (detailRowsByItem[item.id] || []).map((detail) => ({
          out: item.numero,
          champ: detail.champ,
          code: detail.code,
          designation: detail.designation,
          qteSortie: detail.qteSortie,
          unite: formatSiteExportUnit(detail.unite),
          qtePosee: detail.qtePosee,
          qteRetour: detail.qteRetour,
          observation: detail.observation,
        })),
      );
    }

    async function exportItems() {
      if (!currentSite) {
        UiService.navigate('index.html');
        return;
      }

      let rows = buildSiteExportRows();
      if (!rows.length) {
        try {
          detailRowsByItem = await StorageService.getDetailRowsBySite(siteId);
          rows = buildSiteExportRows();
        } catch (_error) {
          // On conserve le comportement actuel: un toast utilisateur si aucune donnée exploitable.
        }
      }
      if (!rows.length) {
        UiService.showToast('Aucune donnée');
        return;
      }

      const title = `SUIVI MATERIEL . ${currentSite.nom}`;
      const workbook = buildSiteExcelContent(title, rows);
      downloadExcelFile(`${title}.xls`, 'Export Excel', workbook);
    }

    function renderItems() {
      const query = itemSearchInput.value.trim().toUpperCase();
      const filteredItems = currentItems.filter((item) => {
        if (!query) {
          return true;
        }
        const outMatches = String(item.numero || '').toUpperCase().includes(query);
        if (outMatches) {
          return true;
        }
        const itemDesignations = detailDesignationsByItem[item.id] || [];
        return itemDesignations.some((designation) => String(designation || '').toUpperCase().includes(query));
      });

      setCountText(itemCount, filteredItems.length, 'élément', 'éléments');

      if (!filteredItems.length) {
        UiService.renderEmptyState(
          itemList,
          query ? 'Aucun N° OUT Ou Article ne correspond à votre recherche.' : 'Aucun sous-élément pour cette liste.',
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
                  <span>${detailCountsByItem[item.id] || 0} Ligne${(detailCountsByItem[item.id] || 0) > 1 ? 's' : ''}</span>
                  <span>Créé le ${UiService.formatDate(item.dateCreation)}</span>
                  <small>Modifié le ${UiService.formatDate(item.dateModification)}</small>
                </div>
              </button>
              <div class="list-card__actions">
                <button class="btn-danger" type="button" data-item-delete="${item.id}">Supprimer</button>
              </div>
            </article>
          `,
        )
        .join('');

      itemList.querySelectorAll('[data-item-open]').forEach((button) => {
        button.addEventListener('click', () => {
          UiService.navigate(`page3.html?siteId=${encodeURIComponent(siteId)}&itemId=${encodeURIComponent(button.dataset.itemOpen)}`);
        });
      });

      itemList.querySelectorAll('[data-item-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          const removedSnapshot = await StorageService.removeItem(siteId, button.dataset.itemDelete);
          if (!removedSnapshot) {
            UiService.showToast('Suppression impossible.');
            return;
          }
          UiService.showUndoSnackbar('Élément supprimé.', async () => {
            const restored = await StorageService.restoreItem(removedSnapshot);
            UiService.showToast(restored ? 'Suppression annulée.' : 'Restauration impossible.');
          });
        });
      });
    }

    requireElement('openCreateItem').addEventListener('click', () => {
      itemForm.reset();
      itemFormError.textContent = '';
      itemDialog.showModal();
      itemNumberInput.focus();
    });

    itemNumberInput.addEventListener('input', () => {
      const digitsOnly = itemNumberInput.value.replace(/\D/g, '');
      if (itemNumberInput.value !== digitsOnly) {
        itemNumberInput.value = digitsOnly;
      }
    });

    if (openExportItems) {
      openExportItems.addEventListener('click', exportItems);
    }

    itemSearchInput.addEventListener('input', renderItems);

    itemForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = itemNumberInput.value.trim();
      if (!value) {
        itemFormError.textContent = 'Veuillez remplir ce champ';
        return;
      }
      if (!/^\d+$/.test(value)) {
        itemFormError.textContent = 'Veuillez saisir des chiffres uniquement.';
        return;
      }
      if (value.length < 4) {
        itemFormError.textContent = 'Veuillez saisir au moins 4 chiffres.';
        return;
      }
      const result = await StorageService.createItem(siteId, value);
      if (!result?.ok) {
        itemFormError.textContent =
          result?.reason === 'duplicate_out'
            ? 'Ce N° OUT existe déjà pour ce site.'
            : 'Veuillez saisir au moins 4 chiffres.';
        return;
      }
      itemDialog.close();
      UiService.showToast('Numéro OUT ajouté et partagé.');
    });

    StorageService.subscribeSites((sites) => {
      currentSite = sites.find((site) => site.id === siteId) || currentSite;
      if (!currentSite) {
        UiService.navigate('index.html');
        return;
      }
      siteTitle.textContent = currentSite.nom;
    });

    StorageService.subscribeItems(
      siteId,
      (items) => {
        currentItems = items;
        renderItems();
      },
      () => {
        UiService.showToast('Synchronisation Firefox indisponible.');
      },
    );

    StorageService.subscribeDetailCounts(
      siteId,
      (counts) => {
        detailCountsByItem = counts;
        renderItems();
      },
      () => {},
    );

    StorageService.subscribeDetailDesignations(
      siteId,
      (designationsByItem) => {
        detailDesignationsByItem = designationsByItem;
        renderItems();
      },
      () => {},
    );

    StorageService.subscribeDetailRows(
      siteId,
      (rowsByItem) => {
        detailRowsByItem = rowsByItem;
      },
      () => {},
    );
  }

  function initItemDetailPage() {
    const params = UiService.getQueryParams();
    const siteId = params.get('siteId');
    const itemId = params.get('itemId');
    if (!siteId || !itemId) {
      UiService.navigate('index.html');
      return;
    }

    requireElement('itemBackButton').addEventListener('click', () => {
      UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
    });

    const detailForm = requireElement('detailForm');
    const detailFormError = requireElement('detailFormError');
    const detailCount = requireElement('detailCount');
    const detailTableBody = requireElement('detailTableBody');
    const detailSearchInput = requireElement('detailSearchInput');
    const exportButton = requireElement('exportDetailsButton');
    const designationInput = requireElement('designationInput');

    let currentSite = StorageService.getSite(siteId);
    let currentItem = StorageService.getItem(siteId, itemId);
    let currentDetails = [];

    function renderTitle() {
      if (!currentSite || !currentItem) {
        requireElement('itemTitle').textContent = 'Chargement...';
        return;
      }
      requireElement('itemTitle').textContent = `${currentSite.nom} · ${currentItem.numero}`;
    }

    function getSearchQuery() {
      return detailSearchInput ? detailSearchInput.value.trim().toLowerCase() : '';
    }

    function getFilteredDetails(details) {
      const query = getSearchQuery();
      if (!query) {
        return details;
      }
      return details.filter((detail) => String(detail.designation || '').toLowerCase().includes(query));
    }

    function updateCount(filteredCount, totalCount) {
      if (filteredCount === totalCount) {
        setCountText(detailCount, totalCount, 'ligne', 'lignes');
        return;
      }
      detailCount.textContent = `${filteredCount} ligne${filteredCount > 1 ? 's' : ''} affichée${filteredCount > 1 ? 's' : ''} / ${totalCount}`;
    }

    function exportDetails() {
      if (!currentItem || !currentSite) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(currentDetails);
      if (!filteredDetails.length) {
        UiService.showToast('Aucune ligne à exporter.');
        return;
      }

      const fileName = `${currentSite.nom} · ${currentItem.numero}.xls`;
      const workbook = buildDetailExcelContent(`${currentSite.nom} · ${currentItem.numero}`, filteredDetails);
      downloadExcelFile(fileName, 'Export Excel', workbook);
    }

    function renderTable() {
      if (!currentItem) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }

      const filteredDetails = getFilteredDetails(currentDetails);
      updateCount(filteredDetails.length, currentDetails.length);

      if (!filteredDetails.length) {
        detailTableBody.innerHTML = `<tr><td colspan="11"><div class="empty-state">${currentDetails.length ? 'Aucune désignation ne correspond à votre recherche.' : 'Aucune ligne enregistrée.'}</div></td></tr>`;
        return;
      }

      detailTableBody.innerHTML = filteredDetails
        .map(
          (detail) => {
            const ecart = computeEcart(detail);
            const ecartClassName = typeof ecart === 'number' && ecart !== 0 ? ' cell-input--ecart-alert' : '';
            return `
            <tr data-detail-id="${detail.id}">
              <td><span class="field-badge">${detail.champ}</span></td>
              <td><input class="cell-input cell-input--autosize" data-field="code" value="${escapeHtml(detail.code)}" size="${Math.max(String(detail.code || '').length + 1, 10)}" /></td>
              <td><input class="cell-input cell-input--autosize cell-input--designation" data-field="designation" value="${escapeHtml(detail.designation)}" size="${Math.max(String(detail.designation || '').length + 1, 20)}" /></td>
              <td>
                <div class="qte-sortie-field">
                  <input class="cell-input" data-field="qteSortie" type="number" min="0" step="1" value="${escapeHtml(detail.qteSortie)}" />
                  <span class="meta-value meta-value--inline">${escapeHtml(detail.unite)}</span>
                </div>
              </td>
              <td><input class="cell-input" data-field="qtePosee" type="number" min="0" step="1" value="${detail.qtePosee}" /></td>
              <td><input class="cell-input" data-field="qteRetour" type="number" min="0" step="1" value="${detail.qteRetour}" /></td>
              <td><input class="cell-input${ecartClassName}" type="number" value="${ecart}" readonly aria-label="Ecart" /></td>
              <td><span class="meta-value">${UiService.formatDate(detail.dateCreation)}</span></td>
              <td><span class="meta-value">${UiService.formatDate(detail.dateModification)}</span></td>
              <td><textarea class="cell-textarea" data-field="observation">${escapeHtml(detail.observation)}</textarea></td>
              <td><button class="btn-danger" type="button" data-detail-delete="${detail.id}">Supprimer</button></td>
            </tr>
          `;
          },
        )
        .join('');

      detailTableBody.querySelectorAll('[data-field]').forEach((field) => {
        field.addEventListener('change', async (event) => {
          const row = event.target.closest('tr');
          const fieldName = event.target.dataset.field;
          const currentDetail = currentDetails.find((detail) => detail.id === row.dataset.detailId);

          if (!currentDetail) {
            return;
          }

          const nextValue = event.target.value;
          if (String(currentDetail[fieldName] ?? '') === String(nextValue ?? '')) {
            return;
          }

          await StorageService.updateDetail(siteId, itemId, row.dataset.detailId, {
            [fieldName]: nextValue,
          });
        });
      });

      detailTableBody.querySelectorAll('[data-detail-delete]').forEach((button) => {
        button.addEventListener('click', async () => {
          const removed = await StorageService.removeDetail(siteId, itemId, button.dataset.detailDelete);
          UiService.showToast(removed ? 'Ligne supprimée.' : 'Suppression impossible.');
        });
      });
    }

    detailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      detailFormError.textContent = '';
      if (!designationInput.value.trim()) {
        detailFormError.textContent = 'Veuillez remplir la désignation.';
        return;
      }
      const result = await StorageService.createDetail(siteId, itemId, {
        code: requireElement('codeInput').value,
        designation: designationInput.value,
        qteSortie: requireElement('qteSortieInput').value,
        unite: requireElement('uniteInput').value,
      });
      if (!result?.ok) {
        detailFormError.textContent =
          result?.reason === 'duplicate_designation'
            ? 'Cette désignation existe déjà pour ce N° OUT.'
            : 'Création impossible. Vérifiez la désignation.';
        return;
      }
      detailForm.reset();
      requireElement('uniteInput').value = 'm';
      UiService.showToast('Ligne ajoutée et synchronisée.');
    });

    if (detailSearchInput) {
      detailSearchInput.addEventListener('input', renderTable);
    }

    if (exportButton) {
      exportButton.addEventListener('click', exportDetails);
    }

    StorageService.subscribeSites((sites) => {
      currentSite = sites.find((site) => site.id === siteId) || currentSite;
      renderTitle();
    });

    StorageService.subscribeItems(siteId, (items) => {
      currentItem = items.find((item) => item.id === itemId) || currentItem;
      if (!currentItem) {
        UiService.navigate(`page2.html?siteId=${encodeURIComponent(siteId)}`);
        return;
      }
      renderTitle();
    });

    StorageService.subscribeDetails(
      siteId,
      itemId,
      (details) => {
        currentDetails = details;
        renderTable();
      },
      () => {
        UiService.showToast('Synchronisation Firefox indisponible.');
      },
    );

    renderTitle();
  }

  async function bootstrap() {
    UiService.bindDialogCloser();
    setupBackButtons();
    await StorageService.init();

    const page = document.body.dataset.page;
    if (page === 'home') {
      initHomePage();
    }
    if (page === 'site-detail') {
      initSiteDetailPage();
    }
    if (page === 'item-detail') {
      initItemDetailPage();
    }
  }

  bootstrap();
})();
