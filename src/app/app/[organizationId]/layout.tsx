import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { signOutAction } from '@/server/auth/actions';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import { Button } from '@/components/ui/button';

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const userId = await requireAuthenticatedUserId();

  // Validate server-side that the authenticated user actually belongs to this organization
  const memberships = await listActiveMembershipsForUser(userId);
  const currentMembership = memberships.find((m) => m.organizationId === organizationId);

  if (!currentMembership) {
    redirect('/login/organizacion');
  }

  const canManageMembers = (await checkUserPermission(userId, organizationId, 'memberships:manage')).granted;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm tracking-tight text-zinc-900 dark:text-zinc-100">
            JD Largo
          </span>
          <span className="text-zinc-300 dark:text-zinc-700">/</span>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {currentMembership.organizationName}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {canManageMembers && (
            <a
              href={`/app/${organizationId}/miembros`}
              className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-medium"
            >
              Miembros
            </a>
          )}
          <form action={signOutAction}>
            <Button variant="ghost" size="sm" type="submit" className="text-xs text-zinc-600 dark:text-zinc-400">
              Cerrar sesión
            </Button>
          </form>
        </div>
      </header>

      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  );
}