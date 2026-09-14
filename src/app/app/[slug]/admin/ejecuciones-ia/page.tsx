import { redirect } from "next/navigation";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { listActiveMembershipsForUser } from "@/server/organizations/use-cases";
import { checkUserPermission } from "@/server/auth/access-control";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Bot, ShieldAlert } from "lucide-react";

export default async function EjecucionesIaPage({
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

  const canView = await checkUserPermission(userId, organizationId, "ai_execution:view");

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
                  No posee permisos para ver el registro de ejecuciones de IA.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso requerido</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                Se requiere el permiso ai_execution:view.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Ejecuciones de Inteligencia Artificial
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Trazabilidad técnica, costos, tokens y auditoría de modelos de IA utilizados en la plataforma.
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader className="text-center py-12">
          <div className="mx-auto w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center mb-4">
            <Bot className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          </div>
          <CardTitle className="text-lg">Panel de Ejecuciones de IA</CardTitle>
          <CardDescription className="max-w-md mx-auto mt-2">
            La estructura de persistencia (HU-018) se encuentra lista. La visualización de métricas, filtros y latencia se habilitará en la siguiente fase de interfaz.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
