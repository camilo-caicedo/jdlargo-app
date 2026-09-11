import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  isRequirementCurrentlyRequired,
  validateFieldValue,
  type RequirementDetail,
  type Condition,
} from './requirement-evaluation';

describe('requirement-evaluation', () => {
  describe('evaluateCondition', () => {
    it('evaluates leaf conditions: eq, neq, in, not_in, gt, gte, lt, lte', () => {
      expect(evaluateCondition({ field: 'pep', operator: 'eq', value: true }, { pep: true })).toBe(true);
      expect(evaluateCondition({ field: 'pep', operator: 'eq', value: true }, { pep: false })).toBe(false);
      expect(evaluateCondition({ field: 'tipo', operator: 'neq', value: 'extranjero' }, { tipo: 'nacional' })).toBe(true);

      expect(evaluateCondition({ field: 'edad', operator: 'gt', value: 18 }, { edad: 20 })).toBe(true);
      expect(evaluateCondition({ field: 'edad', operator: 'gt', value: 18 }, { edad: 18 })).toBe(false);
      expect(evaluateCondition({ field: 'edad', operator: 'gte', value: 18 }, { edad: 18 })).toBe(true);

      expect(evaluateCondition({ field: 'categoria', operator: 'in', value: ['A', 'B'] }, { categoria: 'A' })).toBe(true);
      expect(evaluateCondition({ field: 'categoria', operator: 'in', value: ['A', 'B'] }, { categoria: 'C' })).toBe(false);
      expect(evaluateCondition({ field: 'categoria', operator: 'not_in', value: ['A', 'B'] }, { categoria: 'C' })).toBe(true);
    });

    it('evaluates complex conditions with all and any', () => {
      const condition: Condition = {
        all: [
          { field: 'es_pep', operator: 'eq', value: true },
          {
            any: [
              { field: 'nivel', operator: 'eq', value: 'nacional' },
              { field: 'cargo_critico', operator: 'eq', value: true },
            ],
          },
        ],
      };

      expect(evaluateCondition(condition, { es_pep: true, nivel: 'nacional', cargo_critico: false })).toBe(true);
      expect(evaluateCondition(condition, { es_pep: true, nivel: 'internacional', cargo_critico: true })).toBe(true);
      expect(evaluateCondition(condition, { es_pep: true, nivel: 'internacional', cargo_critico: false })).toBe(false);
      expect(evaluateCondition(condition, { es_pep: false, nivel: 'nacional', cargo_critico: true })).toBe(false);
    });
  });

  describe('isRequirementCurrentlyRequired', () => {
    const baseReq: RequirementDetail = {
      requirementId: '1',
      standard: 'SARLAFT',
      type: 'field',
      key: 'test_field',
      mandatory: 'always',
      blocking: true,
      condition: null,
      validation: null,
    };

    it('returns true for always and false for optional', () => {
      expect(isRequirementCurrentlyRequired({ ...baseReq, mandatory: 'always' }, {})).toBe(true);
      expect(isRequirementCurrentlyRequired({ ...baseReq, mandatory: 'optional' }, {})).toBe(false);
    });

    it('returns evaluated condition result for conditional requirements', () => {
      const conditionalReq: RequirementDetail = {
        ...baseReq,
        mandatory: 'conditional',
        condition: { field: 'es_pep', operator: 'eq', value: true },
      };

      expect(isRequirementCurrentlyRequired(conditionalReq, { es_pep: true })).toBe(true);
      expect(isRequirementCurrentlyRequired(conditionalReq, { es_pep: false })).toBe(false);
      expect(isRequirementCurrentlyRequired(conditionalReq, {})).toBe(false);
    });
  });

  describe('validateFieldValue', () => {
    it('handles empty values without error', () => {
      expect(validateFieldValue('', { dataType: 'string' })).toBeNull();
      expect(validateFieldValue(null, { dataType: 'number' })).toBeNull();
      expect(validateFieldValue(undefined, { dataType: 'date' })).toBeNull();
    });

    it('validates string dataType with min, max, and format', () => {
      const val = { dataType: 'string' as const, min: 3, max: 10, format: '^[A-Z]+$' };
      expect(validateFieldValue('ABC', val)).toBeNull();
      expect(validateFieldValue('AB', val)).toBe('Debe tener al menos 3 caracteres');
      expect(validateFieldValue('ABCDEFGHIJKL', val)).toBe('No puede exceder 10 caracteres');
      expect(validateFieldValue('abc', val)).toBe('El formato ingresado no es válido');
    });

    it('validates number dataType with min and max', () => {
      const val = { dataType: 'number' as const, min: 10, max: 100 };
      expect(validateFieldValue(50, val)).toBeNull();
      expect(validateFieldValue('50', val)).toBeNull();
      expect(validateFieldValue('invalid', val)).toBe('El valor debe ser un número válido');
      expect(validateFieldValue(5, val)).toBe('El valor mínimo permitido es 10');
      expect(validateFieldValue(150, val)).toBe('El valor máximo permitido es 100');
    });

    it('validates enum values', () => {
      const val = { dataType: 'enum' as const, enumValues: ['REGIMEN_COMUN', 'REGIMEN_SIMPLIFICADO'] };
      expect(validateFieldValue('REGIMEN_COMUN', val)).toBeNull();
      expect(validateFieldValue('OTRO', val)).toContain('Opción no permitida');
    });

    it('validates date and boolean', () => {
      expect(validateFieldValue('2026-09-10', { dataType: 'date' })).toBeNull();
      expect(validateFieldValue('invalid-date', { dataType: 'date' })).toBe('Fecha no válida');

      expect(validateFieldValue(true, { dataType: 'boolean' })).toBeNull();
      expect(validateFieldValue('true', { dataType: 'boolean' })).toBeNull();
      expect(validateFieldValue('not-a-bool', { dataType: 'boolean' })).toBe('Debe seleccionar Sí o No');
    });
  });
});
