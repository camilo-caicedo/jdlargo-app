import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser, listMembers } from '@/server/organizations/use-cases';
import { checkUserPermission, enforceUserPermission } from '@/server/auth/access-control';
import { getDossierById, getDossierPendingRequirements } from '@/server/dossiers/dossier';
import { getActiveAccessLinkForDossier, getAccessUsesForDossier } from '@/server/dossiers/access';
import { getDossierHistory } from '@/server/dossiers/state-machine';
import { getConsentForDossier } from '@/server/consent/consent';
import { getLatestDocumentsForDossier } from '@/server/documents/document';
import { ensureReviewEntryTransition, getReviewSummary } from '@/server/dossiers/review';
import { getDecisionsForDossier } from '@/server/dossiers/decision';
import { getEntityAuditHistory, logAuditEvent } from '@/server/audit/service';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ArrowLeft, History, CheckCircle2, Clock, AlertCircle, KeyRound, ShieldAlert } from 'lucide-react';
import { AccessLinkBox } from './access-link-box';
import { ConsentCard } from './consent-card';
import { EditDossierBox } from './edit-dossier-box';
import { DocumentsCard } from './documents-card';
import { ReviewActionsBox } from './review-actions-box';
import { DecisionBox } from './decision-box';
import { ReconciliationBox } from './reconciliation-box';
import { ExtractionBox } from './extraction-box';

function getHumanState(state: string) {
  switch (state) {
    case 'borrador': return { label: 'Borrador', color: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' };
    case 'enviada': return { label: 'Enviada', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300' };
    case 'en_diligenciamiento': return { label: 'En diligenciamiento', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' };
    case 'documentos_recibidos': return { label: 'Documentos recibidos', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' };
    case 'en_revision': return { label: 'En revisión', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
    case 'pendiente_de_decision': return { label: 'Pendiente de decisión', color: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300' };
    case 'aprobada': return { label: 'Aprobada', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' };
    case 'aprobada_con_condiciones': return { label: 'Aprobada con condiciones', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
    case 'rechazada': return { label: 'Rechazada', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' };
    case 'cerrada': return { label: 'Cerrada', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' };
    case 'expirado_pendiente': return { label: 'Expirado / Pendiente', color: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' };
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

  // Gate de lectura obligatorio para visualizar expedientes (HU-016)
  try {
    await enforceUserPermission(
      { userId, organizationId },
      'dossier:view',
    );
  } catch {
    notFound();
  }

  // Auto-transition from documentos_recibidos -> en_revision if applicable (HU-014)
  await ensureReviewEntryTransition(organizationId, id);

  const dossier = await getDossierById(organizationId, id);

  if (!dossier) {
    notFound();
  }

  // Log de auditoría por consulta del expediente (HU-016 §2.6)
  await logAuditEvent({
    organizationId,
    actorType: 'user',
    actorUserId: userId,
    action: 'dossier.viewed',
    entity: 'dossier',
    entityId: id,
    configurationVersionId: dossier.configurationVersionId,
    origin: { actor: 'user', action: 'DossierDetailPage' },
  });

  const canEditDossier = (
    await checkUserPermission(userId, organizationId, 'dossier:edit')
  ).granted;

  const canViewDocuments = (
    await checkUserPermission(userId, organizationId, 'document:view')
  ).granted;

  const canReviewDocuments = (
    await checkUserPermission(userId, organizationId, 'document:review')
  ).granted;

  const canReviewDossier = (
    await checkUserPermission(userId, organizationId, 'dossier:review')
  ).granted;

  const canApproveDossier = (
    await checkUserPermission(userId, organizationId, 'dossier:approve')
  ).granted;

  // Load requirements & active link & history & consent & members & documents & declared values & decisions & access uses in parallel
  const [
    requirements,
    activeLink,
    history,
    consent,
    rawMembers,
    rawDocs,
    rawValues,
    decisionsHistory,
    reviewSummary,
    auditHistory,
    accessUses,
  ] = await Promise.all([
    getDossierPendingRequirements(organizationId, id),
    getActiveAccessLinkForDossier(organizationId, id),
    getDossierHistory(organizationId, id),
    getConsentForDossier(organizationId, id),
    listMembers(userId, organizationId),
    canViewDocuments ? getLatestDocumentsForDossier(organizationId, id) : Promise.resolve([]),
    import('@/server/assertions/service').then((m) =>
      m.getLatestDeclaredValuesForDossier(organizationId, id),
    ),
    getDecisionsForDossier(organizationId, id),
    getReviewSummary(organizationId, id),
    getEntityAuditHistory(organizationId, 'dossier', id),
    getAccessUsesForDossier(organizationId, id),
  ]);

  const declaredValuesMap = new Map(rawValues.map((v) => [v.field, v]));
  const documentsMap = new Map(rawDocs.map((d) => [d.documentType, d]));

  // Find last review_completed_with_exception event
  const lastExceptionEvent = [...auditHistory]
    .reverse()
    .find((a) => a.action === 'dossier.review_completed_with_exception');

  const exceptionWarning = lastExceptionEvent
    ? {
        reason: (lastExceptionEvent.metadata?.reason as string) || (lastExceptionEvent.reason as string) || '',
        skippedRequirementKeys:
          (lastExceptionEvent.metadata?.skipped_requirement_keys as string[]) || [],
      }
    : null;

  // Build evidence options from declared values and uploaded documents
  const availableEvidence: {
    kind: 'assertion' | 'document';
    id: string;
    label: string;
    sublabel?: string;
  }[] = [];

  for (const v of rawValues) {
    availableEvidence.push({
      kind: 'assertion',
      id: v.id,
      label: `Campo: ${v.field}`,
      sublabel: String(v.value),
    });
  }

  for (const doc of rawDocs) {
    availableEvidence.push({
      kind: 'document',
      id: doc.id,
      label: `Documento: ${doc.documentType} (v${doc.version})`,
      sublabel: `Estado: ${doc.state}`,
    });
  }

  const docsDTO = rawDocs.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    version: d.version,
    format: d.format,
    state: d.state,
    size: d.size,
    uploadedByType: d.uploadedByType,
    rejectionReason: d.rejectionReason,
    reviewedByUserId: d.reviewedByUserId,
    reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  }));

  const members = rawMembers.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
  }));

  const membersMap = new Map(members.map((m) => [m.id, m.name]));

  const stateBadge = getHumanState(dossier.state);

  const coveredRequirementsCount = requirements.filter((req) => {
    if (req.type === 'field') {
      const v = declaredValuesMap.get(req.key);
      return v && v.value !== undefined && v.value !== null && v.value !== '';
    } else if (req.type === 'document_type') {
      const d = documentsMap.get(req.key);
      return d && d.state !== 'rejected';
    }
    return false;
  }).length;

  return (
    <div className="max-w-full mx-auto space-y-6">
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
          <ReviewActionsBox
            organizationId={organizationId}
            dossierId={dossier.id}
            canReview={canReviewDossier && dossier.state === 'en_revision'}
            canOverrideReview={canApproveDossier}
            canOverride={reviewSummary.canOverride}
          />
          <DecisionBox
            organizationId={organizationId}
            dossierId={dossier.id}
            dossierState={dossier.state}
            canDecide={canApproveDossier}
            canClose={canEditDossier}
            availableEvidence={availableEvidence}
            decisionsHistory={decisionsHistory}
            exceptionWarning={exceptionWarning}
          />
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
            <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1 font-mono flex-wrap">
              <span>{dossier.partyIdentificationType}: {dossier.partyIdentificationNumber}</span>
              <span>•</span>
              <span className="uppercase text-emerald-600 dark:text-emerald-400 font-medium">
                {dossier.counterpartyTypeName}
              </span>
              <span>•</span>
              <span>Estándar: {dossier.standard}</span>
              {dossier.configurationVersionNumber && (
                <>
                  <span>•</span>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    Versión config: v{dossier.configurationVersionNumber}
                  </span>
                </>
              )}
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
                  {coveredRequirementsCount} de {requirements.length} cubiertos
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                {requirements.map((req) => {
                  let statusBadge = (
                    <span className="inline-flex items-center gap-1 text-zinc-400 text-[11px] italic">
                      <Clock className="w-3.5 h-3.5" />
                      Pendiente
                    </span>
                  );
                  let detailText: string | null = null;
                  let provenanceText: string | null = null;

                  if (req.type === 'field') {
                    const declared = declaredValuesMap.get(req.key);
                    if (declared && declared.value !== undefined && declared.value !== null && declared.value !== '') {
                      statusBadge = (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Declarado
                        </span>
                      );
                      detailText = String(declared.value);

                      const actorName = declared.producedBy ? (membersMap.get(declared.producedBy) || 'Usuario interno') : 'la contraparte';
                      const formattedDate = new Date(declared.producedAt).toLocaleDateString();
                      provenanceText = `Declarado por ${actorName} el ${formattedDate}`;
                    }
                  } else if (req.type === 'document_type') {
                    const doc = documentsMap.get(req.key);
                    if (doc) {
                      if (doc.state === 'valid') {
                        statusBadge = (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Válido (v{doc.version})
                          </span>
                        );
                      } else if (doc.state === 'rejected') {
                        statusBadge = (
                          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-[11px] font-medium">
                            <AlertCircle className="w-3.5 h-3.5" />
                            Rechazado (v{doc.version})
                          </span>
                        );
                      } else {
                        // received or other intermediate state
                        statusBadge = (
                          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 text-[11px] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Recibido (v{doc.version})
                          </span>
                        );
                      }
                    }
                  }

                  return (
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
                          <span className="capitalize">{req.key.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-400 flex-wrap">
                          <span>
                            {req.mandatory === 'always' && 'Obligatorio'}
                            {req.mandatory === 'conditional' && 'Condicional según matriz'}
                            {req.mandatory === 'optional' && 'Opcional'}
                          </span>
                          {detailText && (
                            <>
                              <span>•</span>
                              <span className="text-zinc-600 dark:text-zinc-300 font-mono font-medium">
                                Valor: {detailText}
                              </span>
                            </>
                          )}
                          {provenanceText && (
                            <>
                              <span>•</span>
                              <span className="text-zinc-500 italic">
                                {provenanceText}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div>
                        {statusBadge}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {/* Reconciliation & Validation (HU-019, HU-020) */}
          {canReviewDossier && (
            <ReconciliationBox organizationId={organizationId} slug={slug} dossierId={id} userId={userId} />
          )}

          {canReviewDocuments && (
            <ExtractionBox organizationId={organizationId} slug={slug} dossierId={id} />
          )}

          {/* Documents Card (HU-013, HU-014) */}
          {canViewDocuments && (
            <DocumentsCard
              organizationId={organizationId}
              dossierId={id}
              dossierState={dossier.state}
              canReviewDocuments={canReviewDocuments}
              documents={docsDTO}
            />
          )}
        </div>

        {/* Audit & State history & Consent (Right 1 col) */}
        <div className="space-y-6">
          {/* Consent evidence card (HU-011) */}
          <ConsentCard consent={consent} />

          {/* Counterparty access attempts card (HU-016 §2.4) */}
          <Card className="shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-zinc-500" />
                  Accesos de la contraparte
                </CardTitle>
                <span className="text-xs text-zinc-400 font-mono">
                  {accessUses.length} {accessUses.length === 1 ? 'intento' : 'intentos'}
                </span>
              </div>
              <CardDescription className="text-xs">
                Registro inmutable de uso del enlace de acceso.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {accessUses.length === 0 ? (
                <div className="p-4 text-xs text-zinc-400 italic text-center">
                  Sin intentos de acceso registrados
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                  {accessUses.map((use) => (
                    <li key={use.id} className="p-3 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                          {use.result === 'granted' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Acceso permitido
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                              <ShieldAlert className="w-3 h-3" />
                              Acceso denegado
                            </span>
                          )}
                        </span>
                        <span className="text-zinc-400">
                          {new Date(use.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500 flex items-center justify-between">
                        <span className="font-mono">{use.ipAddress}</span>
                        <span>{new Date(use.occurredAt).toLocaleDateString()}</span>
                      </div>
                      {use.denialReason && (
                        <p className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 p-1.5 rounded mt-1 border border-rose-100 dark:border-rose-900/40">
                          Motivo de rechazo: {use.denialReason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

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
