import { z } from 'zod';
import { type DocumentValidityConfig } from './document-validity';

// Conjunto cerrado de condición (ADR-0004 §4: campo | operador | valor | combinadores y/o)
export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] as const;

export const leafConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
  ]),
}).strict();

export type Condition =
  | z.infer<typeof leafConditionSchema>
  | { all: Condition[] }
  | { any: Condition[] };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    leafConditionSchema,
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
  ]),
);

// Conjunto cerrado de validación (tabla "Datos y validaciones" de HU-007: tipo de dato, formato, rango)
export const validationSchema = z.object({
  dataType: z.enum(['string', 'number', 'date', 'boolean', 'enum']),
  format: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  enumValues: z.array(z.string()).optional(),
}).strict();

export interface RequirementDetail {
  requirementId: string;
  standard: string;
  type: 'field' | 'document_type';
  key: string;
  mandatory: 'always' | 'conditional' | 'optional';
  blocking: boolean;
  condition: Condition | null;
  validation: z.infer<typeof validationSchema> | null;
  validity: DocumentValidityConfig | null;
}

/**
 * Evaluates a condition against a dictionary of field values.
 */
export function evaluateCondition(condition: Condition, values: Record<string, unknown>): boolean {
  if ('all' in condition) {
    if (!condition.all || condition.all.length === 0) return true;
    return condition.all.every((c) => evaluateCondition(c, values));
  }

  if ('any' in condition) {
    if (!condition.any || condition.any.length === 0) return false;
    return condition.any.some((c) => evaluateCondition(c, values));
  }

  if ('field' in condition) {
    const val = values[condition.field];
    const target = condition.value;

    switch (condition.operator) {
      case 'eq':
        return val === target;
      case 'neq':
        return val !== target;
      case 'gt':
        return typeof val === 'number' && typeof target === 'number' && val > target;
      case 'gte':
        return typeof val === 'number' && typeof target === 'number' && val >= target;
      case 'lt':
        return typeof val === 'number' && typeof target === 'number' && val < target;
      case 'lte':
        return typeof val === 'number' && typeof target === 'number' && val <= target;
      case 'in':
        if (Array.isArray(target)) {
          return target.includes(val as string | number);
        }
        return false;
      case 'not_in':
        if (Array.isArray(target)) {
          return !target.includes(val as string | number);
        }
        return true;
      default:
        return false;
    }
  }

  return false;
}

/**
 * Determines whether a requirement is currently required given current field values.
 */
export function isRequirementCurrentlyRequired(
  req: RequirementDetail,
  values: Record<string, unknown>,
): boolean {
  if (req.mandatory === 'always') {
    return true;
  }
  if (req.mandatory === 'optional') {
    return false;
  }
  if (req.mandatory === 'conditional') {
    if (!req.condition) {
      return false;
    }
    return evaluateCondition(req.condition, values);
  }
  return false;
}

/**
 * Validates a field value against its validation specification.
 * Returns null if valid, or a localized error message in Spanish if invalid.
 */
export function validateFieldValue(
  value: unknown,
  validation: z.infer<typeof validationSchema> | null,
): string | null {
  if (!validation) {
    return null;
  }

  if (value === undefined || value === null || value === '') {
    return null; // Empty checking is handled by mandatory/isRequirementCurrentlyRequired
  }

  switch (validation.dataType) {
    case 'string': {
      if (typeof value !== 'string') {
        return 'El valor debe ser un texto';
      }
      if (validation.min !== undefined && value.length < validation.min) {
        return `Debe tener al menos ${validation.min} caracteres`;
      }
      if (validation.max !== undefined && value.length > validation.max) {
        return `No puede exceder ${validation.max} caracteres`;
      }
      if (validation.format) {
        try {
          const regex = new RegExp(validation.format);
          if (!regex.test(value)) {
            return 'El formato ingresado no es válido';
          }
        } catch {
          // If regex is invalid in configuration, ignore regex check
        }
      }
      return null;
    }

    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      if (isNaN(num)) {
        return 'El valor debe ser un número válido';
      }
      if (validation.min !== undefined && num < validation.min) {
        return `El valor mínimo permitido es ${validation.min}`;
      }
      if (validation.max !== undefined && num > validation.max) {
        return `El valor máximo permitido es ${validation.max}`;
      }
      return null;
    }

    case 'date': {
      if (typeof value !== 'string' && !(value instanceof Date)) {
        return 'La fecha debe ser válida';
      }
      const dateVal = new Date(value);
      if (isNaN(dateVal.getTime())) {
        return 'Fecha no válida';
      }
      return null;
    }

    case 'boolean': {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        return 'Debe seleccionar Sí o No';
      }
      return null;
    }

    case 'enum': {
      const strVal = String(value);
      if (validation.enumValues && !validation.enumValues.includes(strVal)) {
        return `Opción no permitida. Opciones válidas: ${validation.enumValues.join(', ')}`;
      }
      return null;
    }

    default:
      return null;
  }
}
