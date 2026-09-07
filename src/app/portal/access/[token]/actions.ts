'use server';

import { cookies } from 'next/headers';
import { verifyOtpCode } from '@/server/privileged/portal-access';
import { signPortalSession } from '@/server/auth/portal-session';

export interface VerifyOtpActionResult {
  success: boolean;
  error?: string;
}

export async function verifyPortalOtp(
  accessTokenId: string,
  code: string,
): Promise<VerifyOtpActionResult> {
  if (!code || code.trim().length !== 6) {
    return { success: false, error: 'Ingrese el código de 6 dígitos completo.' };
  }

  const result = await verifyOtpCode(accessTokenId, code);

  if (!result.verified) {
    return { success: false, error: result.reason || 'Código inválido.' };
  }

  // Sign cookie with HMAC-SHA256
  const sessionToken = signPortalSession({
    accessTokenId,
    verifiedAt: Date.now(),
  });

  const cookieStore = await cookies();
  cookieStore.set('portal_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/portal',
    maxAge: 72 * 60 * 60, // 72 hours
  });

  return { success: true };
}
