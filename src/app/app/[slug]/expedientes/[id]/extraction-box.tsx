import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot } from 'lucide-react';
import { getLatestDocumentsForDossier } from '@/server/documents/document';
import { getAiExecutionsByDossier } from '@/server/ai/execution';
import { isDocumentTypeSupported } from '@/lib/document-type-catalog';
import { ExtractionBoxClient } from './extraction-box-client';
import { RetryExtractionButton } from './retry-extraction-button';

async function ExtractionBox({
  organizationId,
  slug,
  dossierId,
}: {
  organizationId: string;
  slug: string;
  dossierId: string;
}) {
  const allDocs = await getLatestDocumentsForDossier(organizationId, dossierId);
  const receivedDocs = allDocs.filter((d) => d.state === 'received');

  if (receivedDocs.length === 0) {
    return null;
  }

  // Load all ai_executions for this dossier, ordered by occurred_at desc
  const allExecutions = await getAiExecutionsByDossier(organizationId, dossierId);

  // Group executions by documentId; take the first (most recent) for each
  const latestExecutionByDoc = new Map<string, typeof allExecutions[0]>();
  for (const exec of allExecutions) {
    if (exec.documentId && !latestExecutionByDoc.has(exec.documentId)) {
      latestExecutionByDoc.set(exec.documentId, exec);
    }
  }

  const processedDocumentIds = new Set(latestExecutionByDoc.keys());

  // Separate pending (supported + not processed) from retryable (supported + processed + succeeded)
  const pendingDocs = receivedDocs.filter(
    (d) => isDocumentTypeSupported(d.documentType) && !processedDocumentIds.has(d.id),
  );

  const retryableDocs = receivedDocs.filter((d) => {
    if (!isDocumentTypeSupported(d.documentType)) return false;
    const latestExec = latestExecutionByDoc.get(d.id);
    return latestExec && latestExec.status === 'succeeded';
  });

  const manualDocs = receivedDocs.filter(
    (d) => !isDocumentTypeSupported(d.documentType),
  );

  if (pendingDocs.length === 0 && retryableDocs.length === 0 && manualDocs.length === 0) {
    return null;
  }

  const formatTimeAgo = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `hace ${days} día${days > 1 ? 's' : ''}`;
    if (hours > 0) return `hace ${hours} hora${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    return 'hace pocos segundos';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-purple-50 dark:bg-purple-950/50">
            <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <CardTitle className="text-base">Extracción de datos</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingDocs.length > 0 && (
          <ExtractionBoxClient
            organizationId={organizationId}
            slug={slug}
            dossierId={dossierId}
            pendingCount={pendingDocs.length}
            documentTypes={Array.from(new Set(pendingDocs.map((d) => d.documentType)))}
          />
        )}

        {retryableDocs.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Ya procesados
            </p>
            {retryableDocs.map((doc) => {
              const latestExec = latestExecutionByDoc.get(doc.id)!;
              return (
                <div key={doc.id} className="flex items-center justify-between gap-3 p-2 rounded bg-zinc-50/50 dark:bg-zinc-950/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-900 dark:text-zinc-100">{doc.documentType}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Última lectura: {formatTimeAgo(latestExec.occurredAt)}
                    </p>
                  </div>
                  <RetryExtractionButton
                    organizationId={organizationId}
                    dossierId={dossierId}
                    documentId={doc.id}
                    slug={slug}
                  />
                </div>
              );
            })}
            <p className="text-xs text-zinc-600 dark:text-zinc-400 pt-1">
              Esto agrega una nueva lectura del documento sin borrar la anterior — si hay diferencia, aparecerá como discrepancia para conciliar.
            </p>
          </div>
        )}

        {manualDocs.length > 0 && (
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            <p>Estos documentos no se procesan automáticamente:
              {' '}{manualDocs.map((d) => d.documentType).join(', ')}.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { ExtractionBox };
