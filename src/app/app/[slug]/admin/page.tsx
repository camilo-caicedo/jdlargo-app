import { redirect } from "next/navigation";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { listActiveMembershipsForUser } from "@/server/organizations/use-cases";
import { checkUserPermission } from "@/server/auth/access-control";

export default async function AdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await requireAuthenticatedUserId();

  const memberships = await listActiveMembershipsForUser(userId);
  const currentMembership = memberships.find((m) => m.slug === slug || m.organizationId === slug);

  if (!currentMembership) {
    redirect("/login/organizacion");
  }

  const organizationId = currentMembership.organizationId;
  const basePath = `/app/${slug}/admin`;

  // Check which tab the user has permission to visit first
  const [
    canViewConfig,
    canAdministerConfig,
    canPublishConfig,
    canViewAudit,
    canViewAiExecution,
  ] = await Promise.all([
    checkUserPermission(userId, organizationId, "configuration:view"),
    checkUserPermission(userId, organizationId, "configuration:administer"),
    checkUserPermission(userId, organizationId, "configuration:publish"),
    checkUserPermission(userId, organizationId, "audit:view"),
    checkUserPermission(userId, organizationId, "ai_execution:view"),
  ]);

  if (canViewConfig.granted || canPublishConfig.granted || canAdministerConfig.granted) {
    redirect(`${basePath}/versiones`);
  } else if (canViewAudit.granted) {
    redirect(`${basePath}/bitacora`);
  } else if (canViewAiExecution.granted) {
    redirect(`${basePath}/ejecuciones-ia`);
  } else {
    redirect(`/app/${slug}`);
  }
}
