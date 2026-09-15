import { z } from 'zod';

export const documentValiditySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('no_expiration') }),
  z.object({ mode: z.literal('duration_from_issued'), durationDays: z.number().int().positive() }),
  z.object({ mode: z.literal('fixed_date') }),
]);

export type DocumentValidityConfig = z.infer<typeof documentValiditySchema>;

/**
 * Calcula la fecha efectiva de vencimiento según el modo de vigencia configurado.
 * Retorna null si no hay suficiente información para calcularla todavía (p. ej. falta
 * la fecha de expedición en modo duration_from_issued).
 */
export function computeEffectiveExpiry(
  validity: DocumentValidityConfig,
  issuedAt: string | null,
  expiresAt: string | null,
): Date | null {
  if (validity.mode === 'no_expiration') return null;
  if (validity.mode === 'fixed_date') {
    return expiresAt ? new Date(expiresAt) : null;
  }
  // duration_from_issued
  if (!issuedAt) return null;
  return new Date(new Date(issuedAt).getTime() + validity.durationDays * 24 * 60 * 60 * 1000);
}
