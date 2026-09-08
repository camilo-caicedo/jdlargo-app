'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAuthenticatedUserId, resolvePostLoginDestination } from '@/server/auth/session';

import { passwordPolicySchema } from '@/lib/auth/password-policy';

export interface SetPasswordState {
  status: 'idle' | 'error';
  error?: string;
}

export async function setNewPassword(
  prevState: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const userId = await getAuthenticatedUserId();

  if (!userId) {
    redirect('/recuperar-contrasena?error=session_expired');
  }

  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  const passwordValidation = passwordPolicySchema.safeParse(password);
  if (!passwordValidation.success) {
    return {
      status: 'error',
      error: passwordValidation.error.issues[0]?.message || 'La contraseña no cumple con los requisitos mínimos de seguridad.',
    };
  }

  if (password !== confirmPassword) {
    return {
      status: 'error',
      error: 'Las contraseñas no coinciden.',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    console.error('[setNewPassword] Supabase update user error:', error);
    return {
      status: 'error',
      error: error.message || 'No se pudo actualizar la contraseña. Por favor intenta de nuevo.',
    };
  }

  // Once updated successfully, navigate the user into the app using their active session
  const destination = await resolvePostLoginDestination(userId);

  if (destination.kind === 'single_org') {
    redirect(`/app/${destination.slug}`);
  }

  if (destination.kind === 'select_org') {
    redirect('/login/organizacion');
  }

  redirect('/login?error=no_org');
}