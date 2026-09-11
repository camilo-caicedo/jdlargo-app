'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { executePrivilegedSystemOperation } from '@/server/privileged/system-execution';
import { recordConsent } from '@/server/consent/consent';
import { verifyTokenGrantsAccess } from '@/server/privileged/portal-access';

export interface ConsentActionResult {
  success: boolean;
  error?: string;
}

export async function submitConsentAction(
  token: string,
  dossierId: string,
  organizationId: string,
  privacyNoticeId: string,
  result: 'accepted' | 'not_accepted',
): Promise<ConsentActionResult> {
  try {
    if (!(await verifyTokenGrantsAccess(token, dossierId, organizationId))) {
      return { success: false, error: 'El enlace de acceso no es válido para este expediente' };
    }

    const headerStore = await headers();
    const ipAddress =
      headerStore.get('x-forwarded-for')?.split(',')[0].trim() ||
      headerStore.get('x-real-ip') ||
      '127.0.0.1';

    await executePrivilegedSystemOperation(
      {
        action: 'portal.record_consent',
        organizationId,
        metadata: {
          dossier_id: dossierId,
          privacy_notice_id: privacyNoticeId,
          result,
          ip_address: ipAddress,
        },
        description: 'Record counterparty consent response via portal access',
      },
      async (tx) => {
        await recordConsent(
          {
            organizationId,
            dossierId,
            privacyNoticeId,
            result,
            channel: 'portal',
            ipAddress,
          },
          tx,
        );
      },
    );

    revalidatePath(`/portal/access/${token}`);
    return { success: true };
  } catch (error) {
    console.error('[submitConsentAction] Error recording consent:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado al registrar el consentimiento',
    };
  }
}
