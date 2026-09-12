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
