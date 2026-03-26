(function () {
  const STORAGE_KEY = "suivi-materiel-local-data";
  const OFFLINE_QUEUE_KEY = "suivi-materiel-offline-queue";
  const PAGE1_PATH = "pages/page1/sites";
  const PAGE2_PATH = "pages/page2/items";
  const PAGE3_PATH = "pages/page3/details";

  const state = {
    initialized: false,
    online: true,
    cache: {
      sites: {},
      items: {},
      details: {},
    },
    listeners: [],
    unsubscribers: [],
    offlineQueue: [],
    firebaseListenersAttached: false,
    networkListenersAttached: false,
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

  function sanitizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function sanitizeNumber(value) {
    if (value === "" || value === null || value === undefined) {
      return "";
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function persistLocalSnapshot() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cache));
  }

  function readLocalSnapshot() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      state.cache.sites = parsed.sites && typeof parsed.sites === "object" ? parsed.sites : {};
      state.cache.items = parsed.items && typeof parsed.items === "object" ? parsed.items : {};
      state.cache.details = parsed.details && typeof parsed.details === "object" ? parsed.details : {};
    } catch (error) {
      state.cache.sites = {};
      state.cache.items = {};
      state.cache.details = {};
    }
  }

  function persistOfflineQueue() {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(state.offlineQueue));
  }

  function readOfflineQueue() {
    try {
      const parsed = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
      state.offlineQueue = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      state.offlineQueue = [];
    }
  }

  function notifyChange() {
    persistLocalSnapshot();
    state.listeners.forEach((listener) => listener());
  }

  function onChange(listener) {
    state.listeners.push(listener);
    return function unsubscribe() {
      state.listeners = state.listeners.filter((entry) => entry !== listener);
    };
  }

  function mapSites() {
    return Object.values(state.cache.sites)
      .map((site) => ({ ...site, items: mapItems(site.id) }))
      .sort((a, b) => new Date(b.dateCreation).getTime() - new Date(a.dateCreation).getTime());
  }

  function mapItems(siteId) {
    const siteItems = state.cache.items[siteId] || {};
    return Object.values(siteItems)
      .map((item) => ({ ...item, details: mapDetails(siteId, item.id) }))
      .sort((a, b) => new Date(b.dateCreation).getTime() - new Date(a.dateCreation).getTime());
  }

  function mapDetails(siteId, itemId) {
    const itemDetails = ((state.cache.details[siteId] || {})[itemId]) || {};
    return Object.values(itemDetails)
      .sort((a, b) => Number(a.champ) - Number(b.champ));
  }

  function getSites() {
    return clone(mapSites());
  }

  function getSite(siteId) {
    const site = state.cache.sites[siteId];
    if (!site) {
      return null;
    }
    return clone({ ...site, items: mapItems(siteId) });
  }

  function getItem(siteId, itemId) {
    const item = (state.cache.items[siteId] || {})[itemId];
    if (!item) {
      return null;
    }
    return clone({ ...item, details: mapDetails(siteId, itemId) });
  }

  function hasFirebase() {
    return !!(window.firebase && window.firebase.firestore);
  }

  function hasFirebaseAuth() {
    return !!(window.firebase && window.firebase.auth);
  }

  async function ensureFirebaseAuth(firebase) {
    if (!hasFirebaseAuth()) {
      return;
    }

    if (firebase.auth().currentUser) {
      return;
    }

    try {
      await firebase.auth().signInAnonymously();
    } catch (error) {
      state.online = false;
      console.error("Firebase anonymous sign-in failed:", error);
    }
  }

  function queueOperation(operation) {
    state.offlineQueue.push(operation);
    persistOfflineQueue();
  }

  async function writeOperation(operation, saveOfflineOnError) {
    if (!hasFirebase() || !state.online) {
      if (saveOfflineOnError) {
        queueOperation(operation);
      }
      return;
    }

    try {
      const firestore = window.firebase.firestore();
      const fieldValue = window.firebase.firestore.FieldValue;
      const batch = firestore.batch();
      const docs = {
        page1_sites: firestore.collection("app_data").doc("page1_sites"),
        page2_items: firestore.collection("app_data").doc("page2_items"),
        page3_details: firestore.collection("app_data").doc("page3_details"),
      };

      const upsertsByDoc = {};
      const deletesByDoc = {};

      operation.forEach((entry) => {
        const parsed = resolveOperationTarget(entry.path);
        if (!parsed) {
          return;
        }

        const { docId, fieldPath } = parsed;
        if (entry.value === null) {
          if (!deletesByDoc[docId]) {
            deletesByDoc[docId] = {};
          }
          if (fieldPath) {
            deletesByDoc[docId][fieldPath] = fieldValue.delete();
          } else {
            deletesByDoc[docId].__clearAll = true;
          }
          return;
        }

        if (!upsertsByDoc[docId]) {
          upsertsByDoc[docId] = {};
        }
        if (fieldPath) {
          upsertsByDoc[docId][fieldPath] = clone(entry.value);
        } else {
          Object.assign(upsertsByDoc[docId], clone(entry.value));
        }
      });

      Object.entries(upsertsByDoc).forEach(([docId, payload]) => {
        batch.set(docs[docId], payload, { merge: true });
      });

      Object.entries(deletesByDoc).forEach(([docId, payload]) => {
        if (payload.__clearAll) {
          batch.set(docs[docId], {});
          return;
        }
        batch.update(docs[docId], payload);
      });

      await batch.commit();
    } catch (error) {
      if (saveOfflineOnError) {
        queueOperation(operation);
      }
    }
  }

  async function flushOfflineQueue() {
    if (!state.offlineQueue.length || !hasFirebase()) {
      return;
    }

    const pending = [...state.offlineQueue];
    state.offlineQueue = [];
    persistOfflineQueue();

    for (const operation of pending) {
      await writeOperation(operation, true);
    }
  }

  function canDelete(record) {
    return !!record;
  }

  function toPathSegments(path) {
    return String(path || "")
      .split("/")
      .map((segment) => safeTrim(segment))
      .filter(Boolean);
  }

  function resolveOperationTarget(path) {
    const segments = toPathSegments(path);
    if (segments.length < 3 || segments[0] !== "pages") {
      return null;
    }

    const pageName = segments[1];
    const dataName = segments[2];
    const tail = segments.slice(3);

    if (pageName === "page1" && dataName === "sites") {
      return { docId: "page1_sites", fieldPath: tail.join(".") };
    }
    if (pageName === "page2" && dataName === "items") {
      return { docId: "page2_items", fieldPath: tail.join(".") };
    }
    if (pageName === "page3" && dataName === "details") {
      return { docId: "page3_details", fieldPath: tail.join(".") };
    }
    return null;
  }

  async function ensureFirestoreDocuments(firestore) {
    await Promise.all([
      firestore.collection("app_data").doc("page1_sites").set({}, { merge: true }),
      firestore.collection("app_data").doc("page2_items").set({}, { merge: true }),
      firestore.collection("app_data").doc("page3_details").set({}, { merge: true }),
    ]);
  }

  function attachRealtimeListeners(firestore) {
    if (state.firebaseListenersAttached) {
      return;
    }

    const unsubSite = firestore.collection("app_data").doc("page1_sites").onSnapshot((snapshot) => {
      state.cache.sites = snapshot.exists ? (snapshot.data() || {}) : {};
      notifyChange();
    });

    const unsubItem = firestore.collection("app_data").doc("page2_items").onSnapshot((snapshot) => {
      state.cache.items = snapshot.exists ? (snapshot.data() || {}) : {};
      notifyChange();
    });

    const unsubDetail = firestore.collection("app_data").doc("page3_details").onSnapshot((snapshot) => {
      state.cache.details = snapshot.exists ? (snapshot.data() || {}) : {};
      notifyChange();
    });

    state.unsubscribers.push(unsubSite);
    state.unsubscribers.push(unsubItem);
    state.unsubscribers.push(unsubDetail);
    state.firebaseListenersAttached = true;
  }

  async function initFirebaseSync() {
    if (!hasFirebase()) {
      state.online = false;
      return;
    }

    const firebase = window.firebase;
    const config = {
      apiKey: "AIzaSyDUNQi44ZB1V5P_H3Y7sP_W9y7H0UMPtDg",
      authDomain: "album-afec9.firebaseapp.com",
      projectId: "album-afec9",
      storageBucket: "album-afec9.firebasestorage.app",
      messagingSenderId: "583008062800",
      appId: "1:583008062800:web:e68b3175e796ff2742f055",
      measurementId: "G-13696TSXV1",
    };

    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }

    await ensureFirebaseAuth(firebase);
    if (hasFirebaseAuth() && !firebase.auth().currentUser) {
      return;
    }
    const firestore = firebase.firestore();
    await ensureFirestoreDocuments(firestore);
    state.online = true;
    attachRealtimeListeners(firestore);

    if (!state.networkListenersAttached) {
      window.addEventListener("online", () => {
        state.online = true;
        initFirebaseSync();
        flushOfflineQueue();
      });

      window.addEventListener("offline", () => {
        state.online = false;
      });
      state.networkListenersAttached = true;
    }

    await flushOfflineQueue();
  }

  async function init() {
    if (state.initialized) {
      return;
    }
    state.initialized = true;
    readLocalSnapshot();
    readOfflineQueue();
    notifyChange();
    await initFirebaseSync();
  }

  function createSite(name) {
    const siteName = sanitizeText(name, true);
    if (!siteName) {
      return null;
    }

    const timestamp = now();
    const siteId = uid();
    const site = {
      id: siteId,
      nom: siteName,
      dateCreation: timestamp,
      dateModification: timestamp,
    };

    state.cache.sites[siteId] = site;
    notifyChange();

    writeOperation([
      { path: `${PAGE1_PATH}/${siteId}`, value: site },
    ], true);

    return clone(site);
  }

  function removeSite(siteId) {
    const site = state.cache.sites[siteId];
    if (!canDelete(site)) {
      return false;
    }

    delete state.cache.sites[siteId];
    delete state.cache.items[siteId];
    delete state.cache.details[siteId];
    notifyChange();

    writeOperation([
      { path: `${PAGE1_PATH}/${siteId}`, value: null },
      { path: `${PAGE2_PATH}/${siteId}`, value: null },
      { path: `${PAGE3_PATH}/${siteId}`, value: null },
    ], true);

    return true;
  }

  function createItem(siteId, numberValue) {
    const site = state.cache.sites[siteId];
    if (!site) {
      return null;
    }

    const cleanNumber = sanitizeDigits(sanitizeText(numberValue, true).replace(/^OUT-/, ""));
    if (cleanNumber.length < 4) {
      return null;
    }

    const timestamp = now();
    const itemId = uid();
    const item = {
      id: itemId,
      numero: `OUT-${cleanNumber}`,
      dateCreation: timestamp,
      dateModification: timestamp,
    };

    if (!state.cache.items[siteId]) {
      state.cache.items[siteId] = {};
    }
    state.cache.items[siteId][itemId] = item;
    state.cache.sites[siteId].dateModification = timestamp;
    notifyChange();

    writeOperation([
      { path: `${PAGE2_PATH}/${siteId}/${itemId}`, value: item },
      { path: `${PAGE1_PATH}/${siteId}/dateModification`, value: timestamp },
    ], true);

    return clone(item);
  }

  function removeItem(siteId, itemId) {
    const item = ((state.cache.items[siteId] || {})[itemId]);
    if (!canDelete(item)) {
      return false;
    }

    if (state.cache.items[siteId]) {
      delete state.cache.items[siteId][itemId];
    }
    if (state.cache.details[siteId]) {
      delete state.cache.details[siteId][itemId];
    }
    const timestamp = now();
    if (state.cache.sites[siteId]) {
      state.cache.sites[siteId].dateModification = timestamp;
    }
    notifyChange();

    writeOperation([
      { path: `${PAGE2_PATH}/${siteId}/${itemId}`, value: null },
      { path: `${PAGE3_PATH}/${siteId}/${itemId}`, value: null },
      { path: `${PAGE1_PATH}/${siteId}/dateModification`, value: timestamp },
    ], true);

    return true;
  }

  function createDetail(siteId, itemId, payload) {
    const item = ((state.cache.items[siteId] || {})[itemId]);
    if (!item) {
      return null;
    }

    const timestamp = now();
    const details = ((state.cache.details[siteId] || {})[itemId]) || {};
    const detailId = uid();
    const detail = {
      id: detailId,
      champ: Object.keys(details).length + 1,
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

    if (!state.cache.details[siteId]) {
      state.cache.details[siteId] = {};
    }
    if (!state.cache.details[siteId][itemId]) {
      state.cache.details[siteId][itemId] = {};
    }

    state.cache.details[siteId][itemId][detailId] = detail;
    if (state.cache.items[siteId] && state.cache.items[siteId][itemId]) {
      state.cache.items[siteId][itemId].dateModification = timestamp;
    }
    if (state.cache.sites[siteId]) {
      state.cache.sites[siteId].dateModification = timestamp;
    }
    notifyChange();

    writeOperation([
      { path: `${PAGE3_PATH}/${siteId}/${itemId}/${detailId}`, value: detail },
      { path: `${PAGE2_PATH}/${siteId}/${itemId}/dateModification`, value: timestamp },
      { path: `${PAGE1_PATH}/${siteId}/dateModification`, value: timestamp },
    ], true);

    return clone(detail);
  }

  function updateDetail(siteId, itemId, detailId, changes) {
    const detail = ((((state.cache.details[siteId] || {})[itemId]) || {})[detailId]);
    if (!detail) {
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

    const timestamp = now();
    detail.dateModification = timestamp;
    if (state.cache.items[siteId] && state.cache.items[siteId][itemId]) {
      state.cache.items[siteId][itemId].dateModification = timestamp;
    }
    if (state.cache.sites[siteId]) {
      state.cache.sites[siteId].dateModification = timestamp;
    }
    notifyChange();

    writeOperation([
      { path: `${PAGE3_PATH}/${siteId}/${itemId}/${detailId}`, value: detail },
      { path: `${PAGE2_PATH}/${siteId}/${itemId}/dateModification`, value: timestamp },
      { path: `${PAGE1_PATH}/${siteId}/dateModification`, value: timestamp },
    ], true);

    return clone(detail);
  }

  function reindexDetails(siteId, itemId) {
    const detailsMap = ((state.cache.details[siteId] || {})[itemId]) || {};
    const ordered = Object.values(detailsMap).sort((a, b) => Number(a.champ) - Number(b.champ));
    ordered.forEach((detail, index) => {
      detail.champ = index + 1;
    });
    return ordered;
  }

  function removeDetail(siteId, itemId, detailId) {
    const detail = ((((state.cache.details[siteId] || {})[itemId]) || {})[detailId]);
    if (!canDelete(detail)) {
      return false;
    }

    if (state.cache.details[siteId] && state.cache.details[siteId][itemId]) {
      delete state.cache.details[siteId][itemId][detailId];
    }

    const timestamp = now();
    const ordered = reindexDetails(siteId, itemId);

    if (state.cache.items[siteId] && state.cache.items[siteId][itemId]) {
      state.cache.items[siteId][itemId].dateModification = timestamp;
    }
    if (state.cache.sites[siteId]) {
      state.cache.sites[siteId].dateModification = timestamp;
    }

    notifyChange();

    const operations = [
      { path: `${PAGE3_PATH}/${siteId}/${itemId}/${detailId}`, value: null },
      { path: `${PAGE2_PATH}/${siteId}/${itemId}/dateModification`, value: timestamp },
      { path: `${PAGE1_PATH}/${siteId}/dateModification`, value: timestamp },
    ];

    ordered.forEach((entry) => {
      operations.push({ path: `${PAGE3_PATH}/${siteId}/${itemId}/${entry.id}/champ`, value: entry.champ });
    });

    writeOperation(operations, true);
    return true;
  }

  function exportData() {
    return {
      format: "suivi-materiel-export",
      version: 2,
      exportedAt: now(),
      data: getSites(),
    };
  }

  function importData(payload) {
    const source = payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
    if (!Array.isArray(source)) {
      return false;
    }

    source.forEach((sitePayload) => {
      const createdSite = createSite(sitePayload.nom || "SANS NOM");
      if (!createdSite) {
        return;
      }
      (sitePayload.items || []).forEach((itemPayload) => {
        const itemNumber = sanitizeDigits(String(itemPayload.numero || ""));
        const createdItem = createItem(createdSite.id, itemNumber.length >= 4 ? itemNumber : "0000");
        if (!createdItem) {
          return;
        }

        (itemPayload.details || []).forEach((detailPayload) => {
          const createdDetail = createDetail(createdSite.id, createdItem.id, {
            code: detailPayload.code,
            designation: detailPayload.designation,
            qteSortie: detailPayload.qteSortie,
            unite: detailPayload.unite || "m",
          });

          if (createdDetail) {
            updateDetail(createdSite.id, createdItem.id, createdDetail.id, {
              qteRetour: detailPayload.qteRetour,
              qtePosee: detailPayload.qtePosee,
              observation: detailPayload.observation,
            });
          }
        });
      });
    });

    return true;
  }

  function canDeleteSite(siteId) {
    return canDelete(state.cache.sites[siteId]);
  }

  function canDeleteItem(siteId, itemId) {
    return canDelete(((state.cache.items[siteId] || {})[itemId]));
  }

  function canDeleteDetail(siteId, itemId, detailId) {
    return canDelete(((((state.cache.details[siteId] || {})[itemId]) || {})[detailId]));
  }

  window.StorageService = {
    init,
    onChange,
    getSites,
    getSite,
    getItem,
    createSite,
    removeSite,
    createItem,
    removeItem,
    createDetail,
    updateDetail,
    removeDetail,
    exportData,
    importData,
    canDeleteSite,
    canDeleteItem,
    canDeleteDetail,
  };
})();
