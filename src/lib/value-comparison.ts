/**
 * Normalizes a value for comparison.
 * Strings: trims whitespace, collapses internal whitespace, converts to lowercase, strips accents.
 * Any other type (number, boolean, object, null, undefined): returned as-is.
 * (HU-019 §2 / Reglas de negocio)
 *
 * Sin dependencias de servidor a propósito: se usa tanto en dominio (reconciliation/service.ts)
 * como en componentes cliente (declaration-form.tsx en el portal).
 */
export function normalizeValue(val: unknown): unknown {
  if (typeof val === 'string') {
    return val
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }
  return val;
}

/**
 * Checks equality between two values using structural comparison,
 * with string normalization applied.
 */
export function areValuesEqual(a: unknown, b: unknown): boolean {
  const normA = normalizeValue(a);
  const normB = normalizeValue(b);

  if (normA === normB) {
    return true;
  }

  if (typeof normA === 'object' && normA !== null && typeof normB === 'object' && normB !== null) {
    return JSON.stringify(normA) === JSON.stringify(normB);
  }

  return false;
}
