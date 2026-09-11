'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { inviteMember, revokeInvitation } from '@/server/organizations/invitations';

const inviteMemberSchema = z.object({
  email: z.string().email('Ingrese un correo electrónico válido'),
  role: z.string().min(1, 'Seleccione un rol válido'),
});

export interface MemberActionState {
  success?: boolean;
  error?: string;
  message?: string;
  rawToken?: string;
}

export async function inviteMemberAction(
  organizationId: string,
  _prevState: MemberActionState | null,
  formData: FormData,
): Promise<MemberActionState> {
  const userId = await requireAuthenticatedUserId();
  const rawEmail = formData.get('email');
  const rawRole = formData.get('role');

  const parsed = inviteMemberSchema.safeParse({
    email: typeof rawEmail === 'string' ? rawEmail.trim() : '',
    role: typeof rawRole === 'string' ? rawRole.trim() : '',
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Datos de invitación inválidos',
    };
  }

  try {
    const detail = await inviteMember({
      callerUserId: userId,
      organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
    });
    revalidatePath('/app', 'layout');
    return {
      success: true,
      message: `Invitación enviada a ${parsed.data.email}`,
      rawToken: detail.rawToken,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al enviar la invitación';
    return { success: false, error: message };
  }
}

export async function revokeInvitationAction(
  organizationId: string,
  invitationId: string,
): Promise<{ success: boolean; error?: string }> {
  const userId = await requireAuthenticatedUserId();

  try {
    await revokeInvitation(userId, organizationId, invitationId);
    revalidatePath('/app', 'layout');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al revocar la invitación';
    return { success: false, error: message };
  }
}
