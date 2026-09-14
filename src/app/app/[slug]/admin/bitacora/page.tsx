import { redirect } from "next/navigation";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { listActiveMembershipsForUser } from "@/server/organizations/use-cases";
import { checkUserPermission } from "@/server/auth/access-control";
import { listAuditLogForOrganization } from "@/server/audit/service";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import { BitacoraClient } from "./bitacora-client";

export default async function BitacoraPage({
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

  const canView = await checkUserPermission(userId, organizationId, "audit:view");

  if (!canView.granted) {
    return (
      <div className="max-w-3xl mx-auto mt-6">
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
              <div>
                <CardTitle className="text-red-700 dark:text-red-300">Acceso no autorizado</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  No posee permisos para consultar la bitácora de auditoría.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso requerido</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                Se requiere el permiso audit:view.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { entries, nextCursor } = await listAuditLogForOrganization(organizationId, {
    limit: 50,
  });

  const serializedEntries = entries.map((e) => ({
    id: e.id,
    organizationId: e.organizationId,
    actorUserId: e.actorUserId,
    actorUserName: e.actorUserName || null,
    actorUserEmail: e.actorUserEmail || null,
    actorType: e.actorType,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    occurredAt: e.occurredAt.toISOString(),
    previousValue: e.previousValue,
    newValue: e.newValue,
    reason: e.reason,
    automatic: e.automatic,
    eventHash: e.eventHash,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Bitácora de Auditoría
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Registro inmutable y verificable de todos los eventos, decisiones y cambios sensibles en la organización.
        </p>
      </div>

      <BitacoraClient
        organizationId={organizationId}
        initialEntries={serializedEntries}
        initialNextCursor={nextCursor}
      />
    </div>
  );
}
