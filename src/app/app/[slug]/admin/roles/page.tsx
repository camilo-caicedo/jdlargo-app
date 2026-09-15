import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import { getDraftConfiguration, getActiveConfiguration } from '@/server/configuration/service';
import { ALL_PERMISSIONS } from '@/server/auth/permissions';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { RolesClient } from './roles-client';

export default async function RolesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await requireAuthenticatedUserId();

  const memberships = await listActiveMembershipsForUser(userId);
  const currentMembership = memberships.find((m) => m.slug === slug || m.organizationId === slug);

  if (!currentMembership) {
    redirect('/login/organizacion');
  }

  const organizationId = currentMembership.organizationId;

  const [canView, canAdminister] = await Promise.all([
    checkUserPermission(userId, organizationId, 'configuration:view'),
    checkUserPermission(userId, organizationId, 'configuration:administer'),
  ]);

  if (!canView.granted && !canAdminister.granted) {
    return (
      <div className="max-w-3xl mx-auto mt-6">
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
              <div>
                <CardTitle className="text-red-700 dark:text-red-300">Acceso no autorizado</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  No posee permisos para ver o administrar roles.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso requerido</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                Se requiere configuration:view o configuration:administer.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [draft, active] = await Promise.all([
    getDraftConfiguration(organizationId),
    getActiveConfiguration(organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Roles y Permisos
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Configuración granular de los roles de la organización y sus permisos sobre el catálogo del sistema.
        </p>
      </div>

      {draft && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-2">
              Borrador en edición (Versión {draft.versionNumber})
            </h3>
            <RolesClient
              organizationId={organizationId}
              slug={slug}
              isDraft={true}
              versionNumber={draft.versionNumber}
              roles={draft.roles || []}
              allPermissions={ALL_PERMISSIONS as unknown as string[]}
              canAdminister={canAdminister.granted}
              readOnly={false}
            />
          </div>

          {active && (
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 mt-6">
              <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
                Versión publicada actual (Versión {active.versionNumber})
              </h3>
              <RolesClient
                organizationId={organizationId}
                slug={slug}
                isDraft={false}
                versionNumber={active.versionNumber}
                roles={active.roles || []}
                allPermissions={ALL_PERMISSIONS as unknown as string[]}
                canAdminister={canAdminister.granted}
                readOnly={true}
              />
            </div>
          )}
        </div>
      )}

      {!draft && active && (
        <RolesClient
          organizationId={organizationId}
          slug={slug}
          isDraft={false}
          versionNumber={active.versionNumber}
          roles={active.roles || []}
          allPermissions={ALL_PERMISSIONS as unknown as string[]}
          canAdminister={canAdminister.granted}
          readOnly={false}
        />
      )}

      {!draft && !active && (
        <Card>
          <CardContent className="py-8 text-center text-zinc-500 text-sm">
            No hay configuración disponible. Cree un borrador para comenzar.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
