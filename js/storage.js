(function () {
  const LOCAL_CACHE_PREFIX = "suivi-materiel-cache";
  const SESSION_KEY = "suivi-materiel-session";
  const LAST_USER_KEY = "suivi-materiel-last-user";
  const PENDING_KEY = "suivi-materiel-pending-write";
  const PENDING_OWNERS_KEY = "suivi-materiel-pending-owners";
  const CONNECTION_KEY = "suivi-materiel-connection";
  const MAX_NAME_LENGTH = 24;
  const INACTIVITY_MS = 1000 * 60 * 60 * 24 * 90;
  const ADMIN_NAME = "ADMIN";
  const RESERVED_NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,23}$/;
  const firebaseConfig = {
    apiKey: "AIzaSyDUNQi44ZB1V5P_H3Y7sP_W9v7H0UMPtDg",
    authDomain: "album-afec9.firebaseapp.com",
    projectId: "album-afec9",
    storageBucket: "album-afec9.firebasestorage.app",
    messagingSenderId: "583008062800",
    appId: "1:583008062800:web:e68b3175e796ff2742f055",
    measurementId: "G-13696TSXV1",
    databaseURL: "https://album-afec9-default-rtdb.firebaseio.com",
  };

  const state = {
    firebaseReady: false,
    database: null,
    currentUser: null,
    data: [],
    allUsers: {},
    listeners: [],
    syncListeners: [],
    pendingWrite: false,
    pendingOwners: [],
    initialized: false,
    isConnected: navigator.onLine,
    activePageOnlineRequired: false,
  };

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

  function toUserKey(name) {
    return sanitizeText(name, true)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_NAME_LENGTH);
  }

  function getCacheKey(userKey) {
    return `${LOCAL_CACHE_PREFIX}:${userKey}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function initializeFirebase() {
    if (state.firebaseReady) {
      return true;
    }
    if (!window.firebase || !window.firebase.apps) {
      return false;
    }
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }
    state.database = window.firebase.database();
    state.firebaseReady = true;
    return true;
  }

  function emitSyncStatus() {
    const status = {
      isOnline: navigator.onLine,
      isConnected: state.isConnected,
      hasPendingWrite: state.pendingWrite,
      currentUser: state.currentUser ? clone(state.currentUser) : null,
    };
    state.syncListeners.forEach((listener) => listener(status));
  }

  function onSyncStatusChange(listener) {
    state.syncListeners.push(listener);
    listener({
      isOnline: navigator.onLine,
      isConnected: state.isConnected,
      hasPendingWrite: state.pendingWrite,
      currentUser: state.currentUser ? clone(state.currentUser) : null,
    });
    return function unsubscribe() {
      state.syncListeners = state.syncListeners.filter((entry) => entry !== listener);
    };
  }

  function persistPendingOwners() {
    writeJson(PENDING_OWNERS_KEY, state.pendingOwners);
    state.pendingWrite = state.pendingOwners.length > 0;
    localStorage.setItem(PENDING_KEY, state.pendingWrite ? "1" : "0");
    emitSyncStatus();
  }

  function setPendingWrite(value) {
    state.pendingWrite = Boolean(value);
    if (!state.pendingWrite) {
      state.pendingOwners = [];
      localStorage.removeItem(PENDING_OWNERS_KEY);
      localStorage.setItem(PENDING_KEY, "0");
      emitSyncStatus();
      return;
    }
    persistPendingOwners();
  }

  function enqueuePendingOwner(ownerKey) {
    if (!ownerKey || state.pendingOwners.includes(ownerKey)) {
      persistPendingOwners();
      return;
    }
    state.pendingOwners.push(ownerKey);
    persistPendingOwners();
  }

  function dequeuePendingOwner(ownerKey) {
    state.pendingOwners = state.pendingOwners.filter((entry) => entry !== ownerKey);
    persistPendingOwners();
  }

  async function flushPendingOwners() {
    if (!state.currentUser || !state.firebaseReady || !navigator.onLine) {
      return;
    }
    for (const ownerKey of [...state.pendingOwners]) {
      await flushOwnerState(ownerKey);
    }
  }

  function setConnectionState(isConnected) {
    state.isConnected = Boolean(isConnected);
    localStorage.setItem(CONNECTION_KEY, state.isConnected ? "1" : "0");
    emitSyncStatus();
  }

  function loadSession() {
    return readJson(SESSION_KEY, null);
  }

  function saveSession(session) {
    writeJson(SESSION_KEY, session);
    localStorage.setItem(LAST_USER_KEY, session.displayName);
    state.currentUser = session;
    emitSyncStatus();
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PENDING_OWNERS_KEY);
    localStorage.removeItem(PENDING_KEY);
    state.currentUser = null;
    state.data = [];
    state.allUsers = {};
    state.pendingOwners = [];
    state.pendingWrite = false;
    detachListeners();
    emitSyncStatus();
  }

  function detachListeners() {
    state.listeners.forEach((unsubscribe) => unsubscribe());
    state.listeners = [];
  }

  function readLocalData(userKey) {
    return readJson(getCacheKey(userKey), []);
  }

  function writeLocalData(userKey, value) {
    writeJson(getCacheKey(userKey), value);
  }

  function validateUserName(name) {
    const cleaned = safeTrim(name);
    if (!cleaned) {
      return "Veuillez saisir votre nom.";
    }
    if (cleaned.length > MAX_NAME_LENGTH) {
      return `Le nom ne doit pas dépasser ${MAX_NAME_LENGTH} caractères.`;
    }
    if (!RESERVED_NAME_PATTERN.test(cleaned)) {
      return "Utilisez uniquement des lettres, espaces, apostrophes ou tirets.";
    }
    return "";
  }

  function getUserMetaPath(userKey) {
    return `profiles/${userKey}`;
  }

  function getUserDataPath(userKey) {
    return `userData/${userKey}`;
  }

  function getUsernameReservationPath(userKey) {
    return `usernames/${userKey}`;
  }

  function touchCurrentUserActivity() {
    if (!state.currentUser) {
      return Promise.resolve();
    }
    const currentTimestamp = now();
    state.currentUser.lastActivity = currentTimestamp;
    saveSession(state.currentUser);
    if (!state.firebaseReady || !navigator.onLine) {
      return Promise.resolve();
    }
    const updates = {};
    updates[`${getUserMetaPath(state.currentUser.userKey)}/lastActivity`] = currentTimestamp;
    updates[`${getUserDataPath(state.currentUser.userKey)}/lastActivity`] = currentTimestamp;
    return state.database.ref().update(updates);
  }

  async function cleanupInactiveUsers() {
    if (!state.firebaseReady || !navigator.onLine) {
      return;
    }
    const snapshot = await state.database.ref("profiles").once("value");
    const profiles = snapshot.val() || {};
    const cutoff = Date.now() - INACTIVITY_MS;
    const deletions = {};
    Object.entries(profiles).forEach(([userKey, profile]) => {
      if (userKey === ADMIN_NAME || profile?.normalizedName === ADMIN_NAME) {
        return;
      }
      const lastActivity = profile?.lastActivity ? new Date(profile.lastActivity).getTime() : 0;
      if (lastActivity && lastActivity < cutoff) {
        deletions[getUserMetaPath(userKey)] = null;
        deletions[getUserDataPath(userKey)] = null;
        deletions[getUsernameReservationPath(userKey)] = null;
        localStorage.removeItem(getCacheKey(userKey));
      }
    });
    if (Object.keys(deletions).length) {
      await state.database.ref().update(deletions);
    }
  }

  function normalizeUserSnapshot(userKey, payload) {
    const sites = Array.isArray(payload?.sites) ? payload.sites : [];
    return sites.map((site) => ({ ...site, ownerKey: userKey }));
  }

  function encodeScopedId(ownerKey, entityId) {
    return `${ownerKey}::${entityId}`;
  }

  function decodeScopedSiteId(siteId) {
    if (!state.currentUser?.isAdmin) {
      return { ownerKey: state.currentUser?.userKey || "", siteId };
    }
    const parts = String(siteId || "").split("::");
    if (parts.length >= 2) {
      return { ownerKey: parts[0], siteId: parts.slice(1).join("::") };
    }
    return { ownerKey: state.currentUser.userKey, siteId };
  }

  function getCurrentSitesRaw() {
    if (!state.currentUser) {
      return [];
    }
    if (!state.currentUser.isAdmin) {
      return clone(state.data);
    }
    return Object.entries(state.allUsers)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, "fr"))
      .flatMap(([ownerKey, payload]) => {
        const displayName = payload?.profile?.displayName || ownerKey;
        const sites = Array.isArray(payload?.sites) ? payload.sites : [];
        return sites.map((site) => ({
          ...site,
          id: encodeScopedId(ownerKey, site.id),
          ownerKey,
          ownerName: displayName,
        }));
      });
  }

  function persistCurrentStateSilently() {
    if (!state.currentUser) {
      return;
    }
    if (state.currentUser.isAdmin) {
      writeLocalData(state.currentUser.userKey, state.allUsers);
    } else {
      writeLocalData(state.currentUser.userKey, state.data);
    }
  }

  async function flushOwnerState(ownerKey) {
    if (!state.firebaseReady || !navigator.onLine) {
      enqueuePendingOwner(ownerKey);
      return;
    }
    const activeUser = state.currentUser;
    if (!activeUser) {
      return;
    }
    const ownerSites = activeUser.isAdmin ? clone(state.allUsers[ownerKey]?.sites || []) : clone(state.data);
    const ownerProfile = activeUser.isAdmin
      ? clone(state.allUsers[ownerKey]?.profile || { displayName: ownerKey, normalizedName: ownerKey })
      : { displayName: activeUser.displayName, normalizedName: activeUser.normalizedName };
    const timestamp = now();
    enqueuePendingOwner(ownerKey);
    await state.database.ref(getUserDataPath(ownerKey)).set({
      sites: ownerSites,
      updatedAt: timestamp,
      lastActivity: timestamp,
    });
    await state.database.ref(getUserMetaPath(ownerKey)).update({
      displayName: ownerProfile.displayName || ownerKey,
      normalizedName: ownerProfile.normalizedName || ownerKey,
      lastActivity: timestamp,
      updatedAt: timestamp,
    });
    if (activeUser.userKey === ownerKey) {
      activeUser.lastActivity = timestamp;
      saveSession(activeUser);
    }
    dequeuePendingOwner(ownerKey);
  }

  function scheduleFlush(ownerKey) {
    persistCurrentStateSilently();
    if (!state.currentUser) {
      return Promise.resolve();
    }
    const nextOwnerKey = ownerKey || state.currentUser.userKey;
    state.currentUser.lastActivity = now();
    saveSession(state.currentUser);
    touchCurrentUserActivity().catch(() => {});
    enqueuePendingOwner(nextOwnerKey);
    return flushOwnerState(nextOwnerKey).catch(() => {
      enqueuePendingOwner(nextOwnerKey);
    });
  }

  function syncOfflineCacheToAdminShape(cachedValue) {
    if (!cachedValue || typeof cachedValue !== "object" || Array.isArray(cachedValue)) {
      return {};
    }
    return cachedValue;
  }

  function attachUserListener() {
    if (!state.firebaseReady || !state.currentUser) {
      return;
    }
    detachListeners();

    const connectedRef = state.database.ref(".info/connected");
    const connectedHandler = connectedRef.on("value", (snapshot) => {
      setConnectionState(Boolean(snapshot.val()));
      if (snapshot.val() && state.pendingWrite) {
        flushPendingOwners().catch(() => {
          persistPendingOwners();
        });
      }
    });
    state.listeners.push(() => connectedRef.off("value", connectedHandler));

    if (state.currentUser.isAdmin) {
      const adminRef = state.database.ref();
      const adminHandler = adminRef.on("value", (snapshot) => {
        const value = snapshot.val() || {};
        const profiles = value.profiles || {};
        const userData = value.userData || {};
        const nextUsers = {};
        Object.keys(userData).forEach((userKey) => {
          nextUsers[userKey] = {
            profile: profiles[userKey] || { displayName: userKey },
            sites: normalizeUserSnapshot(userKey, userData[userKey]),
          };
        });
        if (!nextUsers[ADMIN_NAME]) {
          nextUsers[ADMIN_NAME] = {
            profile: profiles[ADMIN_NAME] || { displayName: "Admin" },
            sites: [],
          };
        }
        state.allUsers = nextUsers;
        persistCurrentStateSilently();
      });
      state.listeners.push(() => adminRef.off("value", adminHandler));
      return;
    }

    const dataRef = state.database.ref(getUserDataPath(state.currentUser.userKey));
    const dataHandler = dataRef.on("value", (snapshot) => {
      const remoteData = snapshot.val();
      if (!state.pendingWrite) {
        state.data = Array.isArray(remoteData?.sites) ? remoteData.sites : [];
        writeLocalData(state.currentUser.userKey, state.data);
      }
    });
    state.listeners.push(() => dataRef.off("value", dataHandler));
  }

  async function registerUser(name) {
    const validationError = validateUserName(name);
    if (validationError) {
      return { ok: false, message: validationError };
    }
    if (!navigator.onLine) {
      return { ok: false, message: "Une connexion Internet est nécessaire pour se connecter à Firebase." };
    }
    if (!initializeFirebase()) {
      return { ok: false, message: "Firebase n'est pas disponible dans cette page." };
    }

    await cleanupInactiveUsers();

    const displayName = safeTrim(name);
    const normalizedName = sanitizeText(displayName, true);
    const userKey = toUserKey(displayName);
    const isAdmin = normalizedName === ADMIN_NAME;
    const usernameRef = state.database.ref(getUsernameReservationPath(userKey));

    const existingSnapshot = await usernameRef.once("value");
    const existingValue = existingSnapshot.val();
    if (existingValue) {
      if (isAdmin && existingValue.normalizedName === ADMIN_NAME) {
        // Accès administrateur autorisé.
      } else {
        return { ok: false, message: "Ce nom existe déjà dans Firebase." };
      }
    } else {
      await usernameRef.set({
        displayName,
        normalizedName,
        reservedAt: now(),
        userKey,
        isAdmin,
      });
    }

    const timestamp = now();
    const session = {
      displayName,
      normalizedName,
      userKey,
      isAdmin,
      lastActivity: timestamp,
    };

    await state.database.ref(getUserMetaPath(userKey)).update({
      displayName,
      normalizedName,
      userKey,
      isAdmin,
      createdAt: existingValue?.reservedAt || timestamp,
      updatedAt: timestamp,
      lastActivity: timestamp,
    });

    if (!isAdmin) {
      const remoteSnapshot = await state.database.ref(getUserDataPath(userKey)).once("value");
      const remoteValue = remoteSnapshot.val();
      const cachedValue = readLocalData(userKey);
      state.data = Array.isArray(remoteValue?.sites) ? remoteValue.sites : Array.isArray(cachedValue) ? cachedValue : [];
      writeLocalData(userKey, state.data);
    } else {
      state.allUsers = syncOfflineCacheToAdminShape(readLocalData(userKey));
    }

    saveSession(session);
    attachUserListener();
    emitSyncStatus();
    return { ok: true, user: clone(session) };
  }

  async function init() {
    if (state.initialized) {
      return state.currentUser;
    }
    state.initialized = true;
    state.pendingOwners = readJson(PENDING_OWNERS_KEY, []);
    state.pendingWrite = state.pendingOwners.length > 0 || localStorage.getItem(PENDING_KEY) === "1";
    state.isConnected = localStorage.getItem(CONNECTION_KEY) !== "0";
    initializeFirebase();

    window.addEventListener("online", () => {
      emitSyncStatus();
      if (state.currentUser) {
        attachUserListener();
        if (state.pendingWrite) {
          flushPendingOwners().catch(() => {
            persistPendingOwners();
          });
        }
      }
    });

    window.addEventListener("offline", () => {
      emitSyncStatus();
    });

    const session = loadSession();
    if (!session) {
      return null;
    }

    state.currentUser = session;
    if (session.isAdmin) {
      state.allUsers = syncOfflineCacheToAdminShape(readLocalData(session.userKey));
    } else {
      state.data = readLocalData(session.userKey);
    }

    if (navigator.onLine && state.firebaseReady) {
      await cleanupInactiveUsers().catch(() => {});
      attachUserListener();
      await touchCurrentUserActivity().catch(() => {});
    }
    emitSyncStatus();
    return clone(state.currentUser);
  }

  function getCurrentUser() {
    return state.currentUser ? clone(state.currentUser) : null;
  }

  function isAdminSession() {
    return Boolean(state.currentUser?.isAdmin);
  }

  function getSites() {
    return getCurrentSitesRaw();
  }

  function getSite(siteId) {
    const { ownerKey, siteId: rawSiteId } = decodeScopedSiteId(siteId);
    if (!state.currentUser) {
      return null;
    }
    if (!state.currentUser.isAdmin) {
      return clone(state.data.find((site) => site.id === rawSiteId) || null);
    }
    const ownerData = state.allUsers[ownerKey];
    if (!ownerData) {
      return null;
    }
    const site = (ownerData.sites || []).find((entry) => entry.id === rawSiteId);
    return site
      ? clone({
          ...site,
          id: encodeScopedId(ownerKey, site.id),
          ownerKey,
          ownerName: ownerData.profile?.displayName || ownerKey,
        })
      : null;
  }

  function updateLocalOwnerSites(ownerKey, nextSites) {
    if (!state.currentUser) {
      return;
    }
    if (!state.currentUser.isAdmin && ownerKey === state.currentUser.userKey) {
      state.data = nextSites;
      return;
    }
    state.allUsers[ownerKey] = state.allUsers[ownerKey] || {
      profile: { displayName: ownerKey },
      sites: [],
    };
    state.allUsers[ownerKey].sites = nextSites;
  }

  function getItem(siteId, itemId) {
    const site = getSite(siteId);
    if (!site) {
      return null;
    }
    return clone(site.items.find((item) => item.id === itemId) || null);
  }

  function createSite(name) {
    const currentUser = state.currentUser;
    if (!currentUser) {
      return null;
    }
    const siteName = sanitizeText(name, true);
    const timestamp = now();
    const site = {
      id: uid(),
      nom: siteName,
      dateCreation: timestamp,
      dateModification: timestamp,
      items: [],
    };
    if (currentUser.isAdmin) {
      const adminSites = Array.isArray(state.allUsers[currentUser.userKey]?.sites)
        ? clone(state.allUsers[currentUser.userKey].sites)
        : [];
      adminSites.unshift(site);
      updateLocalOwnerSites(currentUser.userKey, adminSites);
    } else {
      state.data.unshift(site);
    }
    touchCurrentUserActivity().catch(() => {});
    persistCurrentStateSilently();
    scheduleFlush(currentUser.userKey);
    return currentUser.isAdmin ? getSite(encodeScopedId(currentUser.userKey, site.id)) : clone(site);
  }

  function removeSite(siteId) {
    const { ownerKey, siteId: rawSiteId } = decodeScopedSiteId(siteId);
    const existingSites = state.currentUser?.isAdmin
      ? clone(state.allUsers[ownerKey]?.sites || [])
      : clone(state.data);
    const next = existingSites.filter((site) => site.id !== rawSiteId);
    updateLocalOwnerSites(ownerKey, next);
    persistCurrentStateSilently();
    scheduleFlush(ownerKey);
  }

  function createItem(siteId, numberValue) {
    const { ownerKey, siteId: rawSiteId } = decodeScopedSiteId(siteId);
    const sites = state.currentUser?.isAdmin ? clone(state.allUsers[ownerKey]?.sites || []) : clone(state.data);
    const site = sites.find((entry) => entry.id === rawSiteId);
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
    updateLocalOwnerSites(ownerKey, sites);
    persistCurrentStateSilently();
    scheduleFlush(ownerKey);
    return clone(item);
  }

  function removeItem(siteId, itemId) {
    const { ownerKey, siteId: rawSiteId } = decodeScopedSiteId(siteId);
    const sites = state.currentUser?.isAdmin ? clone(state.allUsers[ownerKey]?.sites || []) : clone(state.data);
    const site = sites.find((entry) => entry.id === rawSiteId);
    if (!site) {
      return;
    }
    site.items = site.items.filter((item) => item.id !== itemId);
    site.dateModification = now();
    updateLocalOwnerSites(ownerKey, sites);
    persistCurrentStateSilently();
    scheduleFlush(ownerKey);
  }

  function createDetail(siteId, itemId, payload) {
    const { ownerKey, siteId: rawSiteId } = decodeScopedSiteId(siteId);
    const sites = state.currentUser?.isAdmin ? clone(state.allUsers[ownerKey]?.sites || []) : clone(state.data);
    const site = sites.find((entry) => entry.id === rawSiteId);
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
    updateLocalOwnerSites(ownerKey, sites);
    persistCurrentStateSilently();
    scheduleFlush(ownerKey);
    return clone(detail);
  }

  function updateDetail(siteId, itemId, detailId, changes) {
    const { ownerKey, siteId: rawSiteId } = decodeScopedSiteId(siteId);
    const sites = state.currentUser?.isAdmin ? clone(state.allUsers[ownerKey]?.sites || []) : clone(state.data);
    const site = sites.find((entry) => entry.id === rawSiteId);
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
    updateLocalOwnerSites(ownerKey, sites);
    persistCurrentStateSilently();
    scheduleFlush(ownerKey);
    return clone(detail);
  }

  function removeDetail(siteId, itemId, detailId) {
    const { ownerKey, siteId: rawSiteId } = decodeScopedSiteId(siteId);
    const sites = state.currentUser?.isAdmin ? clone(state.allUsers[ownerKey]?.sites || []) : clone(state.data);
    const site = sites.find((entry) => entry.id === rawSiteId);
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
    updateLocalOwnerSites(ownerKey, sites);
    persistCurrentStateSilently();
    scheduleFlush(ownerKey);
  }

  window.StorageService = {
    init,
    registerUser,
    getCurrentUser,
    isAdminSession,
    onSyncStatusChange,
    clearSession,
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
