'use server';

import { revalidatePath } from 'next/cache';
import { executePrivilegedSystemOperation } from '@/server/privileged/system-execution';
import {
  saveDeclaredFields,
  completeDeclaration,
  IncompleteDeclarationError,
} from '@/server/dossiers/declaration';

export async function saveDeclaredFieldsAction(
  token: string,
  dossierId: string,
  organizationId: string,
  values: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    await executePrivilegedSystemOperation(
      {
        action: 'portal.save_declaration',
        organizationId,
        metadata: {
          dossier_id: dossierId,
          fields_count: Object.keys(values).length,
        },
        description: 'Save partial counterparty declaration via portal access',
      },
      async (tx) => {
        await saveDeclaredFields(
          {
            organizationId,
            dossierId,
            fields: values,
          },
          tx,
        );
      },
    );

    revalidatePath(`/portal/access/${token}`);
    return { success: true };
  } catch (error) {
    console.error('[saveDeclaredFieldsAction] Error saving declared fields:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado al guardar los datos',
    };
  }
}

export async function completeDeclarationAction(
  token: string,
  dossierId: string,
  organizationId: string,
): Promise<{ success: boolean; error?: string; missingFields?: string[] }> {
  try {
    await executePrivilegedSystemOperation(
      {
        action: 'portal.complete_declaration',
        organizationId,
        metadata: {
          dossier_id: dossierId,
        },
        description: 'Complete counterparty declaration via portal access',
      },
      async (tx) => {
        await completeDeclaration(
          {
            organizationId,
            dossierId,
          },
          tx,
        );
      },
    );

    revalidatePath(`/portal/access/${token}`);
    return { success: true };
  } catch (error) {
    console.error('[completeDeclarationAction] Error completing declaration:', error);
    if (error instanceof IncompleteDeclarationError) {
      return {
        success: false,
        error: error.message,
        missingFields: error.missingFields,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error inesperado al finalizar el diligenciamiento',
    };
  }
}
