'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  acceptInvitationAsNewUser,
  acceptInvitationForExistingUser,
} from '@/server/privileged/invitation-acceptance';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePostLoginDestination } from '@/server/auth/session';

const setupAccountSchema = z.object({
  fullName: z.string().min(2, 'El nombre completo debe tener al menos 2 caracteres'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

const loginAndAcceptSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(1, 'Ingrese su contraseña'),
});

export interface InvitationActionResult {
  success: boolean;
  error?: string;
}

/**
 * Server action to register user and accept invitation.
 */
export async function acceptAsNewUserAction(
  token: string,
  _prevState: InvitationActionResult | null,
  formData: FormData,
): Promise<InvitationActionResult> {
  const rawFullName = formData.get('fullName');
  const rawPassword = formData.get('password');

  const parsed = setupAccountSchema.safeParse({
    fullName: typeof rawFullName === 'string' ? rawFullName.trim() : '',
    password: typeof rawPassword === 'string' ? rawPassword : '',
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Datos inválidos',
    };
  }

  let createdUserId: string;
  try {
    const res = await acceptInvitationAsNewUser(token, parsed.data);
    createdUserId = res.userId;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al procesar la invitación';
    return { success: false, error: message };
  }

  // Automatically sign in the new user session
  // We first fetch email by resolving invitation or we log in with credentials
  const emailRaw = formData.get('email');
  if (typeof emailRaw === 'string' && emailRaw) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signInWithPassword({
      email: emailRaw.trim().toLowerCase(),
      password: parsed.data.password,
    });
  }

  const destination = await resolvePostLoginDestination(createdUserId);
  if (destination.kind === 'single_org') {
    redirect(`/app/${destination.organizationId}`);
  } else if (destination.kind === 'select_org') {
    redirect('/login/organizacion');
  } else {
    redirect('/login');
  }
}

/**
 * Server action for existing user to sign in and accept invitation.
 */
export async function acceptForExistingUserAction(
  token: string,
  _prevState: InvitationActionResult | null,
  formData: FormData,
): Promise<InvitationActionResult> {
  const rawEmail = formData.get('email');
  const rawPassword = formData.get('password');

  const parsed = loginAndAcceptSchema.safeParse({
    email: typeof rawEmail === 'string' ? rawEmail.trim() : '',
    password: typeof rawPassword === 'string' ? rawPassword : '',
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Credenciales inválidas',
    };
  }

  // 1. Authenticate with Supabase
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (authError || !authData.user) {
    return {
      success: false,
      error: 'Correo o contraseña incorrectos. Verifique sus credenciales.',
    };
  }

  // 2. Accept invitation for existing authenticated user
  try {
    await acceptInvitationForExistingUser(token, authData.user.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al aceptar la invitación';
    return { success: false, error: message };
  }

  const destination = await resolvePostLoginDestination(authData.user.id);
  if (destination.kind === 'single_org') {
    redirect(`/app/${destination.organizationId}`);
  } else if (destination.kind === 'select_org') {
    redirect('/login/organizacion');
  } else {
    redirect('/login');
  }
}
