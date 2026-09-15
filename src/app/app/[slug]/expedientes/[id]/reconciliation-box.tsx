import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { getDossierById } from '@/server/dossiers/dossier';
import { getFieldReconciliation, getOpenDiscrepancies } from '@/server/reconciliation/service';
import { checkUserPermission } from '@/server/auth/access-control';
import {
  confirmExtractedFieldAction,
  discardExtractedFieldAction,
  correctExtractedFieldAction,
  resolveDiscrepancyAction,
} from './reconciliation-actions';

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

  const [fieldReconciliations, openDiscrepancies] = await Promise.all([
    getFieldReconciliation(organizationId, dossierId),
    getOpenDiscrepancies(organizationId, dossierId),
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
                        <span className="text-red-600 dark:text-red-400">Discrepancia</span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400">Concordante</span>
                      )}
                    </td>
                    <td className="p-2">{row.extractedConfidence ? `${Math.round(parseFloat(row.extractedConfidence) * 100)}%` : '—'}</td>
                    <td className="p-2 space-y-1">
                      {discrepancy && (
                        <form
                          action={async (formData) => {
                            'use server';
                            const selectedId = formData.get('selected_assertion_id');
                            const reason = formData.get('reason');
                            if (selectedId && reason) {
                              await resolveDiscrepancyAction(organizationId, slug, dossierId, row.field, String(selectedId), String(reason));
                            }
                          }}
                        >
                          <select name="selected_assertion_id" className="text-xs border px-1 py-0.5">
                            {discrepancy.assertionIds.map((id) => (
                              <option key={id} value={id}>
                                {id.slice(0, 8)}...
                              </option>
                            ))}
                          </select>
                          <input name="reason" type="text" placeholder="Motivo..." className="text-xs border px-1 py-0.5 w-full" />
                          <button type="submit" className="text-xs bg-blue-500 text-white px-2 py-1 rounded">
                            Resolver
                          </button>
                        </form>
                      )}
                      {row.extractedStatus === 'pending_validation' && row.extractedAssertionId && (
                        <div className="space-y-1">
                          <form
                            action={async () => {
                              'use server';
                              await confirmExtractedFieldAction(organizationId, slug, dossierId, row.extractedAssertionId!);
                            }}
                          >
                            <button type="submit" className="text-xs bg-green-500 text-white px-2 py-1 rounded w-full">
                              Confirmar
                            </button>
                          </form>
                          <form
                            action={async (formData) => {
                              'use server';
                              const reason = formData.get('reason');
                              if (reason) {
                                await discardExtractedFieldAction(organizationId, slug, dossierId, row.extractedAssertionId!, String(reason));
                              }
                            }}
                          >
                            <input name="reason" type="text" placeholder="Motivo..." className="text-xs border px-1 py-0.5 w-full" />
                            <button type="submit" className="text-xs bg-red-500 text-white px-2 py-1 rounded w-full">
                              Descartar
                            </button>
                          </form>
                          <form
                            action={async (formData) => {
                              'use server';
                              const value = formData.get('value');
                              const reason = formData.get('reason');
                              if (value && reason) {
                                await correctExtractedFieldAction(
                                  organizationId,
                                  slug,
                                  dossierId,
                                  row.extractedAssertionId!,
                                  String(value),
                                  String(reason),
                                  row.extractedSource || '',
                                  dossier.partyId,
                                  dossier.configurationVersionId,
                                );
                              }
                            }}
                          >
                            <input name="value" type="text" placeholder="Valor correcto..." className="text-xs border px-1 py-0.5 w-full" />
                            <input name="reason" type="text" placeholder="Motivo..." className="text-xs border px-1 py-0.5 w-full" />
                            <button type="submit" className="text-xs bg-amber-500 text-white px-2 py-1 rounded w-full">
                              Corregir
                            </button>
                          </form>
                        </div>
                      )}
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
