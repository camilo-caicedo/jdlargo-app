import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { listActiveMembershipsForUser } from '../organizations/use-cases';

export type PostLoginDestination =
  | { kind: 'single_org'; organizationId: string; slug: string }
  | { kind: 'select_org' }
  | { kind: 'no_access' };

/**
 * Returns the currently authenticated user's ID or null if unauthenticated.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return null;
  }
  return user.id;
}

/**
 * Ensures the caller is authenticated. Redirects to /login if no valid session.
 */
export async function requireAuthenticatedUserId(): Promise<string> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    redirect('/login');
  }
  return userId;
}

/**
 * Decides destination after authentication based on user active memberships.
 */
export async function resolvePostLoginDestination(
  userId: string,
): Promise<PostLoginDestination> {
  const memberships = await listActiveMembershipsForUser(userId);

  if (memberships.length === 0) {
    return { kind: 'no_access' };
  }

  if (memberships.length === 1) {
    return {
      kind: 'single_org',
      organizationId: memberships[0].organizationId,
      slug: memberships[0].slug,
    };
  }

  return { kind: 'select_org' };
}

/**
 * Signs out from Supabase Auth and redirects to public landing page (/).
 */
export async function signOutAndRedirect(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/');
}