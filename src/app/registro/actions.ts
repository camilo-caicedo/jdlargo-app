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
  defaultValues?: {
    email?: string;
    fullName?: string;
    orgName?: string;
  };
}

export async function registerAccount(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const rawEmail = formData.get('email');
  const rawPassword = formData.get('password');
  const rawFullName = formData.get('fullName');
  const rawOrgName = formData.get('orgName');

  const emailStr = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const fullNameStr = typeof rawFullName === 'string' ? rawFullName.trim() : '';
  const orgNameStr = typeof rawOrgName === 'string' ? rawOrgName.trim() : '';

  const defaultValues = {
    email: emailStr,
    fullName: fullNameStr,
    orgName: orgNameStr,
  };

  const parsed = registerSchema.safeParse({
    email: emailStr,
    password: typeof rawPassword === 'string' ? rawPassword : '',
    fullName: fullNameStr,
    orgName: orgNameStr,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      error: parsed.error.issues[0]?.message || 'Datos del formulario inválidos',
      defaultValues,
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
    if (signUpError.message?.toLowerCase().includes('rate limit') || signUpError.code === 'over_email_send_rate_limit') {
      return {
        status: 'error',
        error: 'Se ha superado el límite de envío de correos temporales del servicio de autenticación. Por favor espera unos minutos antes de intentar registrarte nuevamente.',
        defaultValues,
      };
    }
    return {
      status: 'error',
      error: signUpError.message || 'Error al procesar el registro.',
      defaultValues,
    };
  }

  // Supabase convention when "Confirm email" is enabled:
  // If the email already exists and is confirmed, signUp succeeds but returns user with identities: []
  if (signUpData.user && (!signUpData.user.identities || signUpData.user.identities.length === 0)) {
    return {
      status: 'error',
      error: 'Ya existe una cuenta registrada con este correo electrónico. Por favor inicie sesión.',
      defaultValues,
    };
  }

  if (!signUpData.user?.id) {
    return {
      status: 'error',
      error: 'No se pudo crear el usuario. Por favor intente más tarde.',
      defaultValues,
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
      defaultValues,
    };
  }

  return {
    status: 'check_email',
    email,
  };
}
