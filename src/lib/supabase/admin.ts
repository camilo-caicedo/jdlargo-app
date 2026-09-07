import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates an admin Supabase client using SUPABASE_SECRET_KEY.
 *
 * CRITICAL SECURITY CONSTRAINTS:
 * - Must NEVER be imported from client components ('use client') or public actions.
 * - Only used from src/server/privileged/ for system operations like creating user accounts.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error('Supabase admin credentials missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY)');
  }

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}