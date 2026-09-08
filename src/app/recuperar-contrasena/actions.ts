'use server';

import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { adminDb, executePrivilegedSystemOperation } from '@/server/privileged/system-execution';
import { users, memberships } from '@/server/db/schema';

export interface RequestResetState {
  status: 'idle' | 'sent' | 'error';
  error?: string;
}

export async function requestPasswordReset(
  prevState: RequestResetState,
  formData: FormData,
): Promise<RequestResetState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return {
      status: 'error',
      error: 'Ingresa un correo electrónico válido.',
    };
  }

  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || 'localhost:3000';
  const proto = headerList.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm`,
  });

  if (error) {
    if (error.code === 'over_email_send_rate_limit') {
      return {
        status: 'error',
        error: 'Demasiadas solicitudes de recuperación enviadas. Por favor, espera unos minutos.',
      };
    }
    console.error('[requestPasswordReset] Supabase Auth error:', error);
    return {
      status: 'error',
      error: 'Ocurrió un error inesperado al procesar la solicitud. Por favor intenta de nuevo.',
    };
  }

  // Best-effort audit logging: trace in audit_log per active organization if user exists.
  // Anti-enumeration: must not reveal whether the email exists or fail the request if user not found.
  try {
    const [existingUser] = await adminDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    if (existingUser) {
      const activeMemberships = await adminDb
        .select({ organizationId: memberships.organizationId })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, existingUser.id),
            eq(memberships.status, 'active'),
          ),
        );

      for (const m of activeMemberships) {
        await executePrivilegedSystemOperation(
          {
            action: 'auth.password_reset_requested',
            organizationId: m.organizationId,
            entity: 'user',
            entityId: existingUser.id,
            metadata: { email },
            description: 'Password reset requested for user account',
          },
          async () => {
            // No additional state change needed
          },
        );
      }
    }
  } catch (auditErr) {
    console.warn('[requestPasswordReset] Non-fatal audit log error during password reset request:', auditErr);
  }

  return {
    status: 'sent',
  };
}