import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser, listMembers } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import { getDossierById, getDossierPendingRequirements } from '@/server/dossiers/dossier';
import { getActiveAccessLinkForDossier } from '@/server/dossiers/access';
import { getDossierHistory } from '@/server/dossiers/state-machine';
import { getConsentForDossier } from '@/server/consent/consent';
import { getLatestDocumentsForDossier } from '@/server/documents/document';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ArrowLeft, History } from 'lucide-react';
import { AccessLinkBox } from './access-link-box';
import { ConsentCard } from './consent-card';
import { EditDossierBox } from './edit-dossier-box';
import { DocumentsCard } from './documents-card';

function getHumanState(state: string) {
  switch (state) {
    case 'borrador': return { label: 'Borrador', color: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' };
    case 'enviada': return { label: 'Enviada', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' };
    case 'en_diligenciamiento': return { label: 'En diligenciamiento', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' };
    case 'en_revision': return { label: 'En revisión', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
    case 'aprobado': return { label: 'Aprobado', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' };
    case 'rechazado': return { label: 'Rechazado', color: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' };
    case 'rechazada_por_contraparte': return { label: 'Rechazada por contraparte', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' };
    case 'cancelado': return { label: 'Cancelado', color: 'bg-zinc-100 text-zinc-500' };
    case 'cerrada': return { label: 'Cerrada', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' };
    default: return { label: state, color: 'bg-zinc-100 text-zinc-800' };
  }
}

export default async function DossierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { slug, id } = await params;
  const { token: newlyCreatedRawToken } = await searchParams;

  const userId = await requireAuthenticatedUserId();

  const memberships = await listActiveMembershipsForUser(userId);
  const currentMembership = memberships.find((m) => m.slug === slug || m.organizationId === slug);

  if (!currentMembership) {
    redirect('/login/organizacion');
  }

  const organizationId = currentMembership.organizationId;
  const dossier = await getDossierById(organizationId, id);

  if (!dossier) {
    notFound();
  }

  const canEditDossier = (
    await checkUserPermission(userId, organizationId, 'dossier:edit')
  ).granted;

  const canViewDocuments = (
    await checkUserPermission(userId, organizationId, 'document:view')
  ).granted;

  // Load requirements & active link & history & consent & members & documents in parallel
  const [requirements, activeLink, history, consent, rawMembers, rawDocs] = await Promise.all([
    getDossierPendingRequirements(organizationId, id),
    getActiveAccessLinkForDossier(organizationId, id),
    getDossierHistory(organizationId, id),
    getConsentForDossier(organizationId, id),
    listMembers(userId, organizationId),
    canViewDocuments ? getLatestDocumentsForDossier(organizationId, id) : Promise.resolve([]),
  ]);

  const docsDTO = rawDocs.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    version: d.version,
    format: d.format,
    state: d.state,
    size: d.size,
    uploadedByType: d.uploadedByType,
    createdAt: d.createdAt.toISOString(),
  }));

  const members = rawMembers.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
  }));

  const stateBadge = getHumanState(dossier.state);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back button & Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Link href={`/app/${slug}/expedientes`} className="hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />
            Volver al listado
          </Link>
          <span>/</span>
          <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{dossier.code}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${stateBadge.color}`}>
            {stateBadge.label}
          </span>
        </div>
      </div>

      {/* Main summary header */}
      <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-xs text-zinc-400 font-mono">Expediente {dossier.code}</div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mt-0.5">
              {dossier.partyDeclaredName}
            </h1>
            <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1 font-mono">
              <span>{dossier.partyIdentificationType}: {dossier.partyIdentificationNumber}</span>
              <span>•</span>
              <span className="uppercase text-emerald-600 dark:text-emerald-400 font-medium">
                {dossier.counterpartyTypeName}
              </span>
              <span>•</span>
              <span>Estándar: {dossier.standard}</span>
            </div>
          </div>

          <EditDossierBox
            organizationId={organizationId}
            dossierId={dossier.id}
            slug={slug}
            state={dossier.state}
            internalOwnerName={dossier.internalOwnerName || null}
            currentInternalOwnerId={dossier.internalOwnerId || null}
            currentDeadline={dossier.deadline}
            members={members}
            canEdit={canEditDossier}
          />
        </div>
      </div>

      {/* Access Link Card (HU-010) */}
      <AccessLinkBox
        organizationId={organizationId}
        dossierId={dossier.id}
        slug={slug}
        activeLink={activeLink}
        newlyCreatedRawToken={newlyCreatedRawToken}
        canEdit={canEditDossier}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Requirements matrix breakdown (Left 2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Requisitos de la debida diligencia</CardTitle>
                  <CardDescription className="text-xs">
                    Matriz normativa congelada con la que se abrió este expediente.
                  </CardDescription>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
                  {requirements.length} requisitos exigidos
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                {requirements.map((req) => (
                  <li key={req.requirementId} className="p-4 flex items-center justify-between hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
                    <div className="space-y-0.5">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        {req.type === 'document_type' ? (
                          <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[10px] font-semibold uppercase">
                            Documento
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[10px] font-semibold uppercase">
                            Campo
                          </span>
                        )}
                        <span>{req.key}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {req.mandatory === 'always' && 'Obligatorio'}
                        {req.mandatory === 'conditional' && 'Condicional según matriz'}
                        {req.mandatory === 'optional' && 'Opcional'}
                      </div>
                    </div>
                    <span className="text-zinc-400 text-[11px] italic">
                      Pendiente de recepción
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Documents Card (HU-013) */}
          {canViewDocuments && (
            <DocumentsCard
              organizationId={organizationId}
              dossierId={id}
              documents={docsDTO}
            />
          )}
        </div>

        {/* Audit & State history & Consent (Right 1 col) */}
        <div className="space-y-6">
          {/* Consent evidence card (HU-011) */}
          <ConsentCard consent={consent} />

          <Card className="shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <History className="w-4 h-4 text-zinc-500" />
                Historial de transiciones
              </CardTitle>
              <CardDescription className="text-xs">
                Trazabilidad inmutable de la máquina de estados.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <div className="p-4 text-xs text-zinc-400 italic text-center">
                  Sin transiciones previas
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                  {history.map((h) => (
                    <li key={h.id} className="p-3 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300 capitalize">
                          {h.fromState} &rarr; {h.toState}
                        </span>
                        <span className="text-zinc-400">
                          {new Date(h.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500 flex items-center justify-between">
                        <span>Por: {h.actorType}</span>
                        <span>{new Date(h.occurredAt).toLocaleDateString()}</span>
                      </div>
                      {h.reason && (
                        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/60 p-1.5 rounded mt-1">
                          Motivo: {h.reason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
