export const FIRESTORE_SAFE_BATCH_SIZE = 450;

export async function deleteReferencesInControlledBatches(
  references,
  { db, writeBatch, batchSize = FIRESTORE_SAFE_BATCH_SIZE },
) {
  const refs = Array.from(references || []);
  for (let offset = 0; offset < refs.length; offset += batchSize) {
    const batch = writeBatch(db);
    refs.slice(offset, offset + batchSize).forEach((reference) => batch.delete(reference));
    // Les lots sont volontairement séquentiels : une catégorie enfant doit être
    // confirmée intégralement avant que la catégorie suivante puisse commencer.
    await batch.commit();
  }
}

export async function deleteOutCascade({ detailRefs, deleteDetails, deleteOutAndCounter }) {
  await deleteDetails(detailRefs);
  return deleteOutAndCounter();
}

export async function deleteSiteCascade({ purchaseRefs, detailRefs, outRefs, deleteReferences, deleteSite }) {
  await deleteReferences(purchaseRefs);
  await deleteReferences(detailRefs);
  await deleteReferences(outRefs);
  await deleteSite();
}
