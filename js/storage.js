(function () {
  const STORAGE_KEY = "suivi-materiel-data";

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

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }

  function getSites() {
    return readState();
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
    const state = readState();
    state.unshift(site);
    writeState(state);
    return site;
  }

  function removeSite(siteId) {
    const next = readState().filter((site) => site.id !== siteId);
    writeState(next);
  }

  function getSite(siteId) {
    return readState().find((site) => site.id === siteId) || null;
  }

  function createItem(siteId, numberValue) {
    const state = readState();
    const site = state.find((entry) => entry.id === siteId);
    if (!site) {
      return null;
    }
    const timestamp = now();
    const cleanNumber = sanitizeDigits(sanitizeText(numberValue, true).replace(/^OUT-/, ""));
    if (!cleanNumber) {
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
    writeState(state);
    return item;
  }

  function removeItem(siteId, itemId) {
    const state = readState();
    const site = state.find((entry) => entry.id === siteId);
    if (!site) {
      return;
    }
    site.items = site.items.filter((item) => item.id !== itemId);
    site.dateModification = now();
    writeState(state);
  }

  function getItem(siteId, itemId) {
    const site = getSite(siteId);
    if (!site) {
      return null;
    }
    return site.items.find((item) => item.id === itemId) || null;
  }

  function createDetail(siteId, itemId, payload) {
    const state = readState();
    const site = state.find((entry) => entry.id === siteId);
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
    writeState(state);
    return detail;
  }

  function updateDetail(siteId, itemId, detailId, changes) {
    const state = readState();
    const site = state.find((entry) => entry.id === siteId);
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
    writeState(state);
    return detail;
  }

  function removeDetail(siteId, itemId, detailId) {
    const state = readState();
    const site = state.find((entry) => entry.id === siteId);
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
    writeState(state);
  }

  window.StorageService = {
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
  };
})();
