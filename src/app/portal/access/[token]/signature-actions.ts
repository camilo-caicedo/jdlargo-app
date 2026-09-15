'use server';

import { headers } from 'next/headers';
import { verifyTokenGrantsAccess } from '@/server/privileged/portal-access';
import { requestSignatureOtp, signDossier } from '@/server/signature/service';
import { getDossierById } from '@/server/dossiers/dossier';
import { revalidatePath } from 'next/cache';

export async function requestSignatureOtpAction(
  token: string,
  accessTokenId: string,
  dossierId: string,
  organizationId: string,
): Promise<{ success?: true; error?: string }> {
  // Verify token still valid and matches access token
  const tokenValid = await verifyTokenGrantsAccess(token, dossierId, organizationId);
  if (!tokenValid) {
    return { error: 'Enlace de acceso inválido o expirado' };
  }

  try {
    await requestSignatureOtp(accessTokenId);
    return { success: true };
  } catch (error) {
    console.error('[requestSignatureOtpAction]', error);
    return { error: 'Error al enviar código de verificación' };
  }
}

export async function signDossierAction(
  token: string,
  dossierId: string,
  organizationId: string,
  accessTokenId: string,
  otpCode?: string,
): Promise<{ success?: true; error?: string }> {
  const headerStore = await headers();
  const ipAddress =
    headerStore.get('x-forwarded-for')?.split(',')[0].trim() ||
    headerStore.get('x-real-ip') ||
    '127.0.0.1';

  // Verify token still valid
  const tokenValid = await verifyTokenGrantsAccess(token, dossierId, organizationId);
  if (!tokenValid) {
    return { error: 'Enlace de acceso inválido o expirado' };
  }

  // Get dossier to access partyId
  const dossierRecord = await getDossierById(organizationId, dossierId);
  if (!dossierRecord || !dossierRecord.partyId) {
    return { error: 'No se pudo obtener información del expediente' };
  }

  try {
    const result = await signDossier(
      {
        organizationId,
        dossierId,
        partyId: dossierRecord.partyId,
        ipAddress,
        accessTokenId,
        otpCode,
      },
    );

    if (!result.success) {
      return { error: result.error };
    }

    revalidatePath(`/portal/access/${token}`);
    return { success: true };
  } catch (error) {
    console.error('[signDossierAction]', error);
    return { error: 'Error al firmar el expediente' };
  }
}
