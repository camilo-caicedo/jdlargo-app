import { describe, it, expect } from 'vitest';
import { evaluatePasswordStrength, passwordPolicySchema } from './password-policy';

describe('Password Policy', () => {
  describe('evaluatePasswordStrength', () => {
    it('evaluates weak passwords correctly', () => {
      const result = evaluatePasswordStrength('abc');
      expect(result.hasMinLength).toBe(false);
      expect(result.hasUppercase).toBe(false);
      expect(result.hasLowercase).toBe(true);
      expect(result.hasNumber).toBe(false);
      expect(result.hasSpecialChar).toBe(false);
      expect(result.score).toBe(1);
      expect(result.isValid).toBe(false);
    });

    it('evaluates compliant passwords correctly', () => {
      const result = evaluatePasswordStrength('Pass1234!');
      expect(result.hasMinLength).toBe(true);
      expect(result.hasUppercase).toBe(true);
      expect(result.hasLowercase).toBe(true);
      expect(result.hasNumber).toBe(true);
      expect(result.hasSpecialChar).toBe(true);
      expect(result.score).toBe(5);
      expect(result.isValid).toBe(true);
    });
  });

  describe('passwordPolicySchema', () => {
    it('fails when length is less than 8', () => {
      const parsed = passwordPolicySchema.safeParse('Ab1!');
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain('al menos 8 caracteres');
      }
    });

    it('fails when missing uppercase', () => {
      const parsed = passwordPolicySchema.safeParse('password123!');
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain('letra mayúscula');
      }
    });

    it('fails when missing lowercase', () => {
      const parsed = passwordPolicySchema.safeParse('PASSWORD123!');
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain('letra minúscula');
      }
    });

    it('fails when missing number', () => {
      const parsed = passwordPolicySchema.safeParse('Password!!!!');
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain('al menos un número');
      }
    });

    it('fails when missing special character', () => {
      const parsed = passwordPolicySchema.safeParse('Password1234');
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain('carácter especial');
      }
    });

    it('succeeds with strong password', () => {
      const parsed = passwordPolicySchema.safeParse('ClaveSegura2026!');
      expect(parsed.success).toBe(true);
    });
  });
});
