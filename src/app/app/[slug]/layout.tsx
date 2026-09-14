import { redirect } from "next/navigation";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { listActiveMembershipsForUser } from "@/server/organizations/use-cases";
import { checkUserPermission } from "@/server/auth/access-control";
import { AppNavigationMenu } from "@/components/navigation/app-navigation-menu";

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
    redirect("/login/organizacion");
  }

  // If user entered using raw organization UUID instead of slug, canonical redirect to slug URL
  if (currentMembership.slug !== slug) {
    redirect(`/app/${currentMembership.slug}`);
  }

  const [
    canManageMembers,
    canViewConfig,
    canAdministerConfig,
    canPublishConfig,
    canViewAudit,
    canViewAiExecution,
  ] = await Promise.all([
    checkUserPermission(userId, currentMembership.organizationId, "memberships:manage"),
    checkUserPermission(userId, currentMembership.organizationId, "configuration:view"),
    checkUserPermission(userId, currentMembership.organizationId, "configuration:administer"),
    checkUserPermission(userId, currentMembership.organizationId, "configuration:publish"),
    checkUserPermission(userId, currentMembership.organizationId, "audit:view"),
    checkUserPermission(userId, currentMembership.organizationId, "ai_execution:view"),
  ]);

  const canAccessAdmin =
    canViewConfig.granted ||
    canAdministerConfig.granted ||
    canPublishConfig.granted ||
    canViewAudit.granted ||
    canViewAiExecution.granted;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <AppNavigationMenu
        currentMembership={currentMembership}
        memberships={memberships}
        canManageMembers={canManageMembers.granted}
        canAccessAdmin={canAccessAdmin}
      />

      <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
        {children}
      </main>
    </div>
  );
}
