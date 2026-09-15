import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { dossiers } from '../db/schema';
import {
  type RequirementDetail,
  isRequirementCurrentlyRequired,
  validateFieldValue,
} from '@/lib/requirement-evaluation';
import { getDossierPendingRequirements } from './dossier';
import {
  registerAssertion,
  getLatestDeclaredValuesForDossier,
  getActiveAssertionsForDossier,
} from '../assertions/service';
import { areValuesEqual } from '@/lib/value-comparison';
import { executeTransition } from './state-machine';
import { getLatestDocumentsForDossier } from '../documents/document';

export class IncompleteDeclarationError extends Error {
  constructor(
    public missingFields: string[],
    public missingDocumentTypes: string[] = [],
  ) {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`campos obligatorios: ${missingFields.join(', ')}`);
    }
    if (missingDocumentTypes.length > 0) {
      parts.push(`documentos obligatorios: ${missingDocumentTypes.join(', ')}`);
    }
    super(`Faltan requisitos obligatorios por entregar (${parts.join('; ')})`);
    this.name = 'IncompleteDeclarationError';
  }
}

export interface FieldSuggestion {
  value: unknown;
  assertionId: string;
  evidenceId: string | null;
  confidence: string | null;
}

export interface DeclarationFormData {
  dossierState: string;
  fieldRequirements: RequirementDetail[];
  documentRequirements: RequirementDetail[];
  values: Record<string, unknown>;
  suggestions: Record<string, FieldSuggestion>;
}

/**
 * Retrieves the declaration form data for a dossier, including frozen requirements, current values, and AI suggestions.
 */
export async function getDeclarationForm(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<DeclarationFormData> {
  const client = txClient || db;

  const [dossier] = await client
    .select({
      id: dossiers.id,
      state: dossiers.state,
    })
    .from(dossiers)
    .where(
      and(
        eq(dossiers.organizationId, organizationId),
        eq(dossiers.id, dossierId),
      ),
    )
    .limit(1);

  if (!dossier) {
    throw new Error('Expediente no encontrado');
  }

  const allRequirements = await getDossierPendingRequirements(organizationId, dossierId, client);
  const fieldRequirements = allRequirements.filter((r) => r.type === 'field');
  const documentRequirements = allRequirements.filter((r) => r.type === 'document_type');

  const latestValues = await getLatestDeclaredValuesForDossier(organizationId, dossierId, client);
  const values: Record<string, unknown> = {};
  for (const item of latestValues) {
    values[item.field] = item.value;
  }

  // Calculate suggestions from extracted assertions
  const suggestions: Record<string, FieldSuggestion> = {};
  const activeAssertions = await getActiveAssertionsForDossier(organizationId, dossierId, client);

  // Group extracted assertions by field, taking the most recent
  const extractedByField = new Map<string, (typeof activeAssertions)[number]>();
  for (const assertion of activeAssertions) {
    if (assertion.origin === 'extracted') {
      const existing = extractedByField.get(assertion.field);
      // Keep the most recent (already ordered by producedAt desc from getActiveAssertionsForDossier)
      if (!existing) {
        extractedByField.set(assertion.field, assertion);
      }
    }
  }

  // Build suggestions: include if no declared value or if declared value differs from extracted
  for (const [field, extracted] of extractedByField.entries()) {
    const declaredValue = values[field];
    const shouldInclude =
      declaredValue === undefined || !areValuesEqual(declaredValue, extracted.value);

    if (shouldInclude) {
      suggestions[field] = {
        value: extracted.value,
        assertionId: extracted.id,
        evidenceId: extracted.evidenceId,
        confidence: extracted.confidence,
      };
    }
  }

  return {
    dossierState: dossier.state,
    fieldRequirements,
    documentRequirements,
    values,
    suggestions,
  };
}

/**
 * Saves declared field values as new immutable assertions with origin 'declared'.
 */
export async function saveDeclaredFields(
  input: { organizationId: string; dossierId: string; fields: Record<string, unknown> },
  txClient?: DrizzleClient,
): Promise<void> {
  const execute = async (tx: DatabaseTransaction) => {
    // 1. Cargar el expediente; si state !== 'en_diligenciamiento', rechazar
    const [dossier] = await tx
      .select()
      .from(dossiers)
      .where(
        and(
          eq(dossiers.organizationId, input.organizationId),
          eq(dossiers.id, input.dossierId),
        ),
      )
      .limit(1);

    if (!dossier) {
      throw new Error('Expediente no encontrado');
    }

    if (dossier.state !== 'en_diligenciamiento') {
      throw new Error(
        `No se pueden guardar datos en un expediente en estado '${dossier.state}'. Solo se permite en 'en_diligenciamiento'.`,
      );
    }

    if (!dossier.partyId) {
      throw new Error('El expediente no tiene sujeto contraparte asignado');
    }

    // 2. Cargar los requisitos type: 'field' de la matriz congelada del expediente
    const allRequirements = await getDossierPendingRequirements(input.organizationId, input.dossierId, tx);
    const fieldRequirements = allRequirements.filter((r) => r.type === 'field');
    const allowedFieldKeysMap = new Map(fieldRequirements.map((r) => [r.key, r]));

    // Cada clave de input.fields tiene que existir en ese conjunto — si no, rechazar esa clave
    for (const key of Object.keys(input.fields)) {
      if (!allowedFieldKeysMap.has(key)) {
        throw new Error(`El campo '${key}' no pertenece a los requisitos exigidos para este expediente`);
      }
    }

    // 3. Para cada clave válida: validateFieldValue contra la validation del requisito
    const validationErrors: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.fields)) {
      const req = allowedFieldKeysMap.get(key)!;
      const error = validateFieldValue(value, req.validation);
      if (error) {
        validationErrors[key] = error;
      }
    }

    if (Object.keys(validationErrors).length > 0) {
      const errorMsg = Object.entries(validationErrors)
        .map(([k, err]) => `${k}: ${err}`)
        .join('; ');
      throw new Error(`Errores de validación: ${errorMsg}`);
    }

    // 4. Comparar contra getLatestDeclaredValuesForDossier — si no cambió, no duplicar fila
    const latestValues = await getLatestDeclaredValuesForDossier(input.organizationId, input.dossierId, tx);
    const latestValuesMap = new Map(latestValues.map((v) => [v.field, v.value]));

    // 5. Para lo que sí cambió: registerAssertion
    for (const [key, value] of Object.entries(input.fields)) {
      const existingVal = latestValuesMap.get(key);
      const isUnchanged = JSON.stringify(existingVal) === JSON.stringify(value);

      if (!isUnchanged) {
        await registerAssertion(
          {
            organizationId: input.organizationId,
            dossierId: input.dossierId,
            partyId: dossier.partyId,
            configurationVersionId: dossier.configurationVersionId,
            field: key,
            value,
            origin: 'declared',
            producedBy: undefined,
          },
          tx,
        );
      }
    }
  };

  if (txClient && 'execute' in txClient) {
    return execute(txClient as DatabaseTransaction);
  }
  return db.transaction(execute);
}

/**
 * Validates that all currently required fields are declared, then transitions dossier to 'documentos_recibidos'.
 */
export async function completeDeclaration(
  input: { organizationId: string; dossierId: string },
  txClient?: DrizzleClient,
): Promise<void> {
  const execute = async (tx: DatabaseTransaction) => {
    // 1. Cargar expediente; si state !== 'en_diligenciamiento', rechazar
    const [dossier] = await tx
      .select()
      .from(dossiers)
      .where(
        and(
          eq(dossiers.organizationId, input.organizationId),
          eq(dossiers.id, input.dossierId),
        ),
      )
      .limit(1);

    if (!dossier) {
      throw new Error('Expediente no encontrado');
    }

    if (dossier.state !== 'en_diligenciamiento') {
      throw new Error(
        `No se puede finalizar la declaración de un expediente en estado '${dossier.state}'`,
      );
    }

    // 2. Cargar requisitos (field y document_type) + getLatestDeclaredValuesForDossier
    const allRequirements = await getDossierPendingRequirements(input.organizationId, input.dossierId, tx);
    const fieldRequirements = allRequirements.filter((r) => r.type === 'field');
    const documentRequirements = allRequirements.filter((r) => r.type === 'document_type');

    const latestValues = await getLatestDeclaredValuesForDossier(input.organizationId, input.dossierId, tx);
    const values: Record<string, unknown> = {};
    for (const item of latestValues) {
      values[item.field] = item.value;
    }

    // 3. Para cada requisito de campo, isRequirementCurrentlyRequired(req, values)
    const missingFields: string[] = [];
    for (const req of fieldRequirements) {
      const isRequired = isRequirementCurrentlyRequired(req, values);
      if (isRequired) {
        const val = values[req.key];
        if (val === undefined || val === null || val === '') {
          missingFields.push(req.key);
        }
      }
    }

    // 4. Para cada requisito de documento obligatorio, verificar que exista en getLatestDocumentsForDossier no rechazado ni vencido
    const latestDocs = await getLatestDocumentsForDossier(input.organizationId, input.dossierId, tx);
    const deliveredDocTypes = new Set(
      latestDocs.filter((d) => d.state !== 'rejected' && d.state !== 'expired').map((d) => d.documentType),
    );

    const missingDocumentTypes: string[] = [];
    for (const req of documentRequirements) {
      const isRequired = isRequirementCurrentlyRequired(req, values);
      if (isRequired && !deliveredDocTypes.has(req.key)) {
        missingDocumentTypes.push(req.key);
      }
    }

    // 5. Si faltan campos o documentos obligatorios, lanzar IncompleteDeclarationError
    if (missingFields.length > 0 || missingDocumentTypes.length > 0) {
      throw new IncompleteDeclarationError(missingFields, missingDocumentTypes);
    }

    // 6. Transición a 'documentos_recibidos' con actorType 'counterparty'
    await executeTransition(
      {
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        toState: 'documentos_recibidos',
        actorType: 'counterparty',
      },
      tx,
    );
  };

  if (txClient && 'execute' in txClient) {
    return execute(txClient as DatabaseTransaction);
  }
  return db.transaction(execute);
}
