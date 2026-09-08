'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAuthenticatedUserId, resolvePostLoginDestination } from '@/server/auth/session';

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

  if (!password || password.length < 8) {
    return {
      status: 'error',
      error: 'La nueva contraseña debe tener al menos 8 caracteres.',
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
    redirect(`/app/${destination.organizationId}`);
  }

  if (destination.kind === 'select_org') {
    redirect('/login/organizacion');
  }

  redirect('/login?error=no_org');
}