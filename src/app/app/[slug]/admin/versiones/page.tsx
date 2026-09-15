import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import {
  listConfigurationVersions,
  getDraftConfiguration,
} from '@/server/configuration/service';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { VersionesClient } from './versiones-client';

export default async function VersionesPage({
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

  const [canView, canAdminister, canPublish] = await Promise.all([
    checkUserPermission(userId, organizationId, 'configuration:view'),
    checkUserPermission(userId, organizationId, 'configuration:administer'),
    checkUserPermission(userId, organizationId, 'configuration:publish'),
  ]);

  if (!canView.granted && !canPublish.granted && !canAdminister.granted) {
    return (
      <div className="max-w-3xl mx-auto mt-6">
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
              <div>
                <CardTitle className="text-red-700 dark:text-red-300">Acceso no autorizado</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  No posee permisos para ver o administrar las versiones de configuración.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso requerido</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                Se requiere configuration:view, configuration:administer o configuration:publish.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  const versions = await listConfigurationVersions(organizationId);
  const draftVersion = await getDraftConfiguration(organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Versiones de Configuración
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Historial inmutable de versiones normativas y borradores editables de la organización.
        </p>
      </div>

      <VersionesClient
        organizationId={organizationId}
        slug={slug}
        versions={versions}
        draftVersionId={draftVersion?.id || null}
        draftSignatureLevel={(draftVersion?.signatureLevelRequired as 1 | 2 | undefined) ?? 1}
        canAdminister={canAdminister.granted}
        canPublish={canPublish.granted}
      />
    </div>
  );
}
