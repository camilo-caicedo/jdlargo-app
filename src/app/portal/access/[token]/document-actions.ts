'use server';

import { revalidatePath } from 'next/cache';
import { executePrivilegedSystemOperation } from '@/server/privileged/system-execution';
import { verifyTokenGrantsAccess } from '@/server/privileged/portal-access';
import {
  requestDocumentUpload,
  readAndValidateUploadedFile,
  confirmDocumentUpload,
  getPortalDocumentDownloadUrl,
} from '@/server/documents/document';

export async function requestDocumentUploadUrlAction(
  token: string,
  dossierId: string,
  organizationId: string,
  documentType: string,
  fileName: string,
  declaredSize: number,
  declaredMimeType: string,
): Promise<{
  success: boolean;
  error?: string;
  signedUrl?: string;
  uploadToken?: string;
  storagePath?: string;
}> {
  try {
    if (!(await verifyTokenGrantsAccess(token, dossierId, organizationId))) {
      return { success: false, error: 'El enlace de acceso no es válido para este expediente' };
    }

    const result = await requestDocumentUpload({
      organizationId,
      dossierId,
      documentType,
      fileName,
      declaredSize,
      declaredMimeType,
    });

    return {
      success: true,
      signedUrl: result.signedUrl,
      uploadToken: result.uploadToken,
      storagePath: result.storagePath,
    };
  } catch (error) {
    console.error('[requestDocumentUploadUrlAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al generar la URL de subida',
    };
  }
}

export async function confirmDocumentUploadAction(
  token: string,
  dossierId: string,
  organizationId: string,
  documentType: string,
  storagePath: string,
  declaredIssuer?: string,
  issuedAt?: string,
  expiresAt?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(await verifyTokenGrantsAccess(token, dossierId, organizationId))) {
      return { success: false, error: 'El enlace de acceso no es válido para este expediente' };
    }

    // 1. Validar el archivo descargándolo de storage (magic bytes + hash + tamaño real) fuera de la DB tx
    const validated = await readAndValidateUploadedFile(storagePath);

    // 2. Confirmar en base de datos con sistema privilegiado
    await executePrivilegedSystemOperation(
      {
        action: 'portal.confirm_document_upload',
        organizationId,
        metadata: {
          dossier_id: dossierId,
          document_type: documentType,
          hash: validated.hash,
          format: validated.format,
          size: validated.size,
        },
        description: 'Confirm counterparty document upload via portal access',
      },
      async (tx) => {
        await confirmDocumentUpload(
          {
            organizationId,
            dossierId,
            documentType,
            storagePath,
            hash: validated.hash,
            format: validated.format,
            size: validated.size,
            declaredIssuer,
            issuedAt,
            expiresAt,
            uploadedByType: 'counterparty',
          },
          tx,
        );
      },
    );

    revalidatePath(`/portal/access/${token}`);
    return { success: true };
  } catch (error) {
    console.error('[confirmDocumentUploadAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al confirmar la subida del documento',
    };
  }
}

export async function getPortalDocumentDownloadUrlAction(
  token: string,
  dossierId: string,
  organizationId: string,
  documentId: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    if (!(await verifyTokenGrantsAccess(token, dossierId, organizationId))) {
      return { success: false, error: 'El enlace de acceso no es válido para este expediente' };
    }

    const url = await getPortalDocumentDownloadUrl({
      organizationId,
      dossierId,
      documentId,
    });

    return { success: true, url };
  } catch (error) {
    console.error('[getPortalDocumentDownloadUrlAction] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener URL de descarga',
    };
  }
}
