import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { counterpartyTypes, requirements, configurationVersions } from '../db/schema';
import { documentValiditySchema, type DocumentValidityConfig } from '@/lib/document-validity';

export {
  CONDITION_OPERATORS,
  leafConditionSchema,
  conditionSchema,
  validationSchema,
  type Condition,
  type RequirementDetail,
  evaluateCondition,
  isRequirementCurrentlyRequired,
  validateFieldValue,
} from '@/lib/requirement-evaluation';
import { conditionSchema, validationSchema, type Condition, type RequirementDetail } from '@/lib/requirement-evaluation';

export interface AddCounterpartyTypeInput {
  organizationId: string;
  configurationVersionId: string;
  name: string;
  nature: 'natural_person' | 'legal_entity';
}

export interface AddRequirementInput {
  organizationId: string;
  configurationVersionId: string;
  counterpartyTypeId: string;
  standard: string;
  type: 'field' | 'document_type';
  key: string;
  mandatory: 'always' | 'conditional' | 'optional';
  blocking?: boolean;
  condition?: Condition;
  validation?: z.infer<typeof validationSchema>;
  validity?: DocumentValidityConfig;
}

export async function addCounterpartyType(
  input: AddCounterpartyTypeInput,
  txClient?: DrizzleClient,
): Promise<{ id: string }> {
  const client = txClient || db;

  const [version] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, input.organizationId),
        eq(configurationVersions.id, input.configurationVersionId),
      ),
    );

  if (!version) {
    throw new Error('Versión de configuración no encontrada');
  }

  if (version.status !== 'draft') {
    throw new Error('Solo se pueden modificar versiones en estado borrador');
  }

  const [inserted] = await client
    .insert(counterpartyTypes)
    .values({
      organizationId: input.organizationId,
      configurationVersionId: input.configurationVersionId,
      name: input.name,
      nature: input.nature,
    })
    .returning();

  return { id: inserted.id };
}

export async function addRequirement(
  input: AddRequirementInput,
  txClient?: DrizzleClient,
): Promise<{ id: string }> {
  const client = txClient || db;

  const [version] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, input.organizationId),
        eq(configurationVersions.id, input.configurationVersionId),
      ),
    );

  if (!version) {
    throw new Error('Versión de configuración no encontrada');
  }

  if (version.status !== 'draft') {
    throw new Error('Solo se pueden modificar versiones en estado borrador');
  }

  if (input.standard !== version.standard) {
    throw new Error(`El estándar '${input.standard}' no coincide con el estándar de la versión ('${version.standard}')`);
  }

  if (input.mandatory === 'conditional' && !input.condition) {
    throw new Error("El requisito condicional exige especificar una condición");
  }

  if (input.condition) {
    conditionSchema.parse(input.condition);
  }

  if (input.validation) {
    validationSchema.parse(input.validation);
  }

  if (input.validity) {
    if (input.type !== 'document_type') {
      throw new Error("La vigencia solo aplica a requisitos de tipo 'document_type'");
    }
    documentValiditySchema.parse(input.validity);
  }

  const [inserted] = await client
    .insert(requirements)
    .values({
      organizationId: input.organizationId,
      configurationVersionId: input.configurationVersionId,
      counterpartyTypeId: input.counterpartyTypeId,
      standard: input.standard,
      type: input.type,
      key: input.key,
      mandatory: input.mandatory,
      blocking: input.blocking !== undefined ? input.blocking : true,
      condition: input.condition || null,
      validation: input.validation || null,
      validity: input.validity || null,
    })
    .returning();

  return { id: inserted.id };
}

export async function listCounterpartyTypes(
  organizationId: string,
  configurationVersionId: string,
  txClient?: DrizzleClient,
): Promise<{ id: string; name: string; nature: string }[]> {
  const client = txClient || db;

  const rows = await client
    .select()
    .from(counterpartyTypes)
    .where(
      and(
        eq(counterpartyTypes.organizationId, organizationId),
        eq(counterpartyTypes.configurationVersionId, configurationVersionId),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nature: r.nature,
  }));
}

export async function getRequirementsForType(
  organizationId: string,
  configurationVersionId: string,
  counterpartyTypeId: string,
  txClient?: DrizzleClient,
): Promise<RequirementDetail[]> {
  const client = txClient || db;

  const rows = await client
    .select()
    .from(requirements)
    .where(
      and(
        eq(requirements.organizationId, organizationId),
        eq(requirements.configurationVersionId, configurationVersionId),
        eq(requirements.counterpartyTypeId, counterpartyTypeId),
      ),
    );

  return rows.map((r) => ({
    requirementId: r.id,
    standard: r.standard,
    type: r.type as 'field' | 'document_type',
    key: r.key,
    mandatory: r.mandatory as 'always' | 'conditional' | 'optional',
    blocking: r.blocking,
    condition: r.condition as Condition | null,
    validation: r.validation as z.infer<typeof validationSchema> | null,
    validity: r.validity as DocumentValidityConfig | null,
  }));
}

export async function assertRequirementMatrixIsComplete(
  organizationId: string,
  configurationVersionId: string,
  txClient: DatabaseTransaction,
): Promise<void> {
  const client = txClient;

  const types = await client
    .select()
    .from(counterpartyTypes)
    .where(
      and(
        eq(counterpartyTypes.organizationId, organizationId),
        eq(counterpartyTypes.configurationVersionId, configurationVersionId),
      ),
    );

  // If no counterparty types are registered in this version, it's not considered incomplete
  if (types.length === 0) {
    return;
  }

  const allReqs = await client
    .select()
    .from(requirements)
    .where(
      and(
        eq(requirements.organizationId, organizationId),
        eq(requirements.configurationVersionId, configurationVersionId),
      ),
    );

  const reqCountByType = new Map<string, number>();
  for (const req of allReqs) {
    const current = reqCountByType.get(req.counterpartyTypeId) || 0;
    reqCountByType.set(req.counterpartyTypeId, current + 1);
  }

  const incompleteTypes: string[] = [];
  for (const t of types) {
    const count = reqCountByType.get(t.id) || 0;
    if (count === 0) {
      incompleteTypes.push(t.name);
    }
  }

  if (incompleteTypes.length > 0) {
    throw new Error(
      `La matriz de requisitos está incompleta: los siguientes tipos de contraparte no tienen ningún requisito definido: ${incompleteTypes.join(', ')}`,
    );
  }
}

export async function removeRequirement(
  organizationId: string,
  configurationVersionId: string,
  requirementId: string,
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  // Verify that the configuration version is a draft
  const [version] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.id, configurationVersionId),
      ),
    );

  if (!version) {
    throw new Error('Versión de configuración no encontrada');
  }

  if (version.status !== 'draft') {
    throw new Error('Solo se pueden eliminar requisitos de versiones en estado borrador');
  }

  // Delete the requirement
  await client
    .delete(requirements)
    .where(
      and(
        eq(requirements.id, requirementId),
        eq(requirements.organizationId, organizationId),
        eq(requirements.configurationVersionId, configurationVersionId),
      ),
    );
}

export async function removeCounterpartyType(
  organizationId: string,
  configurationVersionId: string,
  counterpartyTypeId: string,
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  // Verify that the configuration version is a draft
  const [version] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.id, configurationVersionId),
      ),
    );

  if (!version) {
    throw new Error('Versión de configuración no encontrada');
  }

  if (version.status !== 'draft') {
    throw new Error('Solo se pueden eliminar tipos de contraparte de versiones en estado borrador');
  }

  // First delete all requirements for this type (no ON DELETE CASCADE, so do it manually)
  await client
    .delete(requirements)
    .where(
      and(
        eq(requirements.organizationId, organizationId),
        eq(requirements.configurationVersionId, configurationVersionId),
        eq(requirements.counterpartyTypeId, counterpartyTypeId),
      ),
    );

  // Then delete the type
  await client
    .delete(counterpartyTypes)
    .where(
      and(
        eq(counterpartyTypes.id, counterpartyTypeId),
        eq(counterpartyTypes.organizationId, organizationId),
        eq(counterpartyTypes.configurationVersionId, configurationVersionId),
      ),
    );
}