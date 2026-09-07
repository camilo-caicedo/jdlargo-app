'use server';

import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';

export async function selectOrganization(formData: FormData): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  const organizationId = formData.get('organizationId');

  if (typeof organizationId !== 'string' || !organizationId) {
    redirect('/login/organizacion');
  }

  // Strictly validate that user has active membership in requested organization
  const memberships = await listActiveMembershipsForUser(userId);
  const belongs = memberships.some((m) => m.organizationId === organizationId);

  if (!belongs) {
    redirect('/login/organizacion');
  }

  redirect(`/app/${organizationId}`);
}