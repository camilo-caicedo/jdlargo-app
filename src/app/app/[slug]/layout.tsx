import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import { AppNavigationMenu } from '@/components/navigation/app-navigation-menu';

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await requireAuthenticatedUserId();

  // Validate server-side that the authenticated user actually belongs to this organization (match by slug or organizationId)
  const memberships = await listActiveMembershipsForUser(userId);
  const currentMembership = memberships.find((m) => m.slug === slug || m.organizationId === slug);

  if (!currentMembership) {
    redirect('/login/organizacion');
  }

  // If user entered using raw organization UUID instead of slug, canonical redirect to slug URL
  if (currentMembership.slug !== slug) {
    redirect(`/app/${currentMembership.slug}`);
  }

  const canManageMembers = (
    await checkUserPermission(userId, currentMembership.organizationId, 'memberships:manage')
  ).granted;

  const canViewConfiguration = (
    await checkUserPermission(userId, currentMembership.organizationId, 'configuration:view')
  ).granted;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <AppNavigationMenu
        currentMembership={currentMembership}
        memberships={memberships}
        canManageMembers={canManageMembers}
        canViewConfiguration={canViewConfiguration}
      />

      <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
        {children}
      </main>
    </div>
  );
}