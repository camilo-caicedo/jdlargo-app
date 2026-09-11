'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { checkUserPermission } from '@/server/auth/access-control';
import {
  createDraftConfiguration,
  publishDraftConfiguration,
} from '@/server/configuration/service';
import {
  addPrivacyNotice,
  privacyNoticePurposeSchema,
} from '@/server/configuration/privacy-notice';

const savePrivacyNoticeSchema = z.object({
  text: z.string().min(10, 'El texto del aviso debe tener al menos 10 caracteres'),
  dataController: z.string().min(2, 'El responsable del tratamiento es requerido'),
  dataProcessor: z.string().min(2, 'El encargado del tratamiento es requerido'),
  rightsChannels: z.string().min(5, 'Los canales para ejercicio de derechos son requeridos'),
  purposes: z.array(privacyNoticePurposeSchema).min(1, 'Debe especificar al menos una finalidad'),
});

export interface PrivacyNoticeFormState {
  error?: string;
  success?: boolean;
}

export async function savePrivacyNoticeAction(
  organizationId: string,
  versionId: string,
  slug: string,
  _prevState: PrivacyNoticeFormState | null,
  formData: FormData,
): Promise<PrivacyNoticeFormState> {
  const userId = await requireAuthenticatedUserId();

  const permCheck = await checkUserPermission(userId, organizationId, 'configuration:administer');
  if (!permCheck.granted) {
    return {
      error: permCheck.reason || 'No tiene permisos para modificar la configuración de la organización.',
    };
  }

  const text = formData.get('text');
  const dataController = formData.get('dataController');
  const dataProcessor = formData.get('dataProcessor');
  const rightsChannels = formData.get('rightsChannels');
  const purposesRaw = formData.get('purposes');

  let parsedPurposes: unknown[] = [];
  try {
    if (typeof purposesRaw === 'string') {
      parsedPurposes = JSON.parse(purposesRaw);
    }
  } catch {
    return { error: 'El formato de finalidades es inválido.' };
  }

  const parsed = savePrivacyNoticeSchema.safeParse({
    text: typeof text === 'string' ? text.trim() : '',
    dataController: typeof dataController === 'string' ? dataController.trim() : '',
    dataProcessor: typeof dataProcessor === 'string' ? dataProcessor.trim() : '',
    rightsChannels: typeof rightsChannels === 'string' ? rightsChannels.trim() : '',
    purposes: parsedPurposes,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message || 'Datos del formulario inválidos',
    };
  }

  try {
    await addPrivacyNotice({
      organizationId,
      configurationVersionId: versionId,
      text: parsed.data.text,
      dataController: parsed.data.dataController,
      dataProcessor: parsed.data.dataProcessor,
      rightsChannels: parsed.data.rightsChannels,
      purposes: parsed.data.purposes,
    });

    revalidatePath(`/app/${slug}/configuracion`);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar el aviso de privacidad';
    return { error: msg };
  }
}

export async function createDraftForEditingAction(
  organizationId: string,
  slug: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  const permCheck = await checkUserPermission(userId, organizationId, 'configuration:administer');
  if (!permCheck.granted) {
    return {
      success: false,
      error: permCheck.reason || 'No tiene permisos para crear borradores de configuración.',
    };
  }

  try {
    await createDraftConfiguration({
      organizationId,
    });

    revalidatePath(`/app/${slug}/configuracion`);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear borrador de configuración';
    return { success: false, error: msg };
  }
}

export interface PublishFormState {
  error?: string;
  success?: boolean;
}

export async function publishDraftAction(
  organizationId: string,
  versionId: string,
  slug: string,
  _prevState: PublishFormState | null,
  formData: FormData,
): Promise<PublishFormState> {
  const userId = await requireAuthenticatedUserId();

  const rawReason = formData.get('reason');
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';

  if (!reason) {
    return { error: 'Debe ingresar un motivo explícito para publicar la versión.' };
  }

  try {
    await publishDraftConfiguration({
      organizationId,
      versionId,
      publishedBy: userId,
      reason,
    });

    revalidatePath(`/app/${slug}/configuracion`);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al publicar la versión de configuración';
    return { error: msg };
  }
}
