'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createOrganizationWithAdmin } from '@/server/organizations/use-cases';
import { seedBaseConfiguration } from '@/server/auth/role-config';

import { passwordPolicySchema } from '@/lib/auth/password-policy';

const registerSchema = z.object({
  email: z.string().email('Ingrese un correo electrónico válido'),
  password: passwordPolicySchema,
  fullName: z.string().min(2, 'El nombre completo debe tener al menos 2 caracteres'),
  orgName: z.string().min(2, 'El nombre de la organización debe tener al menos 2 caracteres'),
  slug: z.string()
    .min(2, 'El identificador debe tener al menos 2 caracteres')
    .max(50, 'El identificador no puede superar 50 caracteres')
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Usa solo minúsculas, números y guiones (ej: mi-empresa)'),
});

export interface RegisterState {
  status: 'idle' | 'error' | 'check_email';
  error?: string;
  email?: string;
  defaultValues?: {
    email?: string;
    fullName?: string;
    orgName?: string;
    slug?: string;
    password?: string;
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
  const rawSlug = formData.get('slug');

  const emailStr = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const fullNameStr = typeof rawFullName === 'string' ? rawFullName.trim() : '';
  const orgNameStr = typeof rawOrgName === 'string' ? rawOrgName.trim() : '';
  const slugStr = typeof rawSlug === 'string' ? rawSlug.trim().toLowerCase() : '';
  const passwordStr = typeof rawPassword === 'string' ? rawPassword : '';

  const defaultValues = {
    email: emailStr,
    fullName: fullNameStr,
    orgName: orgNameStr,
    slug: slugStr,
    password: passwordStr,
  };

  const parsed = registerSchema.safeParse({
    email: emailStr,
    password: passwordStr,
    fullName: fullNameStr,
    orgName: orgNameStr,
    slug: slugStr,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      error: parsed.error.issues[0]?.message || 'Datos del formulario inválidos',
      defaultValues,
    };
  }

  const { email, password, fullName, orgName, slug } = parsed.data;

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
    const newOrg = await createOrganizationWithAdmin(newUserId, { name: orgName, slug });

    // Initialize base configuration version with roles and permissions (§30, HU-003)
    await seedBaseConfiguration(newOrg.id, newUserId);
  } catch (err: unknown) {
    console.error('[registerAccount] Error creating organization for new user:', err);
    if (err && typeof err === 'object' && 'code' in err && err.code === 'DUPLICATE_ORG_SLUG') {
      return {
        status: 'error',
        error: 'Ese identificador de organización (slug) ya está en uso. Por favor elige otro.',
        defaultValues,
      };
    }
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
