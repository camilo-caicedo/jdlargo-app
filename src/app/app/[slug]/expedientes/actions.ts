'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { checkUserPermission } from '@/server/auth/access-control';
import { createDossierRequest, updateDossierAdministrativeData } from '@/server/dossiers/dossier';
import { issueAccessLink, revokeAccessLink } from '@/server/dossiers/access';
import {
  getDocumentDownloadUrl,
  markDocumentValid,
  rejectDocument,
} from '@/server/documents/document';
import {
  completeReview,
  requestCorrections,
} from '@/server/dossiers/review';
import { recordDecision, type EvidenceRef } from '@/server/dossiers/decision';
import { executeTransition } from '@/server/dossiers/state-machine';
import { runExtractionForPendingDocuments } from '@/server/extraction/service';

const createDossierSchema = z.object({
  counterpartyTypeName: z.string().min(1, 'Seleccione un tipo de contraparte'),
  identificationType: z.string().min(1, 'Seleccione un tipo de documento'),
  identificationNumber: z.string().min(3, 'El número de identificación debe tener al menos 3 caracteres'),
  declaredName: z.string().min(2, 'La razón social o nombre debe tener al menos 2 caracteres'),
  internalOwnerId: z.string().uuid('Seleccione un responsable interno válido'),
  deadline: z.string().optional(),
  recipientEmail: z.string().email('Ingrese un correo válido').optional().or(z.literal('')),
  requiresSecondFactor: z.boolean().optional(),
});

export interface CreateDossierFormState {
  error?: string;
  success?: boolean;
  dossierId?: string;
  rawToken?: string;
}

export async function createDossierAction(
  organizationId: string,
  slug: string,
  _prevState: CreateDossierFormState | null,
  formData: FormData,
): Promise<CreateDossierFormState> {
  const userId = await requireAuthenticatedUserId();

  const rawData = {
    counterpartyTypeName: formData.get('counterpartyTypeName'),
    identificationType: formData.get('identificationType'),
    identificationNumber: formData.get('identificationNumber'),
    declaredName: formData.get('declaredName'),
    internalOwnerId: formData.get('internalOwnerId'),
    deadline: formData.get('deadline'),
    recipientEmail: formData.get('recipientEmail'),
    requiresSecondFactor: formData.get('requiresSecondFactor') === 'on' || formData.get('requiresSecondFactor') === 'true',
  };

  const parsed = createDossierSchema.safeParse({
    counterpartyTypeName: typeof rawData.counterpartyTypeName === 'string' ? rawData.counterpartyTypeName.trim() : '',
    identificationType: typeof rawData.identificationType === 'string' ? rawData.identificationType.trim() : '',
    identificationNumber: typeof rawData.identificationNumber === 'string' ? rawData.identificationNumber.trim() : '',
    declaredName: typeof rawData.declaredName === 'string' ? rawData.declaredName.trim() : '',
    internalOwnerId: typeof rawData.internalOwnerId === 'string' ? rawData.internalOwnerId.trim() : '',
    deadline: typeof rawData.deadline === 'string' && rawData.deadline ? rawData.deadline.trim() : undefined,
    recipientEmail: typeof rawData.recipientEmail === 'string' && rawData.recipientEmail ? rawData.recipientEmail.trim() : '',
    requiresSecondFactor: rawData.requiresSecondFactor,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message || 'Datos del formulario inválidos',
    };
  }

  let createdDossierId: string;

  try {
    const deadlineDate = parsed.data.deadline ? new Date(parsed.data.deadline) : undefined;
    const dossier = await createDossierRequest({
      organizationId,
      requestedBy: userId,
      counterpartyTypeName: parsed.data.counterpartyTypeName,
      party: {
        identificationType: parsed.data.identificationType,
        identificationNumber: parsed.data.identificationNumber,
        declaredName: parsed.data.declaredName,
      },
      internalOwnerId: parsed.data.internalOwnerId,
      deadline: deadlineDate,
    });
    createdDossierId = dossier.id;
  } catch (err: unknown) {
    console.error('[createDossierAction] Error creating dossier request:', err);
    return {
      error: err instanceof Error ? err.message : 'Error al abrir el expediente',
    };
  }

  // If email was provided, issue access link immediately
  let rawTokenResult: string | undefined;
  if (parsed.data.recipientEmail) {
    try {
      const link = await issueAccessLink({
        organizationId,
        dossierId: createdDossierId,
        issuedBy: userId,
        requiresSecondFactor: parsed.data.requiresSecondFactor ?? false,
        recipientEmail: parsed.data.recipientEmail,
      });
      rawTokenResult = link.rawToken;
    } catch (linkErr) {
      console.error('[createDossierAction] Error issuing access link:', linkErr);
    }
  }

  revalidatePath('/app', 'layout');
  const tokenQuery = rawTokenResult ? '?token=' + encodeURIComponent(rawTokenResult) : '';
  redirect('/app/' + slug + '/expedientes/' + createdDossierId + tokenQuery);
}

export async function issueNewAccessLinkAction(
  organizationId: string,
  dossierId: string,
  slug: string,
  _prevState: { success?: boolean; error?: string; rawToken?: string } | null,
  formData: FormData,
): Promise<{ success?: boolean; error?: string; rawToken?: string }> {
  const userId = await requireAuthenticatedUserId();
  const recipientEmail = formData.get('recipientEmail');
  const requiresSecondFactor = formData.get('requiresSecondFactor') === 'on' || formData.get('requiresSecondFactor') === 'true';

  if (typeof recipientEmail !== 'string' || !recipientEmail.trim() || !recipientEmail.includes('@')) {
    return { error: 'Ingrese un correo electrónico válido' };
  }

  try {
    const link = await issueAccessLink({
      organizationId,
      dossierId,
      issuedBy: userId,
      requiresSecondFactor,
      recipientEmail: recipientEmail.trim(),
    });

    revalidatePath('/app', 'layout');
    return {
      success: true,
      rawToken: link.rawToken,
    };
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : 'Error al emitir el enlace de acceso',
    };
  }
}

const updateDossierSchema = z.object({
  internalOwnerId: z.string().uuid('Seleccione un responsable interno válido').optional().or(z.literal('')),
  deadline: z.string().optional(),
});

export interface UpdateDossierFormState {
  success?: boolean;
  error?: string;
}

export async function updateDossierAction(
  organizationId: string,
  dossierId: string,
  _slug: string,
  _prevState: UpdateDossierFormState | null,
  formData: FormData,
): Promise<UpdateDossierFormState> {
  const userId = await requireAuthenticatedUserId();

  const rawOwner = formData.get('internalOwnerId');
  const rawDeadline = formData.get('deadline');

  const parsed = updateDossierSchema.safeParse({
    internalOwnerId: typeof rawOwner === 'string' ? rawOwner.trim() : undefined,
    deadline: typeof rawDeadline === 'string' ? rawDeadline.trim() : undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message || 'Datos de actualización inválidos',
    };
  }

  const internalOwnerId = parsed.data.internalOwnerId ? parsed.data.internalOwnerId : undefined;
  // If deadline field is empty string, user wants to clear it (null); if provided, Date; if undefined, undefined
  const deadline =
    parsed.data.deadline === ''
      ? null
      : parsed.data.deadline
        ? new Date(parsed.data.deadline)
        : undefined;

  try {
    await updateDossierAdministrativeData({
      organizationId,
      dossierId,
      updatedBy: userId,
      internalOwnerId,
      deadline,
    });

    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : 'Error al actualizar el expediente',
    };
  }
}

export async function downloadDocumentAction(
  organizationId: string,
  dossierId: string,
  documentId: string,
): Promise<{ success: boolean; url?: string; integrityMatches?: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  try {
    const result = await getDocumentDownloadUrl({
      organizationId,
      dossierId,
      documentId,
      requestedBy: { userId },
    });

    return { success: true, url: result.url, integrityMatches: result.integrityMatches };
  } catch (err: unknown) {
    console.error('[downloadDocumentAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al generar la URL de descarga',
    };
  }
}

export async function markDocumentValidAction(
  organizationId: string,
  dossierId: string,
  documentId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  try {
    await markDocumentValid({
      organizationId,
      dossierId,
      documentId,
      reviewedBy: userId,
    });

    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    console.error('[markDocumentValidAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al marcar documento como válido',
    };
  }
}

export async function rejectDocumentAction(
  organizationId: string,
  dossierId: string,
  documentId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  if (!reason || reason.trim() === '') {
    return { success: false, error: 'Debe indicar un motivo explícito para rechazar el documento' };
  }

  try {
    await rejectDocument({
      organizationId,
      dossierId,
      documentId,
      reviewedBy: userId,
      reason: reason.trim(),
    });

    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    console.error('[rejectDocumentAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al rechazar el documento',
    };
  }
}

export async function requestCorrectionsAction(
  organizationId: string,
  dossierId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  if (!reason || reason.trim() === '') {
    return { success: false, error: 'Debe ingresar un motivo para solicitar correcciones' };
  }

  try {
    await requestCorrections({
      organizationId,
      dossierId,
      requestedBy: userId,
      reason: reason.trim(),
    });

    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    console.error('[requestCorrectionsAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al solicitar correcciones',
    };
  }
}

export async function completeReviewAction(
  organizationId: string,
  dossierId: string,
  overrideReason?: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  try {
    await completeReview({
      organizationId,
      dossierId,
      reviewedBy: userId,
      override: overrideReason && overrideReason.trim() !== '' ? { reason: overrideReason.trim() } : undefined,
    });

    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    console.error('[completeReviewAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al dar por revisado el expediente',
    };
  }
}

export async function recordDecisionAction(input: {
  organizationId: string;
  dossierId: string;
  type: 'approve' | 'approve_with_conditions' | 'reject';
  title: string;
  rationale: string;
  evidence: EvidenceRef[];
  validUntil: string;
  conditions?: string[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const userId = await requireAuthenticatedUserId();

  if (!input.title || input.title.trim() === '') {
    return { success: false, error: 'El cargo del responsable es obligatorio' };
  }

  if (!input.rationale || input.rationale.trim() === '') {
    return { success: false, error: 'El fundamento de la decisión es obligatorio' };
  }

  if (!input.evidence || input.evidence.length === 0) {
    return { success: false, error: 'Debe seleccionar al menos una evidencia' };
  }

  const validUntilDate = new Date(input.validUntil);
  if (isNaN(validUntilDate.getTime()) || validUntilDate.getTime() <= Date.now()) {
    return { success: false, error: 'La fecha de vigencia debe ser una fecha futura válida' };
  }

  if (input.type === 'approve_with_conditions') {
    const cleanConds = (input.conditions || []).filter((c) => c && c.trim() !== '');
    if (cleanConds.length === 0) {
      return { success: false, error: 'Debe especificar al menos una condición para aprobar con condiciones' };
    }
  }

  try {
    const result = await recordDecision({
      organizationId: input.organizationId,
      dossierId: input.dossierId,
      type: input.type,
      responsibleId: userId,
      title: input.title.trim(),
      rationale: input.rationale.trim(),
      evidence: input.evidence,
      validUntil: validUntilDate,
      conditions: input.type === 'approve_with_conditions'
        ? (input.conditions || []).filter((c) => c && c.trim() !== '')
        : undefined,
    });

    revalidatePath('/app', 'layout');
    return { success: true, id: result.id };
  } catch (err: unknown) {
    console.error('[recordDecisionAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al registrar la decisión',
    };
  }
}

export async function closeDossierAction(
  organizationId: string,
  dossierId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  try {
    await executeTransition({
      organizationId,
      dossierId,
      toState: 'cerrada',
      actorType: 'user',
      actorId: userId,
    });

    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    console.error('[closeDossierAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al cerrar el expediente',
    };
  }
}

export async function revokeAccessLinkAction(
  organizationId: string,
  dossierId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();
  try {
    await revokeAccessLink({ organizationId, dossierId, revokedBy: userId });
    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    console.error('[revokeAccessLinkAction] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error al revocar el enlace',
    };
  }
}

export async function runExtractionForPendingDocumentsAction(
  organizationId: string,
  dossierId: string,
  slug: string,
): Promise<{ success?: boolean; summary?: string; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  const perm = await checkUserPermission(userId, organizationId, 'document:review');
  if (!perm.granted) {
    return {
      error: perm.reason || 'No tiene permiso para revisar documentos y ejecutar extracción.',
    };
  }

  try {
    const result = await runExtractionForPendingDocuments(organizationId, dossierId);

    const parts = [`${result.processed} documento(s) procesado(s)`];
    if (result.succeeded > 0) {
      parts.push(`${result.succeeded} con datos extraído(s)`);
    }
    if (result.failed > 0) {
      parts.push(`${result.failed} requiere(n) revisión manual`);
    }

    const summary = parts.join(', ');

    revalidatePath(`/app/${slug}/expedientes/${dossierId}`);
    return { success: true, summary };
  } catch (err: unknown) {
    console.error('[runExtractionForPendingDocumentsAction] Error:', err);
    return {
      error: err instanceof Error ? err.message : 'Error al ejecutar extracción de documentos',
    };
  }
}


