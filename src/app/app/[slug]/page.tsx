import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import { listDossiersForOrganization } from '@/server/dossiers/dossier';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  FolderKanban, 
  FolderPlus, 
  Users, 
  ArrowRight,
  ShieldCheck,
  FileText
} from 'lucide-react';

export default async function AppOrganizationPage({
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

  // Load dossiers and permissions in parallel
  const [dossiers, canCreateDossierResult, canManageMembersResult] = await Promise.all([
    listDossiersForOrganization(organizationId),
    checkUserPermission(userId, organizationId, 'dossier:create'),
    checkUserPermission(userId, organizationId, 'memberships:manage'),
  ]);

  const canCreateDossier = canCreateDossierResult.granted;
  const canManageMembers = canManageMembersResult.granted;

  // Metrics breakdown (same calculation as expedientes/page.tsx)
  const total = dossiers.length;
  const inProgress = dossiers.filter((d) => d.state === 'en_diligenciamiento').length;
  const inReview = dossiers.filter((d) => d.state === 'en_revision').length;
  const decided = dossiers.filter((d) => ['aprobado', 'rechazado', 'cerrada'].includes(d.state)).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6 mt-2">
      {/* Header section */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-500" />
            {currentMembership.organizationName}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Resumen del espacio de trabajo y debida diligencia de contrapartes.
          </p>
        </div>

        {/* Quick actions row on top */}
        <div className="flex items-center gap-2 flex-wrap">
          {canCreateDossier && (
            <Link href={`/app/${slug}/expedientes/nuevo`}>
              <Button className="font-medium inline-flex items-center gap-2 shadow-xs">
                <FolderPlus className="w-4 h-4" />
                Nueva solicitud
              </Button>
            </Link>
          )}
          <Link href={`/app/${slug}/expedientes`}>
            <Button variant="outline" className="font-medium inline-flex items-center gap-2 shadow-xs">
              <FolderKanban className="w-4 h-4" />
              Ver expedientes
            </Button>
          </Link>
          {canManageMembers && (
            <Link href={`/app/${slug}/miembros`}>
              <Button variant="outline" className="font-medium inline-flex items-center gap-2 shadow-xs">
                <Users className="w-4 h-4" />
                Miembros
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Metrics Row (same visual styling as expedientes) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total expedientes</div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{total}</div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">En diligenciamiento</div>
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{inProgress}</div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">En revisión</div>
          <div className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1">{inReview}</div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Decididos</div>
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">{decided}</div>
        </div>
      </div>

      {/* Empty State or Activity Overview Card */}
      {total === 0 ? (
        <Card className="shadow-xs text-center py-12 px-4 border-dashed">
          <CardContent className="space-y-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
              <FolderKanban className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Aún no hay expedientes creados
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                Inicia el proceso de vinculación y debida diligencia creando la primera solicitud para una contraparte.
              </p>
            </div>
            {canCreateDossier && (
              <div className="pt-2">
                <Link href={`/app/${slug}/expedientes/nuevo`}>
                  <Button className="inline-flex items-center gap-2">
                    <FolderPlus className="w-4 h-4" />
                    Crear primera solicitud
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-xs">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Módulo de debida diligencia</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Seguimiento operativo y gestión de contrapartes registradas en el sistema.
              </CardDescription>
            </div>
            <Link 
              href={`/app/${slug}/expedientes`}
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
            >
              Ir al listado completo <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/60 dark:border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {total} {total === 1 ? 'expediente registrado' : 'expedientes registrados'}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {inProgress + inReview} en curso &middot; {decided} finalizados
                  </p>
                </div>
              </div>
              <Link href={`/app/${slug}/expedientes`}>
                <Button variant="secondary" size="sm" className="text-xs font-medium">
                  Gestionar expedientes
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}