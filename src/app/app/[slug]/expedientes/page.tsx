import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission, enforceUserPermission } from '@/server/auth/access-control';
import { listDossiersForOrganization } from '@/server/dossiers/dossier';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  FolderKanban, 
  FolderPlus, 
  Clock, 
  FileText, 
  ChevronRight,
} from 'lucide-react';

function getStateBadge(state: string) {
  switch (state) {
    case 'borrador':
      return {
        label: 'Borrador',
        className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
      };
    case 'en_diligenciamiento':
      return {
        label: 'En diligenciamiento',
        className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200/50 dark:border-blue-800/40',
      };
    case 'en_revision':
      return {
        label: 'En revisión',
        className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200/50 dark:border-amber-800/40',
      };
    case 'aprobado':
      return {
        label: 'Aprobado',
        className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200/50 dark:border-emerald-800/40',
      };
    case 'rechazado':
      return {
        label: 'Rechazado',
        className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200/50 dark:border-red-800/40',
      };
    case 'cancelado':
      return {
        label: 'Cancelado',
        className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800',
      };
    default:
      return {
        label: state,
        className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
      };
  }
}

export default async function ExpedientesListPage({
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

  try {
    await enforceUserPermission(
      { userId, organizationId },
      'dossier:view',
    );
  } catch {
    notFound();
  }

  const canCreateDossier = (
    await checkUserPermission(userId, organizationId, 'dossier:create')
  ).granted;

  const dossiers = await listDossiersForOrganization(organizationId);

  // Metrics breakdown
  const total = dossiers.length;
  const inProgress = dossiers.filter((d) => d.state === 'en_diligenciamiento').length;
  const inReview = dossiers.filter((d) => d.state === 'en_revision').length;
  const decided = dossiers.filter((d) => ['aprobado', 'rechazado'].includes(d.state)).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-emerald-600 dark:text-emerald-500" />
            Expedientes de Debida Diligencia
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Gestión y trazabilidad completa de solicitudes de vinculación (SARLAFT / SAGRILAFT / PTEE).
          </p>
        </div>

        {canCreateDossier && (
          <Link href={`/app/${slug}/expedientes/nuevo`}>
            <Button className="font-medium inline-flex items-center gap-2 shadow-xs">
              <FolderPlus className="w-4 h-4" />
              Nueva solicitud
            </Button>
          </Link>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Total</div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{total}</div>
        </div>

        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">En diligenciamiento</div>
          <div className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-1">{inProgress}</div>
        </div>

        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">En revisión</div>
          <div className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1">{inReview}</div>
        </div>

        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs">
          <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Decididos</div>
          <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">{decided}</div>
        </div>
      </div>

      {/* Table Card */}
      <Card className="shadow-xs overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Listado de expedientes</CardTitle>
          <CardDescription className="text-xs">
            Cada expediente cuenta con versionamiento congelado de requisitos y registro en bitácora auditable.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {dossiers.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto">
                <FileText className="w-6 h-6" />
              </div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No hay expedientes creados todavía
              </div>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Inicie el proceso abriendo la primera solicitud de debida diligencia para una contraparte.
              </p>
              {canCreateDossier && (
                <div className="pt-2">
                  <Link href={`/app/${slug}/expedientes/nuevo`}>
                    <Button size="sm" variant="outline" className="font-medium">
                      Crear primera solicitud
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/75 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 font-medium">
                    <th className="py-3 px-4">Código</th>
                    <th className="py-3 px-4">Contraparte</th>
                    <th className="py-3 px-4">Tipo & Estándar</th>
                    <th className="py-3 px-4">Estado</th>
                    <th className="py-3 px-4">Responsable</th>
                    <th className="py-3 px-4">Fecha límite</th>
                    <th className="py-3 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {dossiers.map((d) => {
                    const badge = getStateBadge(d.state);
                    return (
                      <tr 
                        key={d.id} 
                        className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                          {d.code}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {d.partyDeclaredName}
                          </div>
                          <div className="text-[11px] text-zinc-500 font-mono">
                            {d.partyIdentificationType} {d.partyIdentificationNumber}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="capitalize font-medium text-zinc-800 dark:text-zinc-200">
                            {d.counterpartyTypeName}
                          </span>
                          <span className="text-zinc-400 text-[11px] block">
                            {d.standard}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">
                          {d.internalOwnerName || 'Sin asignar'}
                        </td>
                        <td className="py-3 px-4 text-zinc-500">
                          {d.deadline ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-zinc-400" />
                              {new Date(d.deadline).toLocaleDateString()}
                            </span>
                          ) : (
                            'Sin límite'
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/app/${slug}/expedientes/${d.id}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                          >
                            Ver detalle
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
