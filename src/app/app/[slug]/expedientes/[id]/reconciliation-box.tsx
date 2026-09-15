import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { getDossierById } from '@/server/dossiers/dossier';
import { getFieldReconciliation, getOpenDiscrepancies } from '@/server/reconciliation/service';
import { getActiveAssertionsForDossier } from '@/server/assertions/service';
import { checkUserPermission } from '@/server/auth/access-control';
import { ReconciliationRowActions, type ConflictingAssertion } from './reconciliation-row-actions';

async function ReconciliationBox({
  organizationId,
  slug,
  dossierId,
  userId,
}: {
  organizationId: string;
  slug: string;
  dossierId: string;
  userId: string;
}) {
  const dossier = await getDossierById(organizationId, dossierId);
  if (!dossier) return null;

  const canReview = (await checkUserPermission(userId, organizationId, 'dossier:review')).granted;
  if (!canReview) return null;

  const [fieldReconciliations, openDiscrepancies, activeAssertions] = await Promise.all([
    getFieldReconciliation(organizationId, dossierId),
    getOpenDiscrepancies(organizationId, dossierId),
    getActiveAssertionsForDossier(organizationId, dossierId),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conciliación y validación de datos</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Campo</th>
                <th className="text-left p-2">Declarado</th>
                <th className="text-left p-2">Extraído</th>
                <th className="text-left p-2">Estado</th>
                <th className="text-left p-2">Confianza</th>
                <th className="text-left p-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {fieldReconciliations.map((row) => {
                const discrepancy = openDiscrepancies.find((d) => d.field === row.field);

                return (
                  <tr key={row.field} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="p-2 font-mono">{row.field}</td>
                    <td className="p-2">{String(row.declaredValue)}</td>
                    <td className="p-2">{row.extractedValue ? String(row.extractedValue) : '—'}</td>
                    <td className="p-2">
                      {row.extractedStatus === 'pending_validation' ? (
                        <span className="text-amber-600 dark:text-amber-400">Pendiente validación</span>
                      ) : discrepancy ? (
                        <span className="text-rose-600 dark:text-rose-400">Discrepancia</span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">Concordante</span>
                      )}
                    </td>
                    <td className="p-2">{row.extractedConfidence ? `${Math.round(parseFloat(row.extractedConfidence) * 100)}%` : '—'}</td>
                    <td className="p-2">
                      {(() => {
                        const conflictingAssertions: ConflictingAssertion[] | null = discrepancy
                          ? discrepancy.assertionIds
                              .map((id) => activeAssertions.find((a) => a.id === id))
                              .filter((a) => a !== undefined)
                              .map((a) => ({
                                id: a.id,
                                value: a.value,
                                origin: a.origin,
                                producedAt: a.producedAt.toISOString(),
                              }))
                          : null;

                        return (
                          <ReconciliationRowActions
                            organizationId={organizationId}
                            slug={slug}
                            dossierId={dossierId}
                            field={row.field}
                            extractedAssertionId={row.extractedStatus === 'pending_validation' ? row.extractedAssertionId : null}
                            extractedValue={row.extractedValue}
                            evidenceId={row.extractedSource}
                            partyId={dossier.partyId}
                            configurationVersionId={dossier.configurationVersionId}
                            discrepancyAssertions={conflictingAssertions}
                          />
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export { ReconciliationBox };
