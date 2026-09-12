const FIELD_LABELS = {
  code: 'Code matériel',
  designation: 'Désignation',
  unite: 'Unité',
  qtePosee: 'Qté posée',
  qteRebus: 'Qté rebut',
  observation: 'Observation',
  statut: 'Statut',
  dateRetour: 'Date retour',
};

function clean(value) {
  return String(value ?? '').trim();
}

function materialLabel(history) {
  const designation = clean(history?.designation) || 'matériel inconnu';
  const code = clean(history?.materialCode);
  return code ? `${designation} (code matériel : ${code})` : designation;
}

function valueWithUnit(value, unit) {
  const normalized = clean(value);
  return `${normalized || '0'}${clean(unit) ? ` ${clean(unit)}` : ''}`;
}

export function formatMaterialHistoryAction(history) {
  const type = clean(history?.actionType);
  if (!type) return '';

  const material = materialLabel(history);
  const out = clean(history?.outNumber) || 'OUT inconnu';
  const site = clean(history?.siteName) || 'Site inconnu';
  const location = `${out} du site « ${site} »`;
  const unit = clean(history?.unit);

  if (type === 'material_add') {
    return `a ajouté ${material} dans ${location} (Quantité : ${valueWithUnit(history?.quantity, unit)}).`;
  }
  if (type === 'material_delete') {
    return `a supprimé ${material} de ${location}.`;
  }
  if (type === 'material_quantity_update') {
    return `a modifié la quantité de ${material} dans ${location} : ${valueWithUnit(history?.previousValue, unit)} → ${valueWithUnit(history?.newValue, unit)}.`;
  }
  if (type === 'material_return_update') {
    return `a modifié le champ Qté retour de ${material} dans ${location} : ${valueWithUnit(history?.previousValue, unit)} → ${valueWithUnit(history?.newValue, unit)}.`;
  }
  if (type === 'material_field_update') {
    const field = FIELD_LABELS[clean(history?.field)] || clean(history?.field) || 'Matériel';
    return `a modifié le champ ${field} de ${material} dans ${location} : ${clean(history?.previousValue) || '—'} → ${clean(history?.newValue) || '—'}.`;
  }
  return '';
}

export function getMaterialHistoryHighlights(history, formattedAction = formatMaterialHistoryAction(history)) {
  const action = clean(formattedAction);
  const designation = clean(history?.designation);
  const materialCode = clean(history?.materialCode);

  // Only structured material histories have enough reliable information to be
  // enriched. Legacy, free-text entries must remain completely unchanged.
  if (!action || !designation || !materialCode || history?.quantity == null) {
    return [];
  }

  const highlights = [];
  const addHighlight = (value, className, fromIndex = 0) => {
    const start = action.indexOf(value, fromIndex);
    if (start >= 0) {
      highlights.push({ start, end: start + value.length, className });
    }
  };

  addHighlight(designation, 'history-material');
  addHighlight(materialCode, 'history-code');

  if (clean(history?.actionType) === 'material_add') {
    addHighlight(`Quantité : ${valueWithUnit(history?.quantity, history?.unit)}`, 'history-quantity');
  } else if (['material_quantity_update', 'material_return_update'].includes(clean(history?.actionType))) {
    addHighlight(
      `${valueWithUnit(history?.previousValue, history?.unit)} → ${valueWithUnit(history?.newValue, history?.unit)}`,
      'history-quantity',
    );
  }

  return highlights.sort((left, right) => left.start - right.start);
}
