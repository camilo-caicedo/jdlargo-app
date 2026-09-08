'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { createDossierRequest } from '@/server/dossiers/dossier';
import { issueAccessLink } from '@/server/dossiers/access';

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
