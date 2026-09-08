'use client';

import * as React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { evaluatePasswordStrength } from '@/lib/auth/password-policy';

interface PasswordRequirementsListProps {
  password?: string;
  showError?: boolean;
  className?: string;
}

export function PasswordRequirementsList({
  password = '',
  showError = false,
  className = '',
}: PasswordRequirementsListProps) {
  const result = evaluatePasswordStrength(password);
  const hasStartedTyping = password.length > 0;

  const rules = [
    { label: 'Al menos 8 caracteres', passed: result.hasMinLength },
    { label: 'Una letra mayúscula', passed: result.hasUppercase },
    { label: 'Una letra minúscula', passed: result.hasLowercase },
    { label: 'Un número', passed: result.hasNumber },
    { label: 'Un carácter que no sea letra ni número (incluye tildes o espacios)', passed: result.hasSpecialChar },
  ];

  const displayError = showError || (hasStartedTyping && !result.isValid);

  return (
    <div className={`space-y-2 pt-1 text-xs select-none ${className}`}>
      {displayError && (
        <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-normal">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <span>La contraseña no cumple los requisitos de seguridad.</span>
        </div>
      )}

      <ul className="space-y-1.5">
        {rules.map((r, idx) => {
          if (r.passed) {
            return (
              <li key={idx} className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-medium">
                <Check className="h-4 w-4 text-zinc-900 dark:text-zinc-100 shrink-0 stroke-[2.5]" />
                <span>{r.label}</span>
              </li>
            );
          }

          if (displayError) {
            return (
              <li key={idx} className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <span className="inline-block w-3.5 h-3.5 rounded-full border border-red-500 dark:border-red-400 shrink-0 ml-0.5" />
                <span>{r.label}</span>
              </li>
            );
          }

          return (
            <li key={idx} className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <span className="inline-block w-3.5 h-3.5 rounded-full border border-zinc-400 dark:border-zinc-500 shrink-0 ml-0.5" />
              <span>{r.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
