import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
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

const state = {
  initialized: false,
  db: null,
  userId: null,
  sites: [],
  itemsBySite: new Map(),
  detailsByItem: new Map(),
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
  const q = query(usersCollection(), where('username', '==', username));
  const snapshot = await getDocs(q);
  return snapshot.docs.some((snap) => snap.id !== excludedUserId);
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

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function makePageItemsCollection(pageName) {
  return collection(state.db, 'pages', pageName, 'items');
}

async function readPageItems(pageName) {
  const pageRef = makePageItemsCollection(pageName);
  const snapshot = await getDocs(pageRef);
  return snapshot.docs.map(normalizeDocData);
}

async function persistFullSnapshot() {
  const [page1, page2, page3] = await Promise.all([
    readPageItems('page1'),
    readPageItems('page2'),
    readPageItems('page3'),
  ]);

  await setDoc(
    doc(state.db, 'pages', 'snapshot'),
    {
      pages: {
        page1,
        page2,
        page3,
      },
      updatedAtIso: nowIso(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function normalizeDocData(docSnapshot) {
  const data = docSnapshot.data() || {};
  return { id: docSnapshot.id, ...data };
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

function canDelete(documentData) {
  return Boolean(documentData);
}

async function removeDetailsForItem(siteId, itemId) {
  const detailsRef = makePageItemsCollection('page3');
  const detailsQuery = query(detailsRef, where('siteId', '==', siteId), where('itemId', '==', itemId));
  const detailsSnapshot = await getDocs(detailsQuery);
  const removedDetails = detailsSnapshot.docs.map(normalizeDocData);
  await Promise.all(detailsSnapshot.docs.map((detailDoc) => deleteDoc(detailDoc.ref)));
  return removedDetails;
}

async function removeItemsForSite(siteId) {
  const itemsRef = makePageItemsCollection('page2');
  const itemsQuery = query(itemsRef, where('siteId', '==', siteId));
  const itemsSnapshot = await getDocs(itemsQuery);

  for (const itemDoc of itemsSnapshot.docs) {
    await removeDetailsForItem(siteId, itemDoc.id);
    await deleteDoc(itemDoc.ref);
  }
}

async function removeAllPageItems(pageName) {
  const pageRef = makePageItemsCollection(pageName);
  const snapshot = await getDocs(pageRef);
  await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
}

async function init() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  state.userId = await resolveUserId();
  const app = initializeApp(FIREBASE_CONFIG);
  state.db = getFirestore(app);
}

function subscribeSites(onChange, onError) {
  const sitesRef = makePageItemsCollection('page1');
  const q = query(sitesRef, orderBy('dateModification', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      state.sites = snapshot.docs.map(normalizeDocData);
      onChange(clone(state.sites));
    },
    (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    },
  );
}

function subscribeItems(siteId, onChange, onError) {
  const itemsRef = makePageItemsCollection('page2');
  const q = query(itemsRef, where('siteId', '==', siteId), orderBy('dateModification', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map(normalizeDocData);
      state.itemsBySite.set(siteId, items);
      onChange(clone(items));
    },
    (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    },
  );
}

function subscribeItemCounts(onChange, onError) {
  const itemsRef = makePageItemsCollection('page2');
  const q = query(itemsRef, orderBy('dateModification', 'desc'));

  return onSnapshot(
    q,
    (snapshot) => {
      const counts = {};
      snapshot.docs.forEach((docSnap) => {
        const item = normalizeDocData(docSnap);
        const key = String(item.siteId || '');
        if (!key) {
          return;
        }
        counts[key] = (counts[key] || 0) + 1;
      });
      onChange(clone(counts));
    },
    (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    },
  );
}

function subscribeDetails(siteId, itemId, onChange, onError) {
  const detailsRef = makePageItemsCollection('page3');
  const q = query(
    detailsRef,
    where('siteId', '==', siteId),
    where('itemId', '==', itemId),
    orderBy('champ', 'asc'),
  );
  const detailsKey = `${siteId}:${itemId}`;

  return onSnapshot(
    q,
    (snapshot) => {
      const details = snapshot.docs.map(normalizeDocData);
      state.detailsByItem.set(detailsKey, details);
      onChange(clone(details));
    },
    (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    },
  );
}

function subscribeDetailCounts(siteId, onChange, onError) {
  const detailsRef = makePageItemsCollection('page3');
  const q = query(detailsRef, where('siteId', '==', siteId));

  return onSnapshot(
    q,
    (snapshot) => {
      const counts = {};
      snapshot.docs.forEach((docSnap) => {
        const detail = normalizeDocData(docSnap);
        const key = String(detail.itemId || '');
        if (!key) {
          return;
        }
        counts[key] = (counts[key] || 0) + 1;
      });
      onChange(clone(counts));
    },
    (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    },
  );
}

function subscribeDetailDesignations(siteId, onChange, onError) {
  const detailsRef = makePageItemsCollection('page3');
  const q = query(detailsRef, where('siteId', '==', siteId));

  return onSnapshot(
    q,
    (snapshot) => {
      const designationsByItem = {};
      snapshot.docs.forEach((docSnap) => {
        const detail = normalizeDocData(docSnap);
        const itemId = String(detail.itemId || '');
        if (!itemId) {
          return;
        }
        const designation = sanitizeText(detail.designation, true);
        if (!designation) {
          return;
        }
        if (!designationsByItem[itemId]) {
          designationsByItem[itemId] = [];
        }
        designationsByItem[itemId].push(designation);
      });
      onChange(clone(designationsByItem));
    },
    (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    },
  );
}

function sortDetailRowsByChamp(rowsByItem) {
  Object.keys(rowsByItem).forEach((itemId) => {
    rowsByItem[itemId].sort((left, right) => {
      const leftChamp = Number(left.champ);
      const rightChamp = Number(right.champ);

      if (Number.isFinite(leftChamp) && Number.isFinite(rightChamp)) {
        return leftChamp - rightChamp;
      }

      return String(left.champ || '').localeCompare(String(right.champ || ''), 'fr', { numeric: true });
    });
  });
}

function subscribeDetailRows(siteId, onChange, onError) {
  const detailsRef = makePageItemsCollection('page3');
  const q = query(detailsRef, where('siteId', '==', siteId));

  return onSnapshot(
    q,
    (snapshot) => {
      const rowsByItem = {};
      snapshot.docs.forEach((docSnap) => {
        const detail = normalizeDocData(docSnap);
        const itemId = String(detail.itemId || '');
        if (!itemId) {
          return;
        }
        if (!rowsByItem[itemId]) {
          rowsByItem[itemId] = [];
        }
        rowsByItem[itemId].push(detail);
      });
      sortDetailRowsByChamp(rowsByItem);
      onChange(clone(rowsByItem));
    },
    (error) => {
      if (typeof onError === 'function') {
        onError(error);
      }
    },
  );
}

async function getDetailRowsBySite(siteId) {
  const detailsRef = makePageItemsCollection('page3');
  const q = query(detailsRef, where('siteId', '==', siteId));
  const snapshot = await getDocs(q);
  const rowsByItem = {};

  snapshot.docs.forEach((docSnap) => {
    const detail = normalizeDocData(docSnap);
    const itemId = String(detail.itemId || '');
    if (!itemId) {
      return;
    }
    if (!rowsByItem[itemId]) {
      rowsByItem[itemId] = [];
    }
    rowsByItem[itemId].push(detail);
  });

  sortDetailRowsByChamp(rowsByItem);
  return clone(rowsByItem);
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
  const sitesRef = makePageItemsCollection('page1');
  const created = await addDoc(sitesRef, {
    nom: siteName,
    ownerId: state.userId,
    createdBy: state.userId,
    dateCreation: timestamp,
    dateModification: timestamp,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await persistFullSnapshot();
  return { ok: true, id: created.id };
}

async function removeSite(siteId) {
  const targetRef = doc(state.db, 'pages', 'page1', 'items', siteId);
  const snap = await getDoc(targetRef);
  if (!snap.exists() || !canDelete(snap.data())) {
    return null;
  }

  const siteData = normalizeDocData(snap);
  const itemsRef = makePageItemsCollection('page2');
  const itemsQuery = query(itemsRef, where('siteId', '==', siteId));
  const itemsSnapshot = await getDocs(itemsQuery);
  const removedItems = itemsSnapshot.docs.map(normalizeDocData);

  const detailsRef = makePageItemsCollection('page3');
  const detailsQuery = query(detailsRef, where('siteId', '==', siteId));
  const detailsSnapshot = await getDocs(detailsQuery);
  const removedDetails = detailsSnapshot.docs.map(normalizeDocData);

  await removeItemsForSite(siteId);
  await deleteDoc(targetRef);

  const sitesRef = makePageItemsCollection('page1');
  const remainingSites = await getDocs(sitesRef);
  if (remainingSites.empty) {
    await Promise.all([removeAllPageItems('page2'), removeAllPageItems('page3')]);
  }

  await persistFullSnapshot();
  return {
    site: siteData,
    items: removedItems,
    details: removedDetails,
  };
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
  const itemsRef = makePageItemsCollection('page2');
  const created = await addDoc(itemsRef, {
    siteId,
    numero,
    ownerId: state.userId,
    createdBy: state.userId,
    dateCreation: timestamp,
    dateModification: timestamp,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await persistFullSnapshot();
  return { ok: true, id: created.id };
}

async function removeItem(_siteId, itemId) {
  const targetRef = doc(state.db, 'pages', 'page2', 'items', itemId);
  const snap = await getDoc(targetRef);
  if (!snap.exists() || !canDelete(snap.data())) {
    return null;
  }

  const itemData = normalizeDocData(snap);
  const removedDetails = await removeDetailsForItem(itemData.siteId, itemId);
  await deleteDoc(targetRef);
  await persistFullSnapshot();
  return {
    item: itemData,
    details: removedDetails,
  };
}

function withoutId(payload) {
  const copy = { ...payload };
  delete copy.id;
  return copy;
}

async function restoreSite(snapshot) {
  const site = snapshot?.site;
  if (!site?.id) {
    return false;
  }

  const timestamp = nowIso();
  const siteRef = doc(state.db, 'pages', 'page1', 'items', site.id);
  await setDoc(siteRef, {
    ...withoutId(site),
    dateModification: timestamp,
    updatedAt: serverTimestamp(),
  });

  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  for (const item of items) {
    if (!item?.id) {
      continue;
    }
    const itemRef = doc(state.db, 'pages', 'page2', 'items', item.id);
    await setDoc(itemRef, {
      ...withoutId(item),
      dateModification: timestamp,
      updatedAt: serverTimestamp(),
    });
  }

  const details = Array.isArray(snapshot.details) ? snapshot.details : [];
  for (const detail of details) {
    if (!detail?.id) {
      continue;
    }
    const detailRef = doc(state.db, 'pages', 'page3', 'items', detail.id);
    await setDoc(detailRef, {
      ...withoutId(detail),
      dateModification: timestamp,
      updatedAt: serverTimestamp(),
    });
  }

  await persistFullSnapshot();
  return true;
}

async function restoreItem(snapshot) {
  const item = snapshot?.item;
  if (!item?.id) {
    return false;
  }

  const timestamp = nowIso();
  const itemRef = doc(state.db, 'pages', 'page2', 'items', item.id);
  await setDoc(itemRef, {
    ...withoutId(item),
    dateModification: timestamp,
    updatedAt: serverTimestamp(),
  });

  const details = Array.isArray(snapshot.details) ? snapshot.details : [];
  for (const detail of details) {
    if (!detail?.id) {
      continue;
    }
    const detailRef = doc(state.db, 'pages', 'page3', 'items', detail.id);
    await setDoc(detailRef, {
      ...withoutId(detail),
      dateModification: timestamp,
      updatedAt: serverTimestamp(),
    });
  }

  await persistFullSnapshot();
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
  const nextChamp = details.length + 1;
  const timestamp = nowIso();

  const detailsRef = makePageItemsCollection('page3');
  const created = await addDoc(detailsRef, {
    siteId,
    itemId,
    champ: nextChamp,
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await persistFullSnapshot();
  return { ok: true, id: created.id };
}

async function updateDetail(siteId, itemId, detailId, changes) {
  const detailRef = doc(state.db, 'pages', 'page3', 'items', detailId);
  const snap = await getDoc(detailRef);
  if (!snap.exists()) {
    return null;
  }

  const current = snap.data();
  if (current.siteId !== siteId || current.itemId !== itemId) {
    return null;
  }

  const next = {};
  if ('code' in changes) {
    next.code = sanitizeText(changes.code, true);
  }
  if ('designation' in changes) {
    next.designation = sanitizeText(changes.designation, false);
  }
  if ('qteSortie' in changes) {
    next.qteSortie = sanitizeNumber(changes.qteSortie);
  }
  if ('unite' in changes) {
    next.unite = sanitizeText(changes.unite, false) || 'm';
  }
  if ('qteRetour' in changes) {
    next.qteRetour = sanitizeNumber(changes.qteRetour);
  }
  if ('qtePosee' in changes) {
    next.qtePosee = sanitizeNumber(changes.qtePosee);
  }
  if ('observation' in changes) {
    next.observation = sanitizeText(changes.observation, false);
  }

  next.dateModification = nowIso();
  next.updatedAt = serverTimestamp();

  await updateDoc(detailRef, next);
  await persistFullSnapshot();
  return true;
}

async function removeDetail(siteId, itemId, detailId) {
  const detailRef = doc(state.db, 'pages', 'page3', 'items', detailId);
  const snap = await getDoc(detailRef);
  const data = snap.data();
  if (!snap.exists() || data.siteId !== siteId || data.itemId !== itemId || !canDelete(data)) {
    return false;
  }

  await deleteDoc(detailRef);
  await persistFullSnapshot();
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

  const page1Ref = makePageItemsCollection('page1');
  const page2Ref = makePageItemsCollection('page2');
  const page3Ref = makePageItemsCollection('page3');

  for (const site of normalized.page1) {
    const docId = sanitizeText(site.id || uid(), false) || uid();
    const targetRef = doc(page1Ref, docId);
    const exists = await getDoc(targetRef);
    if (exists.exists()) {
      continue;
    }
    await setDoc(targetRef, {
      ...site,
      ownerId: site.ownerId || state.userId,
      createdBy: state.userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const item of normalized.page2) {
    const docId = sanitizeText(item.id || uid(), false) || uid();
    const targetRef = doc(page2Ref, docId);
    const exists = await getDoc(targetRef);
    if (exists.exists()) {
      continue;
    }
    await setDoc(targetRef, {
      ...item,
      ownerId: item.ownerId || state.userId,
      createdBy: state.userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const detail of normalized.page3) {
    const docId = sanitizeText(detail.id || uid(), false) || uid();
    const targetRef = doc(page3Ref, docId);
    const exists = await getDoc(targetRef);
    if (exists.exists()) {
      continue;
    }
    await setDoc(targetRef, {
      ...detail,
      ownerId: detail.ownerId || state.userId,
      createdBy: state.userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await persistFullSnapshot();
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
