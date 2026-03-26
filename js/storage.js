import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
  setDoc,
  addDoc,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

(() => {
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
    firebaseReady: false,
    db: null,
    auth: null,
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
    return !!state.db;
  }

  async function ensureFirebaseAuth() {
    if (!state.auth) {
      console.warn("[Firestore] Auth module unavailable.");
      return false;
    }
    if (state.auth.currentUser) {
      return true;
    }

    try {
      await signInAnonymously(state.auth);
      console.log("[Firestore] Anonymous auth success.");
      return true;
    } catch (error) {
      console.error("Firebase anonymous sign-in failed. Continuing without auth:", error);
      return false;
    }
  }

  function queueOperation(operation) {
    state.offlineQueue.push(operation);
    persistOfflineQueue();
  }

  async function logDebugEvent(event, payload) {
    if (!state.db) {
      return;
    }
    try {
      await addDoc(collection(state.db, "debug_logs"), {
        event,
        payload: clone(payload),
        createdAt: now(),
      });
    } catch (error) {
      console.error("[Firestore] addDoc debug_logs failed:", error);
    }
  }

  async function writeOperation(operation, saveOfflineOnError) {
    console.log("[Firestore] writeOperation called:", operation);
    if (!hasFirebase() || !state.online) {
      console.warn("[Firestore] Firebase unavailable or offline. Operation queued:", {
        hasFirebase: hasFirebase(),
        online: state.online,
      });
      if (saveOfflineOnError) {
        queueOperation(operation);
      }
      return false;
    }

    try {
      await logDebugEvent("write_operation_received", { operationCount: operation.length });
      const batch = writeBatch(state.db);
      const docs = {
        page1_sites: doc(state.db, "app_data", "page1_sites"),
        page2_items: doc(state.db, "app_data", "page2_items"),
        page3_details: doc(state.db, "app_data", "page3_details"),
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
            deletesByDoc[docId][fieldPath] = deleteField();
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
        batch.set(docs[docId], payload, { merge: true });
      });

      await batch.commit();
      console.log("[Firestore] Batch write committed successfully.");
      await logDebugEvent("write_operation_success", { operationCount: operation.length });
      return true;
    } catch (error) {
      if (error && error.code === "permission-denied") {
        console.error("[Firestore] Permission denied. Check Firestore rules for write access.", error);
      }
      console.error("Firestore write failed:", error);
      await logDebugEvent("write_operation_failed", {
        operationCount: operation.length,
        message: error?.message || "Unknown error",
        code: error?.code || null,
      });
      if (saveOfflineOnError) {
        queueOperation(operation);
      }
      return false;
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

  async function ensureFirestoreDocuments() {
    console.log("[Firestore] Ensuring target documents exist in collection 'app_data'.");
    await Promise.all([
      setDoc(doc(state.db, "app_data", "page1_sites"), {}, { merge: true }),
      setDoc(doc(state.db, "app_data", "page2_items"), {}, { merge: true }),
      setDoc(doc(state.db, "app_data", "page3_details"), {}, { merge: true }),
    ]);
  }


  async function hydrateCacheFromFirestore() {
    if (state.offlineQueue.length) {
      return;
    }

    try {
      const [sitesSnapshot, itemsSnapshot, detailsSnapshot] = await Promise.all([
        getDoc(doc(state.db, "app_data", "page1_sites")),
        getDoc(doc(state.db, "app_data", "page2_items")),
        getDoc(doc(state.db, "app_data", "page3_details")),
      ]);

      state.cache.sites = sitesSnapshot.exists ? (sitesSnapshot.data() || {}) : {};
      state.cache.items = itemsSnapshot.exists ? (itemsSnapshot.data() || {}) : {};
      state.cache.details = detailsSnapshot.exists ? (detailsSnapshot.data() || {}) : {};
      notifyChange();
    } catch (error) {
      console.error("Firestore hydration failed:", error);
    }
  }

  function attachRealtimeListeners() {
    if (state.firebaseListenersAttached) {
      return;
    }

    const unsubSite = onSnapshot(doc(state.db, "app_data", "page1_sites"), (snapshot) => {
      console.log("[Firestore] Realtime update received: page1_sites");
      state.cache.sites = snapshot.exists ? (snapshot.data() || {}) : {};
      notifyChange();
    });

    const unsubItem = onSnapshot(doc(state.db, "app_data", "page2_items"), (snapshot) => {
      console.log("[Firestore] Realtime update received: page2_items");
      state.cache.items = snapshot.exists ? (snapshot.data() || {}) : {};
      notifyChange();
    });

    const unsubDetail = onSnapshot(doc(state.db, "app_data", "page3_details"), (snapshot) => {
      console.log("[Firestore] Realtime update received: page3_details");
      state.cache.details = snapshot.exists ? (snapshot.data() || {}) : {};
      notifyChange();
    });

    state.unsubscribers.push(unsubSite);
    state.unsubscribers.push(unsubItem);
    state.unsubscribers.push(unsubDetail);
    state.firebaseListenersAttached = true;
  }

  async function initFirebaseSync() {
    const config = {
      apiKey: "AIzaSyDUNQi44ZB1V5P_H3Y7sP_W9y7H0UMPtDg",
      authDomain: "album-afec9.firebaseapp.com",
      projectId: "album-afec9",
      storageBucket: "album-afec9.firebasestorage.app",
      messagingSenderId: "583008062800",
      appId: "1:583008062800:web:e68b3175e796ff2742f055",
      measurementId: "G-13696TSXV1",
    };

    if (!getApps().length) {
      console.log("[Firestore] Initializing Firebase app.");
      state.app = initializeApp(config);
    } else {
      state.app = getApps()[0];
      console.log("[Firestore] Firebase app already initialized.");
    }

    try {
      state.auth = getAuth(state.app);
      state.db = getFirestore(state.app);
      state.firebaseReady = true;
      console.log("[Firestore] Firebase initialized (v9 modular).");
      console.log("[Firestore] Firestore instance created.");

      const authenticated = await ensureFirebaseAuth();
      if (!authenticated) {
        console.warn("[Firestore] No authenticated user. Firestore rules may block writes.");
      }

      await ensureFirestoreDocuments();
      state.online = true;
      await hydrateCacheFromFirestore();
      attachRealtimeListeners();

      if (!state.networkListenersAttached) {
        window.addEventListener("online", () => {
          state.online = true;
          console.log("[Firestore] Browser online event detected.");
          initFirebaseSync();
          flushOfflineQueue();
        });

        window.addEventListener("offline", () => {
          state.online = false;
          console.warn("[Firestore] Browser offline mode detected.");
        });
        state.networkListenersAttached = true;
      }

      await flushOfflineQueue();
    } catch (error) {
      state.online = false;
      state.firebaseReady = false;
      if (error && error.code === "permission-denied") {
        console.error("[Firestore] Firestore blocked by rules. Allow authenticated writes in rules.", error);
      } else {
        console.error("[Firestore] initFirebaseSync failed:", error);
      }
    }
  }

  async function init() {
    if (state.initialized) {
      return;
    }
    state.initialized = true;
    readLocalSnapshot();
    readOfflineQueue();
    notifyChange();
    console.log("[Storage] Local cache initialized, starting Firebase sync.");
    await initFirebaseSync();
  }

  function buildSite(name) {
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
    return site;
  }

  function createSite(name) {
    const site = buildSite(name);
    if (!site) {
      return null;
    }

    state.cache.sites[site.id] = site;
    notifyChange();

    writeOperation([
      { path: `${PAGE1_PATH}/${site.id}`, value: site },
    ], true);

    return clone(site);
  }

  async function createSiteWithSyncStatus(name) {
    const site = buildSite(name);
    if (!site) {
      return null;
    }

    state.cache.sites[site.id] = site;
    notifyChange();

    let savedToFirestore = false;
    try {
      savedToFirestore = await writeOperation([
        { path: `${PAGE1_PATH}/${site.id}`, value: site },
      ], true);
      console.log("[Firestore] createSiteWithSyncStatus result:", { siteId: site.id, savedToFirestore });
    } catch (error) {
      console.error("[Firestore] Unexpected error while creating site:", error);
    }

    return {
      site: clone(site),
      savedToFirestore,
    };
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
    createSiteWithSyncStatus,
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
