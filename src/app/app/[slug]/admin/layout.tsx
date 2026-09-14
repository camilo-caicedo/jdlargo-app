import { redirect } from "next/navigation";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { listActiveMembershipsForUser } from "@/server/organizations/use-cases";
import { checkUserPermission } from "@/server/auth/access-control";
import { AdminNavTabs, type AdminTabItem } from "./admin-nav-tabs";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  // Server-side permission checks
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

  const hasAnyAdminAccess =
    canViewConfig.granted ||
    canAdministerConfig.granted ||
    canPublishConfig.granted ||
    canViewAudit.granted ||
    canViewAiExecution.granted;

  if (!hasAnyAdminAccess) {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
              <div>
                <CardTitle className="text-red-700 dark:text-red-300">Acceso restringido</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  No tiene permisos administrativos en esta organización.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso insuficiente</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                Se requiere al menos uno de los siguientes permisos: configuration:view,
                configuration:administer, configuration:publish, audit:view o ai_execution:view.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tabs: AdminTabItem[] = [
    {
      id: "versiones",
      name: "Versiones de configuración",
      href: `${basePath}/versiones`,
      iconName: "layers",
      visible: canViewConfig.granted || canPublishConfig.granted || canAdministerConfig.granted,
    },
    {
      id: "roles",
      name: "Roles y permisos",
      href: `${basePath}/roles`,
      iconName: "roles",
      visible: canViewConfig.granted || canAdministerConfig.granted,
    },
    {
      id: "matriz-requisitos",
      name: "Matriz de requisitos",
      href: `${basePath}/matriz-requisitos`,
      iconName: "matrix",
      visible: canViewConfig.granted || canAdministerConfig.granted,
    },
    {
      id: "aviso-privacidad",
      name: "Aviso de privacidad",
      href: `${basePath}/aviso-privacidad`,
      iconName: "privacy",
      visible: canViewConfig.granted || canAdministerConfig.granted,
    },
    {
      id: "bitacora",
      name: "Bitácora / Auditoría",
      href: `${basePath}/bitacora`,
      iconName: "audit",
      visible: canViewAudit.granted,
    },
    {
      id: "ejecuciones-ia",
      name: "Ejecuciones de IA",
      href: `${basePath}/ejecuciones-ia`,
      iconName: "ai",
      visible: canViewAiExecution.granted,
      disabled: false,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Administración del Sistema
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Gestione las versiones normativas, matriz de requisitos, roles, privacidad y bitácora de auditoría.
        </p>
      </div>

      <AdminNavTabs tabs={tabs} />

      <div>{children}</div>
    </div>
  );
}
