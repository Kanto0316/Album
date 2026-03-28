import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function makePageItemsCollection(pageName) {
  return collection(state.db, 'pages', pageName, 'items');
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

async function init() {
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  state.userId = uid();
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

async function createSite(name) {
  const siteName = sanitizeText(name, true);
  if (!siteName) {
    return null;
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
  return created.id;
}

async function removeSite(siteId) {
  const targetRef = doc(state.db, 'pages', 'page1', 'items', siteId);
  const snap = await getDoc(targetRef);
  if (!snap.exists() || !canDelete(snap.data())) {
    return false;
  }
  await deleteDoc(targetRef);
  return true;
}

async function createItem(siteId, numberValue) {
  const cleanNumber = sanitizeDigits(sanitizeText(numberValue, true).replace(/^OUT-/, ''));
  if (cleanNumber.length < 4) {
    return null;
  }

  const timestamp = nowIso();
  const itemsRef = makePageItemsCollection('page2');
  const created = await addDoc(itemsRef, {
    siteId,
    numero: `OUT-${cleanNumber}`,
    ownerId: state.userId,
    createdBy: state.userId,
    dateCreation: timestamp,
    dateModification: timestamp,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

async function removeItem(_siteId, itemId) {
  const targetRef = doc(state.db, 'pages', 'page2', 'items', itemId);
  const snap = await getDoc(targetRef);
  if (!snap.exists() || !canDelete(snap.data())) {
    return false;
  }
  await deleteDoc(targetRef);
  return true;
}

async function createDetail(siteId, itemId, payload) {
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
    designation: sanitizeText(payload.designation, true),
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
  return created.id;
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

  const qteSortie = Number('qteSortie' in next ? next.qteSortie : current.qteSortie) || 0;
  const qtePosee = Math.min(Number('qtePosee' in next ? next.qtePosee : current.qtePosee) || 0, qteSortie);
  const qteRetour = Math.max(0, qteSortie - qtePosee);

  next.qteSortie = qteSortie;
  next.qtePosee = qtePosee;
  next.qteRetour = Math.min(qteRetour, qteSortie);
  next.dateModification = nowIso();
  next.updatedAt = serverTimestamp();

  await updateDoc(detailRef, next);
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

  return true;
}

window.StorageService = {
  init,
  getSites,
  getSite,
  getItem,
  subscribeSites,
  subscribeItems,
  subscribeDetails,
  createSite,
  removeSite,
  createItem,
  removeItem,
  createDetail,
  updateDetail,
  removeDetail,
  exportData,
  importData,
};
