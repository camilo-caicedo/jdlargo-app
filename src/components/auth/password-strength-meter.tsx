'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { evaluatePasswordStrength, MIN_PASSWORD_LENGTH } from '@/lib/auth/password-policy';

interface PasswordStrengthMeterProps {
  password?: string;
  className?: string;
}

export function PasswordStrengthMeter({ password = '', className = '' }: PasswordStrengthMeterProps) {
  const result = evaluatePasswordStrength(password);

  if (!password) {
    return null;
  }

  // Get color for progress bar
  const getBarColor = (score: number) => {
    if (score <= 2) return 'bg-red-500';
    if (score <= 4) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getStrengthLabel = (score: number) => {
    if (score <= 2) return 'Débil';
    if (score <= 4) return 'Moderada';
    return 'Fuerte y segura';
  };

  const getLabelColor = (score: number) => {
    if (score <= 2) return 'text-red-600 dark:text-red-400';
    if (score <= 4) return 'text-amber-600 dark:text-amber-400';
    return 'text-emerald-600 dark:text-emerald-400';
  };

  const rules = [
    { label: `Mínimo ${MIN_PASSWORD_LENGTH} caracteres`, passed: result.hasMinLength },
    { label: 'Al menos una mayúscula (A-Z)', passed: result.hasUppercase },
    { label: 'Al menos una minúscula (a-z)', passed: result.hasLowercase },
    { label: 'Al menos un número (0-9)', passed: result.hasNumber },
    { label: 'Al menos un carácter especial (!@#$...)', passed: result.hasSpecialChar },
  ];

  return (
    <div className={`space-y-2 pt-1 text-xs ${className}`}>
      {/* Visual Bar Indicator */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 flex gap-1 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
          {[1, 2, 3, 4, 5].map((level) => (
            <div
              key={level}
              className={`flex-1 transition-all duration-300 ${
                level <= result.score ? getBarColor(result.score) : 'bg-transparent'
              }`}
            />
          ))}
        </div>
        <span className={`text-[11px] font-medium tracking-tight ${getLabelColor(result.score)}`}>
          {getStrengthLabel(result.score)}
        </span>
      </div>

      {/* Rules Checklist */}
      <ul className="space-y-1 text-zinc-500 dark:text-zinc-400">
        {rules.map((r, idx) => (
          <li key={idx} className="flex items-center gap-1.5">
            {r.passed ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <X className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-700 shrink-0" />
            )}
            <span className={r.passed ? 'text-zinc-700 dark:text-zinc-300 font-medium' : ''}>
              {r.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}