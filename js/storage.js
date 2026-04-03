import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD6krHqIlaD7Jo-ERhNxEFuuenwjwHrho',
  authDomain: 'base-737bf.firebaseapp.com',
  projectId: 'base-737bf',
  storageBucket: 'base-737bf.firebasestorage.app',
  messagingSenderId: '560283994192',
  appId: '1:560283994192:web:ede7aa7a3714c439542955',
  measurementId: 'G-LMQC9RVF2E',
};

const OFFLINE_CACHE_KEY = 'suiviMateriel.offlineCache.v1';
const PENDING_OPS_KEY = 'suiviMateriel.pendingOps.v1';

const state = {
  initialized: false,
  db: null,
  userId: null,
  sites: [],
  itemsBySite: new Map(),
  detailsByItem: new Map(),
  listeners: {
    sites: new Set(),
    itemCounts: new Set(),
    itemsBySite: new Map(),
    detailCountsBySite: new Map(),
    detailDesignationsBySite: new Map(),
    detailRowsBySite: new Map(),
    detailsByPair: new Map(),
  },
};

function normalizeRole(value) {
  const role = String(value || '').toLowerCase();
  if (role === 'lecture' || role === 'ecriture' || role === 'full') {
    return role;
  }
  return 'full';
}

function normalizeUsername(value) {
  return sanitizeText(value, false);
}

function isValidUsername(username) {
  const value = normalizeUsername(username);
  if (!/^[A-Za-z0-9]{4,10}$/.test(value)) {
    return false;
  }
  if (/^\d+$/.test(value)) {
    return false;
  }
  return true;
}

async function resolveUserId() {
  const source = [navigator.userAgent || '', navigator.language || '', navigator.platform || ''].join('|');
  const encoded = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hash = Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `user_${hash}`;
}

function usersCollection() {
  return collection(state.db, 'users');
}

function userDocRef(userId = state.userId) {
  return doc(state.db, 'users', userId);
}

async function isUsernameDuplicate(username, excludedUserId) {
  const normalizedTarget = normalizeUsername(username).toUpperCase();
  const snapshot = await getDocs(usersCollection());
  return snapshot.docs.some((snap) => {
    if (snap.id === excludedUserId) {
      return false;
    }
    const existing = normalizeUsername(snap.data()?.username).toUpperCase();
    return existing && existing === normalizedTarget;
  });
}

async function ensureCurrentUser() {
  const ref = userDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(
      ref,
      {
        username: '',
        role: 'full',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastNameChange: null,
      },
      { merge: true },
    );
    return { id: state.userId, username: '', role: 'full', lastNameChange: null };
  }

  const data = snap.data() || {};
  return {
    id: snap.id,
    username: normalizeUsername(data.username),
    role: normalizeRole(data.role),
    lastNameChange: data.lastNameChange || null,
  };
}

async function getCurrentUserProfile() {
  const snap = await getDoc(userDocRef());
  if (!snap.exists()) {
    return ensureCurrentUser();
  }
  const data = snap.data() || {};
  return {
    id: snap.id,
    username: normalizeUsername(data.username),
    role: normalizeRole(data.role),
    lastNameChange: data.lastNameChange || null,
  };
}

function computeNextNameChangeDate(lastNameChange) {
  if (!lastNameChange) {
    return null;
  }
  const date = typeof lastNameChange.toDate === 'function' ? lastNameChange.toDate() : new Date(lastNameChange);
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

async function saveUsername(username) {
  const nextName = normalizeUsername(username);
  if (!isValidUsername(nextName)) {
    return { ok: false, reason: 'invalid_username' };
  }

  const profile = await getCurrentUserProfile();
  const duplicate = await isUsernameDuplicate(nextName, state.userId);
  if (duplicate) {
    return { ok: false, reason: 'duplicate_username' };
  }

  const isFirstUsername = !profile.username;
  const updates = {
    username: nextName,
    updatedAt: serverTimestamp(),
  };

  if (isFirstUsername) {
    updates.role = 'ecriture';
  }

  await setDoc(
    userDocRef(),
    updates,
    { merge: true },
  );

  return { ok: true, username: nextName };
}

async function changeUsername(username) {
  const profile = await getCurrentUserProfile();
  const nextAllowedAt = computeNextNameChangeDate(profile.lastNameChange);
  if (nextAllowedAt && new Date() < nextAllowedAt) {
    return { ok: false, reason: 'cooldown', nextAllowedAt };
  }

  const nextName = normalizeUsername(username);
  if (!isValidUsername(nextName)) {
    return { ok: false, reason: 'invalid_username' };
  }

  const duplicate = await isUsernameDuplicate(nextName, profile.id);
  if (duplicate) {
    return { ok: false, reason: 'duplicate_username' };
  }

  await setDoc(
    userDocRef(),
    {
      username: nextName,
      lastNameChange: Timestamp.fromDate(new Date()),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true, username: nextName };
}

async function listUsers() {
  const snapshot = await getDocs(usersCollection());
  return snapshot.docs
    .map((snap) => {
      const data = snap.data() || {};
      return {
        id: snap.id,
        username: normalizeUsername(data.username),
        role: normalizeRole(data.role),
      };
    })
    .filter((user) => user.username);
}

async function updateUserRole(userId, role) {
  const nextRole = normalizeRole(role);
  await setDoc(
    userDocRef(userId),
    {
      role: nextRole,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return true;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeTrim(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeText(value, uppercase) {
  const cleaned = safeTrim(value).replace(/[<>]/g, '');
  return uppercase ? cleaned.toUpperCase() : cleaned;
}

function sanitizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sanitizeNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return '';
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function makePageItemsCollection(pageName) {
  return collection(state.db, 'pages', pageName, 'items');
}

function normalizeDocData(docSnapshot) {
  const data = docSnapshot.data() || {};
  return { id: docSnapshot.id, ...data };
}

function persistOfflineState() {
  const items = [];
  state.itemsBySite.forEach((value) => items.push(...value));
  const details = [];
  state.detailsByItem.forEach((value) => details.push(...value));
  const payload = {
    savedAt: nowIso(),
    pages: {
      page1: state.sites,
      page2: items,
      page3: details,
    },
  };
  localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(payload));
}

function loadOfflineState() {
  try {
    const raw = localStorage.getItem(OFFLINE_CACHE_KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw);
    const page1 = Array.isArray(parsed?.pages?.page1) ? parsed.pages.page1 : [];
    const page2 = Array.isArray(parsed?.pages?.page2) ? parsed.pages.page2 : [];
    const page3 = Array.isArray(parsed?.pages?.page3) ? parsed.pages.page3 : [];
    applySnapshot({ page1, page2, page3 });
    return true;
  } catch (_error) {
    return false;
  }
}

function getPendingOps() {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function setPendingOps(ops) {
  localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops));
}

function pushPendingOp(operation) {
  const ops = getPendingOps();
  ops.push(operation);
  setPendingOps(ops);
}

async function readPageItems(pageName) {
  const pageRef = makePageItemsCollection(pageName);
  const snapshot = await getDocs(pageRef);
  return snapshot.docs.map(normalizeDocData);
}

async function loadRemoteSnapshot() {
  const [page1, page2, page3] = await Promise.all([
    readPageItems('page1'),
    readPageItems('page2'),
    readPageItems('page3'),
  ]);
  return { page1, page2, page3 };
}

function applySnapshot(snapshot) {
  state.sites = Array.isArray(snapshot.page1) ? clone(snapshot.page1) : [];

  state.itemsBySite = new Map();
  (Array.isArray(snapshot.page2) ? snapshot.page2 : []).forEach((item) => {
    const siteId = String(item.siteId || '');
    if (!siteId) {
      return;
    }
    if (!state.itemsBySite.has(siteId)) {
      state.itemsBySite.set(siteId, []);
    }
    state.itemsBySite.get(siteId).push(item);
  });

  state.detailsByItem = new Map();
  (Array.isArray(snapshot.page3) ? snapshot.page3 : []).forEach((detail) => {
    const siteId = String(detail.siteId || '');
    const itemId = String(detail.itemId || '');
    if (!siteId || !itemId) {
      return;
    }
    const key = `${siteId}:${itemId}`;
    if (!state.detailsByItem.has(key)) {
      state.detailsByItem.set(key, []);
    }
    state.detailsByItem.get(key).push(detail);
  });

  sortState();
}

function sortState() {
  state.sites.sort((a, b) => String(b.dateModification || '').localeCompare(String(a.dateModification || '')));
  state.itemsBySite.forEach((items) => {
    items.sort((a, b) => String(b.dateModification || '').localeCompare(String(a.dateModification || '')));
  });
  state.detailsByItem.forEach((details) => {
    details.sort((a, b) => Number(a.champ) - Number(b.champ));
  });
}

function emitForSite(siteId) {
  const items = clone(state.itemsBySite.get(siteId) || []);
  (state.listeners.itemsBySite.get(siteId) || new Set()).forEach((listener) => listener(items));

  const detailCounts = {};
  state.detailsByItem.forEach((details, key) => {
    const [kSiteId, itemId] = key.split(':');
    if (kSiteId === siteId) {
      detailCounts[itemId] = details.length;
    }
  });
  (state.listeners.detailCountsBySite.get(siteId) || new Set()).forEach((listener) => listener(clone(detailCounts)));

  const designationsByItem = {};
  state.detailsByItem.forEach((details, key) => {
    const [kSiteId, itemId] = key.split(':');
    if (kSiteId !== siteId) {
      return;
    }
    designationsByItem[itemId] = details.map((detail) => sanitizeText(detail.designation, true)).filter(Boolean);
  });
  (state.listeners.detailDesignationsBySite.get(siteId) || new Set()).forEach((listener) => listener(clone(designationsByItem)));

  const rowsByItem = {};
  state.detailsByItem.forEach((details, key) => {
    const [kSiteId, itemId] = key.split(':');
    if (kSiteId === siteId) {
      rowsByItem[itemId] = clone(details).sort((a, b) => Number(a.champ) - Number(b.champ));
    }
  });
  (state.listeners.detailRowsBySite.get(siteId) || new Set()).forEach((listener) => listener(clone(rowsByItem)));
}

function emitAll() {
  state.listeners.sites.forEach((listener) => listener(clone(state.sites)));

  const itemCounts = {};
  state.itemsBySite.forEach((items, siteId) => {
    itemCounts[siteId] = items.length;
  });
  state.listeners.itemCounts.forEach((listener) => listener(clone(itemCounts)));

  state.listeners.itemsBySite.forEach((_listeners, siteId) => emitForSite(siteId));
  state.listeners.detailsByPair.forEach((listeners, key) => {
    const [siteId, itemId] = key.split(':');
    const details = clone(state.detailsByItem.get(`${siteId}:${itemId}`) || []);
    listeners.forEach((listener) => listener(details));
  });
}

async function flushPendingOperations() {
  const pending = getPendingOps();
  if (!pending.length) {
    return;
  }

  const siteIdMap = new Map();
  const itemIdMap = new Map();
  const detailIdMap = new Map();

  for (const op of pending) {
    if (op.kind === 'addSite') {
      const sitePayload = { ...op.data };
      delete sitePayload.id;
      const created = await addDoc(makePageItemsCollection('page1'), sitePayload);
      siteIdMap.set(op.data.id, created.id);
      continue;
    }

    if (op.kind === 'addItem') {
      const itemPayload = { ...op.data };
      const originalSiteId = itemPayload.siteId;
      itemPayload.siteId = siteIdMap.get(originalSiteId) || originalSiteId;
      delete itemPayload.id;
      const created = await addDoc(makePageItemsCollection('page2'), itemPayload);
      itemIdMap.set(op.data.id, created.id);
      continue;
    }

    if (op.kind === 'addDetail') {
      const detailPayload = { ...op.data };
      detailPayload.siteId = siteIdMap.get(detailPayload.siteId) || detailPayload.siteId;
      detailPayload.itemId = itemIdMap.get(detailPayload.itemId) || detailPayload.itemId;
      delete detailPayload.id;
      const created = await addDoc(makePageItemsCollection('page3'), detailPayload);
      detailIdMap.set(op.data.id, created.id);
      continue;
    }

    if (op.kind === 'updateDetail') {
      const detailId = detailIdMap.get(op.detailId) || op.detailId;
      const targetRef = doc(state.db, 'pages', 'page3', 'items', detailId);
      await updateDoc(targetRef, op.changes);
      continue;
    }

    if (op.kind === 'deleteDetail') {
      const detailId = detailIdMap.get(op.detailId) || op.detailId;
      const targetRef = doc(state.db, 'pages', 'page3', 'items', detailId);
      await deleteDoc(targetRef);
      continue;
    }

    if (op.kind === 'deleteItem') {
      const itemId = itemIdMap.get(op.itemId) || op.itemId;
      const targetRef = doc(state.db, 'pages', 'page2', 'items', itemId);
      await deleteDoc(targetRef);
      continue;
    }

    if (op.kind === 'deleteSite') {
      const siteId = siteIdMap.get(op.siteId) || op.siteId;
      const targetRef = doc(state.db, 'pages', 'page1', 'items', siteId);
      await deleteDoc(targetRef);
    }
  }

  setPendingOps([]);
}

async function init() {
  if (state.initialized) {
    return;
  }

  state.initialized = true;
  state.userId = await resolveUserId();
  const app = initializeApp(FIREBASE_CONFIG);
  state.db = getFirestore(app);

  const hasOfflineData = loadOfflineState();

  try {
    await flushPendingOperations();
    const remote = await loadRemoteSnapshot();
    applySnapshot(remote);
    persistOfflineState();
  } catch (_error) {
    if (!hasOfflineData) {
      applySnapshot({ page1: [], page2: [], page3: [] });
    }
  }
}

function getSite(siteId) {
  return clone(state.sites.find((site) => site.id === siteId) || null);
}

function getSites() {
  return clone(state.sites);
}

function getItem(siteId, itemId) {
  const items = state.itemsBySite.get(siteId) || [];
  return clone(items.find((item) => item.id === itemId) || null);
}

function subscribeFactory(registry, key, onChange) {
  if (!registry.has(key)) {
    registry.set(key, new Set());
  }
  const listeners = registry.get(key);
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function subscribeSites(onChange, onError) {
  try {
    state.listeners.sites.add(onChange);
    onChange(clone(state.sites));
    return () => state.listeners.sites.delete(onChange);
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    return () => {};
  }
}

function subscribeItems(siteId, onChange, onError) {
  try {
    const unsubscribe = subscribeFactory(state.listeners.itemsBySite, siteId, onChange);
    onChange(clone(state.itemsBySite.get(siteId) || []));
    return unsubscribe;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    return () => {};
  }
}

function subscribeItemCounts(onChange, onError) {
  try {
    state.listeners.itemCounts.add(onChange);
    const counts = {};
    state.itemsBySite.forEach((items, siteId) => {
      counts[siteId] = items.length;
    });
    onChange(clone(counts));
    return () => state.listeners.itemCounts.delete(onChange);
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    return () => {};
  }
}

function subscribeDetails(siteId, itemId, onChange, onError) {
  try {
    const key = `${siteId}:${itemId}`;
    const unsubscribe = subscribeFactory(state.listeners.detailsByPair, key, onChange);
    onChange(clone(state.detailsByItem.get(key) || []));
    return unsubscribe;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    return () => {};
  }
}

function subscribeDetailCounts(siteId, onChange, onError) {
  try {
    const unsubscribe = subscribeFactory(state.listeners.detailCountsBySite, siteId, onChange);
    const counts = {};
    state.detailsByItem.forEach((details, key) => {
      const [kSiteId, itemId] = key.split(':');
      if (kSiteId === siteId) {
        counts[itemId] = details.length;
      }
    });
    onChange(clone(counts));
    return unsubscribe;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    return () => {};
  }
}

function subscribeDetailDesignations(siteId, onChange, onError) {
  try {
    const unsubscribe = subscribeFactory(state.listeners.detailDesignationsBySite, siteId, onChange);
    const designationsByItem = {};
    state.detailsByItem.forEach((details, key) => {
      const [kSiteId, itemId] = key.split(':');
      if (kSiteId === siteId) {
        designationsByItem[itemId] = details.map((detail) => sanitizeText(detail.designation, true)).filter(Boolean);
      }
    });
    onChange(clone(designationsByItem));
    return unsubscribe;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    return () => {};
  }
}

function subscribeDetailRows(siteId, onChange, onError) {
  try {
    const unsubscribe = subscribeFactory(state.listeners.detailRowsBySite, siteId, onChange);
    const rowsByItem = {};
    state.detailsByItem.forEach((details, key) => {
      const [kSiteId, itemId] = key.split(':');
      if (kSiteId === siteId) {
        rowsByItem[itemId] = clone(details).sort((a, b) => Number(a.champ) - Number(b.champ));
      }
    });
    onChange(clone(rowsByItem));
    return unsubscribe;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    return () => {};
  }
}

async function getDetailRowsBySite(siteId) {
  const rowsByItem = {};
  state.detailsByItem.forEach((details, key) => {
    const [kSiteId, itemId] = key.split(':');
    if (kSiteId === siteId) {
      rowsByItem[itemId] = clone(details).sort((a, b) => Number(a.champ) - Number(b.champ));
    }
  });
  return clone(rowsByItem);
}

function isDuplicateSiteName(name) {
  const normalized = sanitizeText(name, true);
  if (!normalized) {
    return false;
  }
  return state.sites.some((site) => sanitizeText(site.nom, true) === normalized);
}

function isDuplicateItemNumber(siteId, numero) {
  const normalized = sanitizeText(numero, true);
  if (!normalized) {
    return false;
  }
  const items = state.itemsBySite.get(siteId) || [];
  return items.some((item) => sanitizeText(item.numero, true) === normalized);
}

function isDuplicateDetailDesignation(siteId, itemId, designation) {
  const normalized = sanitizeText(designation, true);
  if (!normalized) {
    return false;
  }
  const detailsKey = `${siteId}:${itemId}`;
  const details = state.detailsByItem.get(detailsKey) || [];
  return details.some((detail) => sanitizeText(detail.designation, true) === normalized);
}

function withoutId(payload) {
  const copy = { ...payload };
  delete copy.id;
  return copy;
}

async function createSite(name) {
  const siteName = sanitizeText(name, true);
  if (!siteName) {
    return { ok: false, reason: 'invalid_name' };
  }
  if (isDuplicateSiteName(siteName)) {
    return { ok: false, reason: 'duplicate_site' };
  }

  const timestamp = nowIso();
  const site = {
    id: uid(),
    nom: siteName,
    ownerId: state.userId,
    createdBy: state.userId,
    dateCreation: timestamp,
    dateModification: timestamp,
  };

  state.sites.unshift(site);
  pushPendingOp({ kind: 'addSite', data: site });
  persistOfflineState();
  emitAll();
  return { ok: true, id: site.id };
}

async function removeSite(siteId) {
  const siteIndex = state.sites.findIndex((site) => site.id === siteId);
  if (siteIndex === -1) {
    return null;
  }

  const [site] = state.sites.splice(siteIndex, 1);
  const items = clone(state.itemsBySite.get(siteId) || []);
  state.itemsBySite.delete(siteId);

  const details = [];
  Array.from(state.detailsByItem.keys()).forEach((key) => {
    if (key.startsWith(`${siteId}:`)) {
      details.push(...(state.detailsByItem.get(key) || []));
      state.detailsByItem.delete(key);
    }
  });

  pushPendingOp({ kind: 'deleteSite', siteId });
  persistOfflineState();
  emitAll();

  return { site: clone(site), items, details };
}

async function createItem(siteId, numberValue) {
  const cleanNumber = sanitizeDigits(sanitizeText(numberValue, true).replace(/^OUT-/, ''));
  if (cleanNumber.length < 4) {
    return { ok: false, reason: 'invalid_out' };
  }
  const numero = `OUT-${cleanNumber}`;
  if (isDuplicateItemNumber(siteId, numero)) {
    return { ok: false, reason: 'duplicate_out' };
  }

  const timestamp = nowIso();
  const item = {
    id: uid(),
    siteId,
    numero,
    ownerId: state.userId,
    createdBy: state.userId,
    dateCreation: timestamp,
    dateModification: timestamp,
  };

  if (!state.itemsBySite.has(siteId)) {
    state.itemsBySite.set(siteId, []);
  }
  state.itemsBySite.get(siteId).unshift(item);

  pushPendingOp({ kind: 'addItem', data: item });
  persistOfflineState();
  emitAll();
  return { ok: true, id: item.id };
}

async function removeItem(siteId, itemId) {
  const items = state.itemsBySite.get(siteId) || [];
  const itemIndex = items.findIndex((item) => item.id === itemId);
  if (itemIndex === -1) {
    return null;
  }

  const [item] = items.splice(itemIndex, 1);
  const detailsKey = `${siteId}:${itemId}`;
  const details = clone(state.detailsByItem.get(detailsKey) || []);
  state.detailsByItem.delete(detailsKey);

  pushPendingOp({ kind: 'deleteItem', itemId });
  persistOfflineState();
  emitAll();
  return { item: clone(item), details };
}

async function restoreSite(snapshot) {
  const site = snapshot?.site;
  if (!site?.id) {
    return false;
  }

  state.sites.unshift(clone(site));

  (Array.isArray(snapshot.items) ? snapshot.items : []).forEach((item) => {
    if (!item?.siteId) {
      return;
    }
    if (!state.itemsBySite.has(item.siteId)) {
      state.itemsBySite.set(item.siteId, []);
    }
    state.itemsBySite.get(item.siteId).push(clone(item));
  });

  (Array.isArray(snapshot.details) ? snapshot.details : []).forEach((detail) => {
    const key = `${detail.siteId}:${detail.itemId}`;
    if (!state.detailsByItem.has(key)) {
      state.detailsByItem.set(key, []);
    }
    state.detailsByItem.get(key).push(clone(detail));
  });

  pushPendingOp({ kind: 'addSite', data: clone(site) });
  persistOfflineState();
  emitAll();
  return true;
}

async function restoreItem(snapshot) {
  const item = snapshot?.item;
  if (!item?.id || !item.siteId) {
    return false;
  }

  if (!state.itemsBySite.has(item.siteId)) {
    state.itemsBySite.set(item.siteId, []);
  }
  state.itemsBySite.get(item.siteId).push(clone(item));

  (Array.isArray(snapshot.details) ? snapshot.details : []).forEach((detail) => {
    const key = `${detail.siteId}:${detail.itemId}`;
    if (!state.detailsByItem.has(key)) {
      state.detailsByItem.set(key, []);
    }
    state.detailsByItem.get(key).push(clone(detail));
  });

  pushPendingOp({ kind: 'addItem', data: item });
  persistOfflineState();
  emitAll();
  return true;
}

async function createDetail(siteId, itemId, payload) {
  const designation = sanitizeText(payload.designation, true);
  if (!designation) {
    return { ok: false, reason: 'invalid_designation' };
  }
  if (isDuplicateDetailDesignation(siteId, itemId, designation)) {
    return { ok: false, reason: 'duplicate_designation' };
  }

  const detailsKey = `${siteId}:${itemId}`;
  const details = state.detailsByItem.get(detailsKey) || [];
  const timestamp = nowIso();
  const detail = {
    id: uid(),
    siteId,
    itemId,
    champ: details.length + 1,
    code: sanitizeText(payload.code, true),
    designation,
    qteSortie: payload.qteSortie === '' ? '' : sanitizeNumber(payload.qteSortie),
    unite: sanitizeText(payload.unite || 'm', false) || 'm',
    qteHorsBtrs: '',
    qteRetour: 0,
    qtePosee: 0,
    observation: '',
    ownerId: state.userId,
    createdBy: state.userId,
    dateCreation: timestamp,
    dateModification: timestamp,
  };

  if (!state.detailsByItem.has(detailsKey)) {
    state.detailsByItem.set(detailsKey, []);
  }
  state.detailsByItem.get(detailsKey).push(detail);

  pushPendingOp({ kind: 'addDetail', data: detail });
  persistOfflineState();
  emitAll();
  return { ok: true, id: detail.id };
}

async function updateDetail(siteId, itemId, detailId, changes) {
  const detailsKey = `${siteId}:${itemId}`;
  const details = state.detailsByItem.get(detailsKey) || [];
  const target = details.find((detail) => detail.id === detailId);
  if (!target) {
    return null;
  }

  const syncedChanges = {};
  if ('code' in changes) {
    target.code = sanitizeText(changes.code, true);
    syncedChanges.code = target.code;
  }
  if ('designation' in changes) {
    target.designation = sanitizeText(changes.designation, false);
    syncedChanges.designation = target.designation;
  }
  if ('qteSortie' in changes) {
    target.qteSortie = sanitizeNumber(changes.qteSortie);
    syncedChanges.qteSortie = target.qteSortie;
  }
  if ('unite' in changes) {
    target.unite = sanitizeText(changes.unite, false) || 'm';
    syncedChanges.unite = target.unite;
  }
  if ('qteRetour' in changes) {
    target.qteRetour = sanitizeNumber(changes.qteRetour);
    syncedChanges.qteRetour = target.qteRetour;
  }
  if ('qtePosee' in changes) {
    target.qtePosee = sanitizeNumber(changes.qtePosee);
    syncedChanges.qtePosee = target.qtePosee;
  }
  if ('observation' in changes) {
    target.observation = sanitizeText(changes.observation, false);
    syncedChanges.observation = target.observation;
  }
  target.dateModification = nowIso();
  syncedChanges.dateModification = target.dateModification;

  pushPendingOp({ kind: 'updateDetail', detailId, changes: syncedChanges });
  persistOfflineState();
  emitAll();
  return true;
}

async function removeDetail(siteId, itemId, detailId) {
  const detailsKey = `${siteId}:${itemId}`;
  const details = state.detailsByItem.get(detailsKey) || [];
  const detailIndex = details.findIndex((detail) => detail.id === detailId);
  if (detailIndex === -1) {
    return false;
  }

  details.splice(detailIndex, 1);
  pushPendingOp({ kind: 'deleteDetail', detailId });
  persistOfflineState();
  emitAll();
  return true;
}

function exportData() {
  const items = [];
  state.itemsBySite.forEach((siteItems) => {
    items.push(...siteItems);
  });
  const details = [];
  state.detailsByItem.forEach((itemDetails) => {
    details.push(...itemDetails);
  });

  return {
    format: 'suivi-materiel-export',
    version: 2,
    exportedAt: nowIso(),
    pages: {
      page1: clone(state.sites),
      page2: clone(items),
      page3: clone(details),
    },
  };
}

function normalizeImportPayload(payload) {
  if (!payload) {
    return null;
  }

  if (payload.pages && typeof payload.pages === 'object') {
    return {
      page1: Array.isArray(payload.pages.page1) ? payload.pages.page1 : [],
      page2: Array.isArray(payload.pages.page2) ? payload.pages.page2 : [],
      page3: Array.isArray(payload.pages.page3) ? payload.pages.page3 : [],
    };
  }

  const source = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : null;
  if (!source) {
    return null;
  }

  const page1 = [];
  const page2 = [];
  const page3 = [];

  source.forEach((site) => {
    const siteId = uid();
    page1.push({
      id: siteId,
      nom: sanitizeText(site.nom, true),
      ownerId: state.userId,
      createdBy: state.userId,
      dateCreation: site.dateCreation || nowIso(),
      dateModification: site.dateModification || site.dateCreation || nowIso(),
      importedAt: nowIso(),
    });

    (site.items || []).forEach((item) => {
      const itemId = uid();
      page2.push({
        id: itemId,
        siteId,
        numero: sanitizeText(item.numero, true),
        ownerId: state.userId,
        createdBy: state.userId,
        dateCreation: item.dateCreation || nowIso(),
        dateModification: item.dateModification || item.dateCreation || nowIso(),
        importedAt: nowIso(),
      });

      (item.details || []).forEach((detail, index) => {
        page3.push({
          id: uid(),
          siteId,
          itemId,
          champ: Number(detail.champ) || index + 1,
          code: sanitizeText(detail.code, true),
          designation: sanitizeText(detail.designation, true),
          qteSortie: sanitizeNumber(detail.qteSortie),
          unite: sanitizeText(detail.unite || 'm', false) || 'm',
          qteHorsBtrs: '',
          qteRetour: sanitizeNumber(detail.qteRetour),
          qtePosee: sanitizeNumber(detail.qtePosee),
          observation: sanitizeText(detail.observation, false),
          ownerId: state.userId,
          createdBy: state.userId,
          dateCreation: detail.dateCreation || nowIso(),
          dateModification: detail.dateModification || detail.dateCreation || nowIso(),
          importedAt: nowIso(),
        });
      });
    });
  });

  return { page1, page2, page3 };
}

async function importData(payload) {
  const normalized = normalizeImportPayload(payload);
  if (!normalized) {
    return false;
  }

  normalized.page1.forEach((site) => {
    const sitePayload = {
      id: sanitizeText(site.id || uid(), false) || uid(),
      ...site,
    };
    state.sites.push(sitePayload);
    pushPendingOp({ kind: 'addSite', data: sitePayload });
  });

  normalized.page2.forEach((item) => {
    const itemPayload = {
      id: sanitizeText(item.id || uid(), false) || uid(),
      ...item,
    };
    if (!state.itemsBySite.has(itemPayload.siteId)) {
      state.itemsBySite.set(itemPayload.siteId, []);
    }
    state.itemsBySite.get(itemPayload.siteId).push(itemPayload);
    pushPendingOp({ kind: 'addItem', data: itemPayload });
  });

  normalized.page3.forEach((detail) => {
    const detailPayload = {
      id: sanitizeText(detail.id || uid(), false) || uid(),
      ...detail,
    };
    const detailsKey = `${detailPayload.siteId}:${detailPayload.itemId}`;
    if (!state.detailsByItem.has(detailsKey)) {
      state.detailsByItem.set(detailsKey, []);
    }
    state.detailsByItem.get(detailsKey).push(detailPayload);
    pushPendingOp({ kind: 'addDetail', data: detailPayload });
  });

  sortState();
  persistOfflineState();
  emitAll();
  return true;
}

window.StorageService = {
  init,
  getSites,
  getSite,
  getItem,
  subscribeSites,
  subscribeItems,
  subscribeItemCounts,
  subscribeDetails,
  subscribeDetailCounts,
  subscribeDetailDesignations,
  subscribeDetailRows,
  getDetailRowsBySite,
  createSite,
  removeSite,
  restoreSite,
  createItem,
  removeItem,
  restoreItem,
  createDetail,
  updateDetail,
  removeDetail,
  exportData,
  importData,
  ensureCurrentUser,
  getCurrentUserProfile,
  saveUsername,
  changeUsername,
  listUsers,
  updateUserRole,
  computeNextNameChangeDate,
};
