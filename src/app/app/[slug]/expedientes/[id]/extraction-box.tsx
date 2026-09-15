import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bot } from 'lucide-react';
import { getLatestDocumentsForDossier } from '@/server/documents/document';
import { db } from '@/server/db/client';
import { aiExecutions } from '@/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { isDocumentTypeSupported } from '@/lib/document-type-catalog';
import { ExtractionBoxClient } from './extraction-box-client';

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

  // Load all ai_executions for this dossier
  const allExecutions = await db
    .select({ documentId: aiExecutions.documentId })
    .from(aiExecutions)
    .where(
      and(
        eq(aiExecutions.organizationId, organizationId),
        eq(aiExecutions.dossierId, dossierId),
      ),
    );

  const processedDocumentIds = new Set(
    allExecutions.map((e) => e.documentId).filter((id) => id !== null),
  );

  // Separate pending (supported + not processed) from manual (not supported)
  const pendingDocs = receivedDocs.filter(
    (d) => isDocumentTypeSupported(d.documentType) && !processedDocumentIds.has(d.id),
  );

  const manualDocs = receivedDocs.filter(
    (d) => !isDocumentTypeSupported(d.documentType),
  );

  if (pendingDocs.length === 0 && manualDocs.length === 0) {
    return null;
  }

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
