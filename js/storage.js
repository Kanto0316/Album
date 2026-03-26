import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

(() => {
  const state = {
    initialized: false,
    cache: {
      sites: {},
      items: {},
      details: {},
    },
    listeners: [],
    unsubscribers: [],
    db: null,
    auth: null,
    firebaseReady: false,
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
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

  function notifyChange() {
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
    return Object.values(itemDetails).sort((a, b) => Number(a.champ) - Number(b.champ));
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

  async function ensureFirebaseAuth() {
    if (!state.auth.currentUser) {
      await signInAnonymously(state.auth);
      console.log("[Firestore] Anonymous auth success.");
    }
    return state.auth.currentUser;
  }

  async function addDebugLog(event, payload) {
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
      console.error("[Firestore] debug_logs addDoc failed:", error);
    }
  }

  function attachRealtimeListeners() {
    state.unsubscribers.forEach((unsubscribe) => unsubscribe());
    state.unsubscribers = [];

    const sitesQuery = query(collection(state.db, "sites"), orderBy("dateCreation", "desc"));
    const itemsQuery = query(collection(state.db, "items"), orderBy("dateCreation", "desc"));
    const detailsQuery = query(collection(state.db, "details"), orderBy("champ", "asc"));

    const unsubSites = onSnapshot(
      sitesQuery,
      (snapshot) => {
        const sites = {};
        snapshot.forEach((siteDoc) => {
          sites[siteDoc.id] = { id: siteDoc.id, ...siteDoc.data() };
        });
        state.cache.sites = sites;
        console.log("[Firestore] onSnapshot sites updated:", snapshot.size);
        notifyChange();
      },
      (error) => {
        console.error("[Firestore] onSnapshot sites failed:", error);
      },
    );

    const unsubItems = onSnapshot(
      itemsQuery,
      (snapshot) => {
        const grouped = {};
        snapshot.forEach((itemDoc) => {
          const entry = { id: itemDoc.id, ...itemDoc.data() };
          if (!grouped[entry.siteId]) {
            grouped[entry.siteId] = {};
          }
          grouped[entry.siteId][itemDoc.id] = entry;
        });
        state.cache.items = grouped;
        console.log("[Firestore] onSnapshot items updated:", snapshot.size);
        notifyChange();
      },
      (error) => {
        console.error("[Firestore] onSnapshot items failed:", error);
      },
    );

    const unsubDetails = onSnapshot(
      detailsQuery,
      (snapshot) => {
        const grouped = {};
        snapshot.forEach((detailDoc) => {
          const entry = { id: detailDoc.id, ...detailDoc.data() };
          if (!grouped[entry.siteId]) {
            grouped[entry.siteId] = {};
          }
          if (!grouped[entry.siteId][entry.itemId]) {
            grouped[entry.siteId][entry.itemId] = {};
          }
          grouped[entry.siteId][entry.itemId][detailDoc.id] = entry;
        });
        state.cache.details = grouped;
        console.log("[Firestore] onSnapshot details updated:", snapshot.size);
        notifyChange();
      },
      (error) => {
        console.error("[Firestore] onSnapshot details failed:", error);
      },
    );

    state.unsubscribers.push(unsubSites, unsubItems, unsubDetails);
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
      initializeApp(config);
      console.log("[Firestore] Firebase app initialized.");
    }

    state.auth = getAuth();
    state.db = getFirestore();

    await ensureFirebaseAuth();
    state.firebaseReady = true;
    attachRealtimeListeners();
    console.log("[Firestore] Realtime sync ready (Firestore only).");
  }

  async function init() {
    if (state.initialized) {
      return;
    }
    state.initialized = true;

    try {
      await initFirebaseSync();
    } catch (error) {
      console.error("[Firestore] init failed:", error);
      throw error;
    }
  }

  function buildSite(name) {
    const siteName = sanitizeText(name, true);
    if (!siteName) {
      return null;
    }

    const timestamp = now();
    return {
      nom: siteName,
      dateCreation: timestamp,
      dateModification: timestamp,
      ownerId: state.auth?.currentUser?.uid || null,
    };
  }

  async function createSite(name) {
    const site = buildSite(name);
    if (!site || !state.db) {
      return null;
    }

    try {
      console.log("[Firestore] addDoc site payload:", site);
      await addDebugLog("create_site_attempt", site);
      const ref = await addDoc(collection(state.db, "sites"), site);
      await addDebugLog("create_site_success", { siteId: ref.id });
      return { id: ref.id, ...site };
    } catch (error) {
      console.error("[Firestore] createSite failed:", error);
      await addDebugLog("create_site_failed", { message: error?.message || "Unknown" });
      return null;
    }
  }

  async function createSiteWithSyncStatus(name) {
    const site = await createSite(name);
    return {
      site,
      savedToFirestore: !!site,
    };
  }

  async function removeSite(siteId) {
    if (!state.db || !state.cache.sites[siteId]) {
      return false;
    }

    try {
      const batch = writeBatch(state.db);
      batch.delete(doc(state.db, "sites", siteId));

      Object.values(state.cache.items[siteId] || {}).forEach((item) => {
        batch.delete(doc(state.db, "items", item.id));
      });

      const siteDetails = state.cache.details[siteId] || {};
      Object.values(siteDetails).forEach((detailByItem) => {
        Object.values(detailByItem).forEach((detail) => {
          batch.delete(doc(state.db, "details", detail.id));
        });
      });

      console.log("[Firestore] removeSite batch commit:", { siteId });
      await batch.commit();
      await addDebugLog("remove_site_success", { siteId });
      return true;
    } catch (error) {
      console.error("[Firestore] removeSite failed:", error);
      await addDebugLog("remove_site_failed", { siteId, message: error?.message || "Unknown" });
      return false;
    }
  }

  async function createItem(siteId, numberValue) {
    if (!state.db || !state.cache.sites[siteId]) {
      return null;
    }

    const cleanNumber = sanitizeDigits(sanitizeText(numberValue, true).replace(/^OUT-/, ""));
    if (cleanNumber.length < 4) {
      return null;
    }

    const timestamp = now();
    const item = {
      siteId,
      numero: `OUT-${cleanNumber}`,
      dateCreation: timestamp,
      dateModification: timestamp,
      ownerId: state.auth?.currentUser?.uid || null,
    };

    try {
      console.log("[Firestore] addDoc item payload:", item);
      const itemRef = await addDoc(collection(state.db, "items"), item);
      await updateDoc(doc(state.db, "sites", siteId), { dateModification: timestamp });
      return { id: itemRef.id, ...item };
    } catch (error) {
      console.error("[Firestore] createItem failed:", error);
      await addDebugLog("create_item_failed", { siteId, message: error?.message || "Unknown" });
      return null;
    }
  }

  async function removeItem(siteId, itemId) {
    if (!state.db || !((state.cache.items[siteId] || {})[itemId])) {
      return false;
    }

    try {
      const batch = writeBatch(state.db);
      batch.delete(doc(state.db, "items", itemId));

      Object.values((state.cache.details[siteId] || {})[itemId] || {}).forEach((detail) => {
        batch.delete(doc(state.db, "details", detail.id));
      });

      const timestamp = now();
      batch.update(doc(state.db, "sites", siteId), { dateModification: timestamp });

      console.log("[Firestore] removeItem batch commit:", { siteId, itemId });
      await batch.commit();
      return true;
    } catch (error) {
      console.error("[Firestore] removeItem failed:", error);
      await addDebugLog("remove_item_failed", { siteId, itemId, message: error?.message || "Unknown" });
      return false;
    }
  }

  async function createDetail(siteId, itemId, payload) {
    const item = ((state.cache.items[siteId] || {})[itemId]);
    if (!state.db || !item) {
      return null;
    }

    const timestamp = now();
    const details = ((state.cache.details[siteId] || {})[itemId]) || {};

    const detail = {
      siteId,
      itemId,
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
      ownerId: state.auth?.currentUser?.uid || null,
    };

    try {
      console.log("[Firestore] addDoc detail payload:", detail);
      const detailRef = await addDoc(collection(state.db, "details"), detail);
      const batch = writeBatch(state.db);
      batch.update(doc(state.db, "items", itemId), { dateModification: timestamp });
      batch.update(doc(state.db, "sites", siteId), { dateModification: timestamp });
      await batch.commit();
      return { id: detailRef.id, ...detail };
    } catch (error) {
      console.error("[Firestore] createDetail failed:", error);
      await addDebugLog("create_detail_failed", { siteId, itemId, message: error?.message || "Unknown" });
      return null;
    }
  }

  async function updateDetail(siteId, itemId, detailId, changes) {
    const detail = ((((state.cache.details[siteId] || {})[itemId]) || {})[detailId]);
    if (!state.db || !detail) {
      return null;
    }

    const next = clone(detail);
    if ("code" in changes) next.code = sanitizeText(changes.code, true);
    if ("designation" in changes) next.designation = sanitizeText(changes.designation, false);

    if ("qteSortie" in changes) {
      next.qteSortie = sanitizeNumber(changes.qteSortie);
      if (sanitizeNumber(next.qteRetour) > next.qteSortie) next.qteRetour = next.qteSortie;
      if (sanitizeNumber(next.qtePosee) > next.qteSortie) next.qtePosee = next.qteSortie;
    }
    if ("unite" in changes) next.unite = sanitizeText(changes.unite, false) || "m";
    if ("qteHorsBtrs" in changes) next.qteHorsBtrs = changes.qteHorsBtrs === "" ? "" : sanitizeNumber(changes.qteHorsBtrs);
    if ("qteRetour" in changes) {
      next.qteRetour = Math.min(sanitizeNumber(changes.qteRetour), sanitizeNumber(next.qteSortie));
      next.qtePosee = Math.max(0, sanitizeNumber(next.qteSortie) - sanitizeNumber(next.qteRetour));
    }
    if ("qtePosee" in changes) {
      next.qtePosee = Math.min(sanitizeNumber(changes.qtePosee), sanitizeNumber(next.qteSortie));
      next.qteRetour = Math.max(0, sanitizeNumber(next.qteSortie) - sanitizeNumber(next.qtePosee));
    }
    if ("observation" in changes) next.observation = sanitizeText(changes.observation, false);

    if (!("qteRetour" in changes) && !("qtePosee" in changes)) {
      next.qtePosee = Math.min(sanitizeNumber(next.qtePosee), sanitizeNumber(next.qteSortie));
      next.qteRetour = Math.max(0, sanitizeNumber(next.qteSortie) - sanitizeNumber(next.qtePosee));
    }

    const timestamp = now();
    next.dateModification = timestamp;

    try {
      console.log("[Firestore] updateDoc detail payload:", { detailId, next });
      const batch = writeBatch(state.db);
      batch.update(doc(state.db, "details", detailId), next);
      batch.update(doc(state.db, "items", itemId), { dateModification: timestamp });
      batch.update(doc(state.db, "sites", siteId), { dateModification: timestamp });
      await batch.commit();
      return next;
    } catch (error) {
      console.error("[Firestore] updateDetail failed:", error);
      await addDebugLog("update_detail_failed", { siteId, itemId, detailId, message: error?.message || "Unknown" });
      return null;
    }
  }

  async function removeDetail(siteId, itemId, detailId) {
    const detail = ((((state.cache.details[siteId] || {})[itemId]) || {})[detailId]);
    if (!state.db || !detail) {
      return false;
    }

    try {
      const batch = writeBatch(state.db);
      batch.delete(doc(state.db, "details", detailId));

      const ordered = mapDetails(siteId, itemId).filter((entry) => entry.id !== detailId);
      ordered.forEach((entry, index) => {
        batch.update(doc(state.db, "details", entry.id), { champ: index + 1 });
      });

      const timestamp = now();
      batch.update(doc(state.db, "items", itemId), { dateModification: timestamp });
      batch.update(doc(state.db, "sites", siteId), { dateModification: timestamp });
      console.log("[Firestore] removeDetail batch commit:", { siteId, itemId, detailId });
      await batch.commit();
      return true;
    } catch (error) {
      console.error("[Firestore] removeDetail failed:", error);
      await addDebugLog("remove_detail_failed", { siteId, itemId, detailId, message: error?.message || "Unknown" });
      return false;
    }
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

    source.forEach(async (sitePayload) => {
      const createdSite = await createSite(sitePayload.nom || "SANS NOM");
      if (!createdSite) return;

      for (const itemPayload of (sitePayload.items || [])) {
        const itemNumber = sanitizeDigits(String(itemPayload.numero || ""));
        const createdItem = await createItem(createdSite.id, itemNumber.length >= 4 ? itemNumber : "0000");
        if (!createdItem) continue;

        for (const detailPayload of (itemPayload.details || [])) {
          const createdDetail = await createDetail(createdSite.id, createdItem.id, {
            code: detailPayload.code,
            designation: detailPayload.designation,
            qteSortie: detailPayload.qteSortie,
            unite: detailPayload.unite || "m",
          });

          if (createdDetail) {
            await updateDetail(createdSite.id, createdItem.id, createdDetail.id, {
              qteRetour: detailPayload.qteRetour,
              qtePosee: detailPayload.qtePosee,
              observation: detailPayload.observation,
            });
          }
        }
      }
    });

    return true;
  }

  function canDelete(record) {
    if (!record) return false;
    const currentUid = state.auth?.currentUser?.uid;
    if (!record.ownerId || !currentUid) return true;
    return record.ownerId === currentUid;
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
