import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient } from '../db/client';
import { documents, dossiers } from '../db/schema';
import { fetchDocumentFragment } from './document-fragment';
import { defaultMultimodalEngine } from './multimodal-engine';
import { type ExtractionEngine } from './port';
import { recordAiExecution } from '../ai/execution';
import { registerAssertion } from '../assertions/service';
import { markDocumentRequiresReview } from '../documents/document';
import { getRequirementsForType } from '../configuration/requirement-matrix';
import { isDocumentTypeSupported } from '@/lib/document-type-catalog';

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
