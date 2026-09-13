function normalizeCounter(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

export async function createOutAndIncrementCounter({ runTransaction, db, itemRef, siteRef, itemPayload }) {
  return runTransaction(db, async (transaction) => {
    // Firestore exige que toutes les lectures précèdent les écritures.
    const siteSnapshot = await transaction.get(siteRef);
    if (!siteSnapshot.exists()) {
      throw new Error('site_not_found');
    }

    const outCount = normalizeCounter(siteSnapshot.data()?.outCount) + 1;
    transaction.set(itemRef, itemPayload);
    transaction.set(siteRef, { outCount }, { merge: true });
    return outCount;
  });
}

export async function deleteOutAndDecrementCounter({ runTransaction, db, itemRef, siteRef, siteId }) {
  return runTransaction(db, async (transaction) => {
    const itemSnapshot = await transaction.get(itemRef);
    const siteSnapshot = await transaction.get(siteRef);
    if (!itemSnapshot.exists()) {
      throw new Error('item_not_found');
    }
    if (!siteSnapshot.exists()) {
      throw new Error('site_not_found');
    }
    if (String(itemSnapshot.data()?.siteId || '') !== String(siteId || '')) {
      throw new Error('item_site_mismatch');
    }

    const outCount = Math.max(0, normalizeCounter(siteSnapshot.data()?.outCount) - 1);
    transaction.delete(itemRef);
    transaction.set(siteRef, { outCount }, { merge: true });
    return outCount;
  });
}
