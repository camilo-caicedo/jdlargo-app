import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import { getActiveConfiguration } from '@/server/configuration/service';
import { listCounterpartyTypes } from '@/server/configuration/requirement-matrix';
import { listMembers } from '@/server/organizations/use-cases';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert, FolderPlus, ArrowLeft, Settings2 } from 'lucide-react';
import { NewDossierForm } from './form';

export default async function NewDossierPage({
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

  // 1. Permission check: dossier:create
  const permCheck = await checkUserPermission(userId, organizationId, 'dossier:create');
  if (!permCheck.granted) {
    return (
      <div className="max-w-2xl mx-auto mt-6">
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
              <div>
                <CardTitle className="text-red-700 dark:text-red-300">Acceso no autorizado</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  No posee permisos suficientes para abrir expedientes en esta organización.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso requerido: Crear solicitudes (dossier:create)</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                {permCheck.reason || 'Su rol actual no cuenta con autorización para crear expedientes de debida diligencia.'}
              </AlertDescription>
            </Alert>
            <div className="mt-4">
              <Link
                href={`/app/${slug}/expedientes`}
                className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Volver a expedientes
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2. Lookup active configuration
  const activeConfig = await getActiveConfiguration(organizationId);
  if (!activeConfig) {
    return (
      <div className="max-w-2xl mx-auto mt-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Settings2 className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              <div>
                <CardTitle>Configuración pendiente</CardTitle>
                <CardDescription>
                  No hay una versión de configuración normativa publicada para esta organización.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200">
              <AlertDescription className="text-xs">
                Para abrir un expediente de debida diligencia, la organización debe contar con al menos una versión publicada de matriz de requisitos y tipos de contraparte (SARLAFT/PTEE).
              </AlertDescription>
            </Alert>
            <Link
              href={`/app/${slug}/expedientes`}
              className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver a expedientes
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 3. Load counterparty types and organization members
  const counterpartyTypes = await listCounterpartyTypes(organizationId, activeConfig.id);

  if (counterpartyTypes.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Settings2 className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              <div>
                <CardTitle>Tipos de contraparte requeridos</CardTitle>
                <CardDescription>
                  La versión actual no tiene tipos de contraparte definidos en su matriz.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200">
              <AlertDescription className="text-xs">
                Para registrar una solicitud debe existir al menos un tipo de contraparte configurado (ej: Proveedor, Cliente o Empleado) en la versión de cumplimiento activa.
              </AlertDescription>
            </Alert>
            <Link
              href={`/app/${slug}/expedientes`}
              className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver a expedientes
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rawMembers = await listMembers(userId, organizationId);
  const members = rawMembers.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href={`/app/${slug}/expedientes`} className="hover:underline">
          Expedientes
        </Link>
        <span>/</span>
        <span className="text-zinc-900 dark:text-zinc-100 font-medium">Nueva solicitud</span>
      </div>

      <Card className="shadow-xs">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <FolderPlus className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-lg">Crear solicitud de vinculación</CardTitle>
              <CardDescription className="text-xs">
                Inicia un nuevo proceso de debida diligencia con trazabilidad y versionamiento normativo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <NewDossierForm
            organizationId={organizationId}
            slug={slug}
            counterpartyTypes={counterpartyTypes}
            members={members}
            activeUserId={userId}
            standard={activeConfig.standard || 'SARLAFT'}
          />
        </CardContent>
      </Card>
    </div>
  );
}
