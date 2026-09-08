import { z } from 'zod';

export interface PasswordRulesBreakdown {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
  score: number; // 0 to 5
  isValid: boolean;
}

export const MIN_PASSWORD_LENGTH = 8;
export const SPECIAL_CHARS_REGEX = /[^a-zA-Z0-9]/;

export function evaluatePasswordStrength(password: string): PasswordRulesBreakdown {
  const pwd = password || '';
  const hasMinLength = pwd.length >= MIN_PASSWORD_LENGTH;
  const hasUppercase = /[A-Z]/.test(pwd);
  const hasLowercase = /[a-z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasSpecialChar = SPECIAL_CHARS_REGEX.test(pwd);

  const rulesPassed = [
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar,
  ].filter(Boolean).length;

  return {
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar,
    score: rulesPassed,
    isValid: rulesPassed === 5,
  };
}

export const passwordPolicySchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
  .refine((val) => /[A-Z]/.test(val), {
    message: 'Debe contener al menos una letra mayúscula',
  })
  .refine((val) => /[a-z]/.test(val), {
    message: 'Debe contener al menos una letra minúscula',
  })
  .refine((val) => /[0-9]/.test(val), {
    message: 'Debe contener al menos un número',
  })
  .refine((val) => SPECIAL_CHARS_REGEX.test(val), {
    message: 'Debe contener un carácter que no sea letra ni número (incluye tildes o espacios)',
  });