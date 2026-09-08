'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createOrganizationWithAdmin } from '@/server/organizations/use-cases';

const registerSchema = z.object({
  email: z.string().email('Ingrese un correo electrónico válido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  fullName: z.string().min(2, 'El nombre completo debe tener al menos 2 caracteres'),
  orgName: z.string().min(2, 'El nombre de la organización debe tener al menos 2 caracteres'),
});

export interface RegisterState {
  status: 'idle' | 'error' | 'check_email';
  error?: string;
  email?: string;
}

export async function registerAccount(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const rawEmail = formData.get('email');
  const rawPassword = formData.get('password');
  const rawFullName = formData.get('fullName');
  const rawOrgName = formData.get('orgName');

  const parsed = registerSchema.safeParse({
    email: typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '',
    password: typeof rawPassword === 'string' ? rawPassword : '',
    fullName: typeof rawFullName === 'string' ? rawFullName.trim() : '',
    orgName: typeof rawOrgName === 'string' ? rawOrgName.trim() : '',
  });

  if (!parsed.success) {
    return {
      status: 'error',
      error: parsed.error.issues[0]?.message || 'Datos del formulario inválidos',
    };
  }

  const { email, password, fullName, orgName } = parsed.data;

  // Determine origin for confirmation link redirect
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || 'localhost:3000';
  const proto = headerList.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  const supabase = await createSupabaseServerClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: fullName,
      },
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });

  if (signUpError) {
    return {
      status: 'error',
      error: signUpError.message || 'Error al procesar el registro.',
    };
  }

  // Supabase convention when "Confirm email" is enabled:
  // If the email already exists and is confirmed, signUp succeeds but returns user with identities: []
  if (signUpData.user && (!signUpData.user.identities || signUpData.user.identities.length === 0)) {
    return {
      status: 'error',
      error: 'Ya existe una cuenta registrada con este correo electrónico. Por favor inicie sesión.',
    };
  }

  if (!signUpData.user?.id) {
    return {
      status: 'error',
      error: 'No se pudo crear el usuario. Por favor intente más tarde.',
    };
  }

  const newUserId = signUpData.user.id;

  try {
    // Create organization and set user as administrator
    await createOrganizationWithAdmin(newUserId, { name: orgName });
  } catch (err: unknown) {
    console.error('[registerAccount] Error creating organization for new user:', err);
    return {
      status: 'error',
      error: 'Tu cuenta fue creada pero ocurrió un error al configurar la organización. Por favor contacta a soporte.',
    };
  }

  return {
    status: 'check_email',
    email,
  };
}
