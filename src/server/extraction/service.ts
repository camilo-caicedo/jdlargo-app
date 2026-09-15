import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient } from '../db/client';
import { documents, dossiers, aiExecutions } from '../db/schema';
import { fetchDocumentFragment } from './document-fragment';
import { defaultMultimodalEngine } from './multimodal-engine';
import { type ExtractionEngine } from './port';
import { recordAiExecution } from '../ai/execution';
import { registerAssertion } from '../assertions/service';
import { markDocumentRequiresReview } from '../documents/document';
import { getRequirementsForType } from '../configuration/requirement-matrix';
import { isDocumentTypeSupported } from '@/lib/document-type-catalog';
import { type DocumentValidityConfig } from '@/lib/document-validity';

export interface RunDocumentExtractionInput {
  organizationId: string;
  dossierId: string;
  documentId: string;
  engine?: ExtractionEngine; // Permite inyectar motor falso para pruebas
}

export interface RunDocumentExtractionResult {
  aiExecutionId: string | null;
  status: 'succeeded' | 'failed' | 'unsupported_document_type';
  assertionsCreated: number;
}

export async function runDocumentExtraction(
  input: RunDocumentExtractionInput,
  txClient?: DrizzleClient,
): Promise<RunDocumentExtractionResult> {
  const client = txClient || db;
  const engine = input.engine || defaultMultimodalEngine;

  // 1. Carga el documento; si state !== 'received', rechaza
  const [doc] = await client
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, input.organizationId),
        eq(documents.dossierId, input.dossierId),
        eq(documents.id, input.documentId),
      ),
    )
    .limit(1);

  if (!doc) {
    throw new Error('Documento no encontrado en el expediente especificado');
  }

  if (doc.state !== 'received') {
    throw new Error(`El documento no está en estado 'received' (estado actual: '${doc.state}')`);
  }

  // Guard: verificar que el tipo de documento está soportado por el motor de IA
  if (!isDocumentTypeSupported(doc.documentType)) {
    await markDocumentRequiresReview(
      {
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        documentId: input.documentId,
        reason: `Tipo de documento no soportado por IA: ${doc.documentType}`,
      },
      client,
    );
    return {
      aiExecutionId: null,
      status: 'unsupported_document_type',
      assertionsCreated: 0,
    };
  }

  // Carga expediente para obtener partyId, counterpartyTypeId y configurationVersionId
  const [dossier] = await client
    .select()
    .from(dossiers)
    .where(
      and(
        eq(dossiers.organizationId, input.organizationId),
        eq(dossiers.id, input.dossierId),
      ),
    )
    .limit(1);

  if (!dossier || !dossier.partyId || !dossier.counterpartyTypeId) {
    throw new Error('Expediente incompleto o no encontrado');
  }

  // 2. Descarga el fragmento (document-fragment.ts) y calcula su huella
  const fragment = await fetchDocumentFragment(doc.storagePath, doc.format as 'pdf' | 'jpg' | 'png');

  // 3. Resuelve los expectedFields desde getRequirementsForType filtrando type: 'field'
  const allReqs = await getRequirementsForType(
    input.organizationId,
    dossier.configurationVersionId,
    dossier.counterpartyTypeId,
    client,
  );

  const expectedFields = allReqs
    .filter((r) => r.type === 'field')
    .map((r) => ({
      key: r.key,
      label: r.key,
    }));

  // 3b. Agregar campos de fecha si el tipo documental tiene vigencia configurada
  const docTypeReq = allReqs.find((r) => r.type === 'document_type' && r.key === doc.documentType);
  if (docTypeReq?.validity) {
    const validity = docTypeReq.validity as DocumentValidityConfig;
    if (validity.mode === 'duration_from_issued') {
      expectedFields.push({ key: `document:${doc.documentType}:issued_at`, label: 'Fecha de expedición del documento' });
    } else if (validity.mode === 'fixed_date') {
      expectedFields.push({ key: `document:${doc.documentType}:expires_at`, label: 'Fecha de vencimiento del documento' });
    }
  }

  // 4. Llama al motor de extracción
  const engineResult = await engine.extract({
    documentBytes: fragment.bytes,
    mimeType: fragment.mimeType,
    expectedFields,
  });

  // 5. SIEMPRE llama recordAiExecution con el resultado (éxito o fallo)
  const execution = await recordAiExecution(
    {
      organizationId: input.organizationId,
      dossierId: input.dossierId,
      documentId: input.documentId,
      provider: engineResult.provider,
      model: engineResult.model,
      modelVersion: engineResult.modelVersion,
      instructionTemplateId: engineResult.instructionTemplateId,
      instructionTemplateVersion: engineResult.instructionTemplateVersion,
      dataDestination: engineResult.dataDestination,
      sentFragmentHash: fragment.hash,
      status: engineResult.status,
      result: engineResult.fields ? { fields: engineResult.fields } : undefined,
      confidence:
        engineResult.fields && engineResult.fields.length > 0
          ? (
              engineResult.fields.reduce((acc, f) => acc + f.confidence, 0) /
              engineResult.fields.length
            ).toFixed(2)
          : undefined,
      failureReason: engineResult.failureReason,
    },
    client,
  );

  // 6. Si succeeded: por cada ExtractionFieldResult, registerAssertion
  if (engineResult.status === 'succeeded' && engineResult.fields) {
    let assertionsCreated = 0;

    for (const f of engineResult.fields) {
      await registerAssertion(
        {
          organizationId: input.organizationId,
          dossierId: input.dossierId,
          partyId: dossier.partyId,
          configurationVersionId: dossier.configurationVersionId,
          field: f.field,
          value: f.value,
          origin: 'extracted',
          aiExecutionId: execution.id,
          evidenceId: input.documentId,
          confidence: f.confidence.toFixed(2),
          aiModelMetadata: {
            provider: engineResult.provider,
            model: engineResult.model,
            version: engineResult.modelVersion,
            promptTemplate: engineResult.instructionTemplateId,
          },
        },
        client,
      );
      assertionsCreated++;
    }

    return {
      aiExecutionId: execution.id,
      status: 'succeeded',
      assertionsCreated,
    };
  }

  // 7. Si failed: markDocumentRequiresReview con el motivo
  await markDocumentRequiresReview(
    {
      organizationId: input.organizationId,
      dossierId: input.dossierId,
      documentId: input.documentId,
      reason: engineResult.failureReason || 'Extracción de datos fallida',
    },
    client,
  );

  return {
    aiExecutionId: execution.id,
    status: 'failed',
    assertionsCreated: 0,
  };
}

export interface RunExtractionForPendingDocumentsResult {
  processed: number;
  succeeded: number;
  failed: number;
  results: Array<{ documentId: string; status: RunDocumentExtractionResult['status'] }>;
}

export async function runExtractionForPendingDocuments(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
  engine?: ExtractionEngine,
): Promise<RunExtractionForPendingDocumentsResult> {
  const client = txClient || db;

  // Load all documents in 'received' state
  const allDocs = await client
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.dossierId, dossierId),
        eq(documents.state, 'received'),
      ),
    );

  // Load all ai_executions for this dossier
  const allExecutions = await client
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

  // Filter pending documents: received + supported type + no prior execution
  const pendingDocs = allDocs.filter(
    (doc) =>
      isDocumentTypeSupported(doc.documentType) && !processedDocumentIds.has(doc.id),
  );

  // Process each pending document sequentially
  const results: RunExtractionForPendingDocumentsResult['results'] = [];
  let succeeded = 0;
  let failed = 0;

  for (const doc of pendingDocs) {
    const result = await runDocumentExtraction(
      {
        organizationId,
        dossierId,
        documentId: doc.id,
        engine,
      },
      client,
    );

    results.push({ documentId: doc.id, status: result.status });

    if (result.status === 'succeeded') {
      succeeded++;
    } else if (result.status === 'failed') {
      failed++;
    }
  }

  return {
    processed: pendingDocs.length,
    succeeded,
    failed,
    results,
  };
}
