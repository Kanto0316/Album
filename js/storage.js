(function () {
  const STORAGE_KEY = "suivi-materiel-local-data";
  const state = {
    data: [],
    initialized: false,
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function safeTrim(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeText(value, uppercase) {
    const cleaned = safeTrim(value).replace(/[<>]/g, "");
    return uppercase ? cleaned.toUpperCase() : cleaned;
  }

  function sanitizeNumber(value) {
    if (value === "" || value === null || value === undefined) {
      return "";
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function sanitizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function now() {
    return new Date().toISOString();
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function readData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function normalizeImportedData(payload) {
    if (!Array.isArray(payload)) {
      return null;
    }

    return payload.map((site) => ({
      id: sanitizeText(site.id || uid(), false) || uid(),
      nom: sanitizeText(site.nom, true),
      dateCreation: site.dateCreation || now(),
      dateModification: site.dateModification || site.dateCreation || now(),
      items: Array.isArray(site.items)
        ? site.items.map((item) => ({
            id: sanitizeText(item.id || uid(), false) || uid(),
            numero: `OUT-${sanitizeDigits(String(item.numero || '').replace(/^OUT-/i, ''))}`,
            dateCreation: item.dateCreation || now(),
            dateModification: item.dateModification || item.dateCreation || now(),
            details: Array.isArray(item.details)
              ? item.details.map((detail, index) => ({
                  id: sanitizeText(detail.id || uid(), false) || uid(),
                  champ: sanitizeNumber(detail.champ) || index + 1,
                  code: sanitizeText(detail.code, true),
                  designation: sanitizeText(detail.designation, true),
                  qteSortie: detail.qteSortie === '' ? '' : sanitizeNumber(detail.qteSortie),
                  unite: sanitizeText(detail.unite || 'm', false) || 'm',
                  qteHorsBtrs: detail.qteHorsBtrs === '' ? '' : sanitizeNumber(detail.qteHorsBtrs),
                  qteRetour: sanitizeNumber(detail.qteRetour),
                  qtePosee: sanitizeNumber(detail.qtePosee),
                  observation: sanitizeText(detail.observation, false),
                  dateCreation: detail.dateCreation || now(),
                  dateModification: detail.dateModification || detail.dateCreation || now(),
                }))
              : [],
          }))
        : [],
    }));
  }

  async function init() {
    if (state.initialized) {
      return null;
    }
    state.initialized = true;
    state.data = readData();
    return null;
  }

  function getSites() {
    return clone(state.data);
  }

  function getSite(siteId) {
    return clone(state.data.find((site) => site.id === siteId) || null);
  }

  function createSite(name) {
    const siteName = sanitizeText(name, true);
    const timestamp = now();
    const site = {
      id: uid(),
      nom: siteName,
      dateCreation: timestamp,
      dateModification: timestamp,
      items: [],
    };
    state.data.unshift(site);
    persist();
    return clone(site);
  }

  function removeSite(siteId) {
    state.data = state.data.filter((site) => site.id !== siteId);
    persist();
  }

  function createItem(siteId, numberValue) {
    const site = state.data.find((entry) => entry.id === siteId);
    if (!site) {
      return null;
    }

    const timestamp = now();
    const cleanNumber = sanitizeDigits(sanitizeText(numberValue, true).replace(/^OUT-/, ""));
    if (cleanNumber.length < 4) {
      return null;
    }

    const item = {
      id: uid(),
      numero: `OUT-${cleanNumber}`,
      dateCreation: timestamp,
      dateModification: timestamp,
      details: [],
    };

    site.items.unshift(item);
    site.dateModification = timestamp;
    persist();
    return clone(item);
  }

  function getItem(siteId, itemId) {
    const site = state.data.find((entry) => entry.id === siteId);
    if (!site) {
      return null;
    }
    return clone(site.items.find((item) => item.id === itemId) || null);
  }

  function removeItem(siteId, itemId) {
    const site = state.data.find((entry) => entry.id === siteId);
    if (!site) {
      return;
    }
    site.items = site.items.filter((item) => item.id !== itemId);
    site.dateModification = now();
    persist();
  }

  function createDetail(siteId, itemId, payload) {
    const site = state.data.find((entry) => entry.id === siteId);
    const item = site && site.items.find((entry) => entry.id === itemId);
    if (!site || !item) {
      return null;
    }

    const timestamp = now();
    const detail = {
      id: uid(),
      champ: item.details.length + 1,
      code: sanitizeText(payload.code, true),
      designation: sanitizeText(payload.designation, true),
      qteSortie: payload.qteSortie === "" ? "" : sanitizeNumber(payload.qteSortie),
      unite: sanitizeText(payload.unite || "m", false) || "m",
      qteHorsBtrs: "",
      qteRetour: 0,
      qtePosee: 0,
      observation: "",
      dateCreation: timestamp,
      dateModification: timestamp,
    };

    item.details.push(detail);
    item.dateModification = timestamp;
    site.dateModification = timestamp;
    persist();
    return clone(detail);
  }

  function updateDetail(siteId, itemId, detailId, changes) {
    const site = state.data.find((entry) => entry.id === siteId);
    const item = site && site.items.find((entry) => entry.id === itemId);
    const detail = item && item.details.find((entry) => entry.id === detailId);
    if (!site || !item || !detail) {
      return null;
    }

    if ("code" in changes) {
      detail.code = sanitizeText(changes.code, true);
    }
    if ("designation" in changes) {
      detail.designation = sanitizeText(changes.designation, false);
    }
    if ("qteSortie" in changes) {
      detail.qteSortie = sanitizeNumber(changes.qteSortie);
      if (sanitizeNumber(detail.qteRetour) > detail.qteSortie) {
        detail.qteRetour = detail.qteSortie;
      }
      if (sanitizeNumber(detail.qtePosee) > detail.qteSortie) {
        detail.qtePosee = detail.qteSortie;
      }
    }
    if ("unite" in changes) {
      detail.unite = sanitizeText(changes.unite, false) || "m";
    }
    if ("qteHorsBtrs" in changes) {
      detail.qteHorsBtrs = changes.qteHorsBtrs === "" ? "" : sanitizeNumber(changes.qteHorsBtrs);
    }
    if ("qteRetour" in changes) {
      detail.qteRetour = Math.min(sanitizeNumber(changes.qteRetour), sanitizeNumber(detail.qteSortie));
      detail.qtePosee = Math.max(0, sanitizeNumber(detail.qteSortie) - sanitizeNumber(detail.qteRetour));
    }
    if ("qtePosee" in changes) {
      detail.qtePosee = Math.min(sanitizeNumber(changes.qtePosee), sanitizeNumber(detail.qteSortie));
      detail.qteRetour = Math.max(0, sanitizeNumber(detail.qteSortie) - sanitizeNumber(detail.qtePosee));
    }
    if ("observation" in changes) {
      detail.observation = sanitizeText(changes.observation, false);
    }

    if (!("qteRetour" in changes) && !("qtePosee" in changes)) {
      detail.qtePosee = Math.min(sanitizeNumber(detail.qtePosee), sanitizeNumber(detail.qteSortie));
      detail.qteRetour = Math.max(0, sanitizeNumber(detail.qteSortie) - sanitizeNumber(detail.qtePosee));
    }

    detail.dateModification = now();
    item.dateModification = detail.dateModification;
    site.dateModification = detail.dateModification;
    persist();
    return clone(detail);
  }

  function removeDetail(siteId, itemId, detailId) {
    const site = state.data.find((entry) => entry.id === siteId);
    const item = site && site.items.find((entry) => entry.id === itemId);
    if (!site || !item) {
      return;
    }

    item.details = item.details
      .filter((detail) => detail.id !== detailId)
      .map((detail, index) => ({ ...detail, champ: index + 1 }));

    const timestamp = now();
    item.dateModification = timestamp;
    site.dateModification = timestamp;
    persist();
  }

  function exportData() {
    return {
      format: 'suivi-materiel-export',
      version: 1,
      exportedAt: now(),
      data: clone(state.data),
    };
  }

  function importData(payload) {
    const source = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
    const normalized = normalizeImportedData(source);
    if (!normalized) {
      return false;
    }

    state.data = normalized;
    persist();
    return true;
  }

  window.StorageService = {
    init,
    getSites,
    getSite,
    createSite,
    removeSite,
    createItem,
    getItem,
    removeItem,
    createDetail,
    updateDetail,
    removeDetail,
    exportData,
    importData,
  };
})();
