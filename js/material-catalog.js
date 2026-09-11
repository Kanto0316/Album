export function normalizeMaterialCode(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function normalizeCatalogMaterial(data) {
  const code = normalizeMaterialCode(data?.code ?? data?.ref ?? data?.reference ?? data?.Code);
  const designation = String(
    data?.designation ?? data?.Designation ?? data?.désignation ?? data?.['Désignation'] ?? data?.name ?? '',
  ).trim();

  return { code, designation };
}

export function mergeMaterialCatalogs(staticMaterials = [], firestoreMaterials = []) {
  const materialsByCode = new Map();

  staticMaterials.forEach((material) => {
    const normalized = normalizeCatalogMaterial(material);
    if (normalized.code && !materialsByCode.has(normalized.code)) {
      materialsByCode.set(normalized.code, normalized);
    }
  });

  firestoreMaterials.forEach((material) => {
    const normalized = normalizeCatalogMaterial(material);
    if (normalized.code && !materialsByCode.has(normalized.code)) {
      materialsByCode.set(normalized.code, normalized);
    }
  });

  return Array.from(materialsByCode.values()).sort((a, b) =>
    String(a.designation).localeCompare(String(b.designation), 'fr', { sensitivity: 'base' }),
  );
}

export function getCatalogueNotification(role, simpleMessage, adminMessage = simpleMessage) {
  return String(role || '').toLowerCase() === 'admin' ? adminMessage : simpleMessage;
}
