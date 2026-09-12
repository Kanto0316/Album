const STRUCTURED_HISTORY_ACTIONS = Object.freeze({
  CREATE_OUT: 'create_out',
  ADD_MATERIAL: 'add_material',
  UPDATE_MATERIAL: 'update_material',
  ADD_RETURN: 'add_return',
  DELETE_MATERIAL: 'delete_material',
});

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function quantityWithUnit(value, unit) {
  return [clean(value), clean(unit)].filter(Boolean).join(' ');
}

// Les documents antérieurs aux champs structurés conservent leur texte initial.
function formatStructuredHistoryAction(history = {}) {
  const action = clean(history.action);
  const outNumber = clean(history.outNumber) || 'OUT inconnu';
  const site = clean(history.site || history.siteName);
  const designation = clean(history.materialDesignation) || 'matériel non renseigné';
  const unit = clean(history.unit);

  switch (action) {
    case STRUCTURED_HISTORY_ACTIONS.CREATE_OUT:
      return `a créé ${outNumber}${site ? ` du site « ${site} »` : ''}.`;
    case STRUCTURED_HISTORY_ACTIONS.ADD_MATERIAL:
      return `a ajouté ${designation} dans ${outNumber}${site ? ` du site « ${site} »` : ''} (Quantité : ${quantityWithUnit(history.newQuantity ?? history.quantity, unit) || 'non renseignée'}).`;
    case STRUCTURED_HISTORY_ACTIONS.UPDATE_MATERIAL:
      return `a modifié ${designation} dans ${outNumber} : ${quantityWithUnit(history.oldQuantity, unit) || 'non renseignée'} → ${quantityWithUnit(history.newQuantity, unit) || 'non renseignée'}.`;
    case STRUCTURED_HISTORY_ACTIONS.ADD_RETURN:
      return `a ajouté un retour de ${designation} dans ${outNumber} (Quantité retournée : ${quantityWithUnit(history.quantity, unit) || 'non renseignée'}).`;
    case STRUCTURED_HISTORY_ACTIONS.DELETE_MATERIAL:
      return `a supprimé ${designation} de ${outNumber} (Quantité supprimée : ${quantityWithUnit(history.quantity, unit) || 'non renseignée'}).`;
    default:
      return clean(history.legacyAction || action);
  }
}

export { STRUCTURED_HISTORY_ACTIONS, formatStructuredHistoryAction };
