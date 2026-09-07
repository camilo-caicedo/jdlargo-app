import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId, signOutAndRedirect } from '@/server/auth/session';
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
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 flex flex-col">
      <header className="border-b bg-white dark:bg-zinc-900 px-6 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold text-sm tracking-tight">
            <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-500 inline-block" />
            <span>JD Largo</span>
          </div>
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
          <form action={signOutAndRedirect}>
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