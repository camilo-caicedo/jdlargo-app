'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePostLoginDestination } from '@/server/auth/session';

const signInSchema = z.object({
  email: z.string().email('Ingrese un correo electrónico válido'),
  password: z.string().min(1, 'Ingrese su contraseña'),
});

export interface SignInActionResult {
  success: boolean;
  error?: string;
  defaultEmail?: string;
}

export async function signIn(
  _prevState: SignInActionResult | null,
  formData: FormData,
): Promise<SignInActionResult> {
  const rawEmail = formData.get('email');
  const rawPassword = formData.get('password');
  const emailStr = typeof rawEmail === 'string' ? rawEmail.trim() : '';

  const parsed = signInSchema.safeParse({
    email: emailStr,
    password: typeof rawPassword === 'string' ? rawPassword : '',
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Credenciales inválidas',
      defaultEmail: emailStr,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return {
      success: false,
      error: 'Correo o contraseña incorrectos. Verifique sus credenciales.',
      defaultEmail: emailStr,
    };
  }

  const destination = await resolvePostLoginDestination(data.user.id);

  if (destination.kind === 'no_access') {
    return {
      success: false,
      error: 'No tiene acceso a ninguna organización cliente activa.',
      defaultEmail: emailStr,
    };
  }

  if (destination.kind === 'single_org') {
    redirect(`/app/${destination.organizationId}`);
  }

  redirect('/login/organizacion');
}