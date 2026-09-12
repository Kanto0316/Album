export const RETURN_QUANTITY_PRECISION = 10;
export const RETURN_QUANTITY_DISPLAY_PRECISION = 6;

// Keeps the user-facing comma syntax while ensuring Firestore always receives a number.
export function parseReturnQuantity(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
    return null;
  }

  const quantity = Number(normalized);
  return Number.isFinite(quantity) ? quantity : null;
}

export function roundReturnQuantity(value, precision = RETURN_QUANTITY_PRECISION) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 0;
  return Number(quantity.toFixed(precision));
}

export function isReturnQuantityWithinAvailable(quantity, available, epsilon = 0.000001) {
  return roundReturnQuantity(quantity) - roundReturnQuantity(available) <= epsilon;
}

export function sumReturnQuantities(quantities) {
  return roundReturnQuantity(
    Array.from(quantities || []).reduce((total, quantity) => total + (parseReturnQuantity(quantity) ?? 0), 0),
  );
}

export function formatReturnQuantity(value) {
  const quantity = roundReturnQuantity(parseReturnQuantity(value) ?? 0, RETURN_QUANTITY_DISPLAY_PRECISION);
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: RETURN_QUANTITY_DISPLAY_PRECISION,
  }).format(quantity);
}
