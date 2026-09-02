import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

let firebaseDatabase = null;

function errorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || 'Erreur Firebase inconnue.');
}

function init(firebaseDb) {
  if (!firebaseDb) {
    throw new TypeError('Une instance Firestore est requise.');
  }

  firebaseDatabase = firebaseDb;
  console.info('[OfflineAdapter] Adaptateur initialisé');
  return window.OfflineAdapter;
}

function getCollectionReference(collectionName) {
  if (!firebaseDatabase) {
    throw new Error('L’adaptateur doit être initialisé avant son utilisation.');
  }

  const normalizedName = String(collectionName || '').trim();
  if (!normalizedName) {
    throw new TypeError('Le nom de la collection est requis.');
  }

  // Les données des pages suivent la structure Firestore déjà utilisée par l’application.
  if (/^page\d+$/.test(normalizedName)) {
    return collection(firebaseDatabase, 'pages', normalizedName, 'items');
  }

  return collection(firebaseDatabase, normalizedName);
}

async function processAction(action) {
  const actionId = action?.id;
  let firestoreId;

  try {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new TypeError('Une action valide est requise.');
    }

    const collectionReference = getCollectionReference(action.collection);

    switch (action.action) {
      case 'add':
        if (!action.payload || typeof action.payload !== 'object' || Array.isArray(action.payload)) {
          throw new TypeError('Un payload valide est requis pour la création.');
        }
        // L'identifiant généré est transmis à la couche métier afin qu'elle
        // puisse enregistrer les relations entre données locales et Firestore.
        const documentReference = await addDoc(collectionReference, action.payload);
        firestoreId = documentReference.id;
        break;

      case 'update':
        if (!action.documentId) {
          throw new TypeError('documentId est requis pour la modification.');
        }
        if (!action.payload || typeof action.payload !== 'object' || Array.isArray(action.payload)) {
          throw new TypeError('Un payload valide est requis pour la modification.');
        }
        await updateDoc(doc(collectionReference, String(action.documentId)), action.payload);
        break;

      case 'delete':
        if (!action.documentId) {
          throw new TypeError('documentId est requis pour la suppression.');
        }
        await deleteDoc(doc(collectionReference, String(action.documentId)));
        break;

      default:
        throw new Error(`Action non prise en charge : ${String(action.action || '')}`);
    }

    console.info('[OfflineAdapter] Action synchronisée', actionId);

    // Intégration future : appeler ici OfflineSync.removePendingAction(actionId)
    // uniquement après la confirmation de Firestore.
    return { ok: true, actionId, ...(firestoreId ? { firestoreId } : {}) };
  } catch (error) {
    const message = errorMessage(error);
    console.error('[OfflineAdapter] Erreur Firebase', actionId, error);
    return { ok: false, actionId, error: message };
  }
}

async function syncActions(actions) {
  const orderedActions = Array.isArray(actions)
    ? [...actions].sort((first, second) =>
      String(first?.createdAt || '').localeCompare(String(second?.createdAt || '')),
    )
    : [];

  const report = {
    total: orderedActions.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  // Traitement séquentiel volontaire afin de préserver l’ordre de la file offline.
  for (const action of orderedActions) {
    const result = await processAction(action);

    if (result.ok) {
      report.success += 1;
      // Intégration future possible : supprimer ici l’action de la file IndexedDB.
      // await window.OfflineSync.removePendingAction(result.actionId);
    } else {
      report.failed += 1;
      report.errors.push({ actionId: result.actionId, error: result.error });
    }
  }

  return report;
}

window.OfflineAdapter = Object.freeze({
  init,
  processAction,
  syncActions,
  getCollectionReference,
});
