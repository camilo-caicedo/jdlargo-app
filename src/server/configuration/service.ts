import { sql, eq, and, desc, lte } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { configurationVersions, roles, rolePermissions, privacyNotices, counterpartyTypes, requirements } from '../db/schema';
import type { PermissionKey } from '../auth/permissions';
import { enforceUserPermission } from '../auth/access-control';
import { logAuditEvent } from '../audit/service';
import { assertRequirementMatrixIsComplete, listCounterpartyTypes, getRequirementsForType } from './requirement-matrix';
import { assertPrivacyNoticeExists, getPrivacyNoticeForVersion } from './privacy-notice';
import type { PrivacyNoticeDetail } from './privacy-notice';
import { BASE_ROLES_TEMPLATE } from '../auth/role-config';

export interface DraftRoleInput {
  code: string;
  name: string;
  description?: string;
  permissions: PermissionKey[];
}

export interface CreateDraftInput {
  organizationId: string;
  standard?: string;
  referenceRegulation?: string;
  rolesConfig?: DraftRoleInput[];
  signatureLevelRequired?: number;
}

export interface UpdateDraftInput {
  standard?: string;
  referenceRegulation?: string;
  rolesConfig?: DraftRoleInput[];
  signatureLevelRequired?: number;
}

export interface PublishDraftInput {
  organizationId: string;
  versionId: string;
  publishedBy: string;
  reason: string;
  effectiveFrom?: Date;
}

export interface ConfigurationRoleDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: PermissionKey[];
}

export interface CounterpartyTypeWithRequirements {
  id: string;
  name: string;
  nature: 'natural_person' | 'legal_entity';
  requirements: {
    id: string;
    type: 'field' | 'document_type';
    key: string;
    mandatory: 'always' | 'conditional' | 'optional';
    blocking: boolean;
  }[];
}

export interface ConfigurationVersionDetail {
  id: string;
  organizationId: string;
  versionNumber: string;
  status: 'draft' | 'published' | 'replaced';
  standard: string | null;
  referenceRegulation: string | null;
  effectiveFrom: Date;
  publishedBy: string | null;
  publishedAt: Date | null;
  reason: string | null;
  signatureLevelRequired: number;
  roles: ConfigurationRoleDetail[];
  counterpartyTypes: CounterpartyTypeWithRequirements[];
  privacyNotice: Pick<PrivacyNoticeDetail, 'id' | 'text' | 'purposes'> | null;
}

export interface VersionDiffResult {
  previousVersionNumber: string;
  newVersionNumber: string;
  rolesAdded: string[];
  rolesRemoved: string[];
  permissionsChanged: {
    roleCode: string;
    added: PermissionKey[];
    removed: PermissionKey[];
  }[];
  counterpartyTypesAdded: string[];
  counterpartyTypesRemoved: string[];
  requirementsChanged: {
    counterpartyTypeName: string;
    added: string[];
    removed: string[];
  }[];
  privacyNoticeChanged: boolean;
}

/**
 * Creates a new configuration version in 'draft' status.
 * Draft versions can be updated freely and DO NOT govern production until published.
 */
export async function createDraftConfiguration(
  input: CreateDraftInput,
  txClient?: DrizzleClient,
): Promise<{ versionId: string; versionNumber: string }> {
  const client = txClient || db;

  // Validate signature level (only 1 and 2 are supported)
  if (
    input.signatureLevelRequired !== undefined
    && input.signatureLevelRequired !== 1
    && input.signatureLevelRequired !== 2
  ) {
    throw new Error(
      'El nivel de firma 3 (certificada) requiere un proveedor externo no integrado en esta plataforma todavía',
    );
  }

  // Calculate next version number and get last published for inheritance
  const existing = await client
    .select()
    .from(configurationVersions)
    .where(eq(configurationVersions.organizationId, input.organizationId))
    .orderBy(desc(configurationVersions.createdAt));

  const nextNumber = (existing.length + 1).toString();

  // Find last published version to inherit defaults for unspecified fields
  const lastPublished = existing.find((v) => v.status === 'published');

  const [draftVer] = await client
    .insert(configurationVersions)
    .values({
      organizationId: input.organizationId,
      versionNumber: nextNumber,
      status: 'draft',
      standard: input.standard || lastPublished?.standard || 'SARLAFT',
      referenceRegulation: input.referenceRegulation !== undefined ? input.referenceRegulation : lastPublished?.referenceRegulation || null,
      effectiveFrom: new Date(),
      signatureLevelRequired: input.signatureLevelRequired !== undefined ? input.signatureLevelRequired : (lastPublished?.signatureLevelRequired ?? 1),
    })
    .returning();

  if (input.rolesConfig && input.rolesConfig.length > 0) {
    for (const roleData of input.rolesConfig) {
      const [newRole] = await client
        .insert(roles)
        .values({
          organizationId: input.organizationId,
          configurationVersionId: draftVer.id,
          name: roleData.name,
          code: roleData.code,
          description: roleData.description || null,
        })
        .returning();

      if (roleData.permissions.length > 0) {
        await client.insert(rolePermissions).values(
          roleData.permissions.map((perm) => ({
            organizationId: input.organizationId,
            configurationVersionId: draftVer.id,
            roleId: newRole.id,
            permissionKey: perm,
          })),
        );
      }
    }
  } else {
    // If no rolesConfig is specified, inherit from currently active published version (or template)
    const activeVersion = await getActiveConfiguration(input.organizationId, client);
    const rolesToApply = activeVersion && activeVersion.roles.length > 0
      ? activeVersion.roles
      : BASE_ROLES_TEMPLATE.map((r) => ({
          code: r.code,
          name: r.name,
          description: r.description,
          permissions: [...r.permissions],
        }));

    for (const roleData of rolesToApply) {
      const [newRole] = await client
        .insert(roles)
        .values({
          organizationId: input.organizationId,
          configurationVersionId: draftVer.id,
          name: roleData.name,
          code: roleData.code,
          description: roleData.description || null,
        })
        .returning();

      if (roleData.permissions.length > 0) {
        await client.insert(rolePermissions).values(
          roleData.permissions.map((perm) => ({
            organizationId: input.organizationId,
            configurationVersionId: draftVer.id,
            roleId: newRole.id,
            permissionKey: perm,
          })),
        );
      }
    }
  }

  // Always inherit privacy notice from active version if present (HU-011, HU-062)
  const activeVersionForNotice = await getActiveConfiguration(input.organizationId, client);
  if (activeVersionForNotice) {
    const [activeNotice] = await client
      .select()
      .from(privacyNotices)
      .where(
        and(
          eq(privacyNotices.organizationId, input.organizationId),
          eq(privacyNotices.configurationVersionId, activeVersionForNotice.id),
        ),
      )
      .limit(1);

    if (activeNotice) {
      await client.insert(privacyNotices).values({
        organizationId: input.organizationId,
        configurationVersionId: draftVer.id,
        text: activeNotice.text,
        purposes: activeNotice.purposes,
        dataController: activeNotice.dataController,
        dataProcessor: activeNotice.dataProcessor,
        rightsChannels: activeNotice.rightsChannels,
      });
    }

    // Clone counterparty types and their requirements from active version
    const activeTypes = await listCounterpartyTypes(input.organizationId, activeVersionForNotice.id, client);
    for (const type of activeTypes) {
      const [newType] = await client
        .insert(counterpartyTypes)
        .values({
          organizationId: input.organizationId,
          configurationVersionId: draftVer.id,
          name: type.name,
          nature: type.nature as 'natural_person' | 'legal_entity',
        })
        .returning();

      const typeRequirements = await getRequirementsForType(
        input.organizationId,
        activeVersionForNotice.id,
        type.id,
        client,
      );
      if (typeRequirements.length > 0) {
        const reqValues = typeRequirements.map((r) => ({
          organizationId: input.organizationId,
          configurationVersionId: draftVer.id,
          counterpartyTypeId: newType.id,
          standard: r.standard,
          type: r.type,
          key: r.key,
          mandatory: r.mandatory,
          blocking: r.blocking,
          condition: r.condition,
          validation: r.validation,
          validity: r.validity,
        }));
        await client.insert(requirements).values(reqValues);
      }
    }
  }

  return { versionId: draftVer.id, versionNumber: nextNumber };
}

/**
 * Updates a draft configuration version and its roles/permissions.
 * Throws if the version is not in 'draft' status.
 */
export async function updateDraftConfiguration(
  organizationId: string,
  versionId: string,
  input: UpdateDraftInput,
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  // Validate signature level (only 1 and 2 are supported)
  if (
    input.signatureLevelRequired !== undefined
    && input.signatureLevelRequired !== 1
    && input.signatureLevelRequired !== 2
  ) {
    throw new Error(
      'El nivel de firma 3 (certificada) requiere un proveedor externo no integrado en esta plataforma todavía',
    );
  }

  const [existing] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.id, versionId),
      ),
    );

  if (!existing) {
    throw new Error('Versión de configuración no encontrada');
  }

  if (existing.status !== 'draft') {
    throw new Error('Solo se pueden modificar versiones en estado borrador');
  }

  // Update header fields
  await client
    .update(configurationVersions)
    .set({
      standard: input.standard !== undefined ? input.standard : existing.standard,
      referenceRegulation:
        input.referenceRegulation !== undefined ? input.referenceRegulation : existing.referenceRegulation,
      signatureLevelRequired:
        input.signatureLevelRequired !== undefined ? input.signatureLevelRequired : existing.signatureLevelRequired,
    })
    .where(eq(configurationVersions.id, versionId));

  // If rolesConfig is provided, replace roles for this draft version
  if (input.rolesConfig) {
    await client
      .delete(rolePermissions)
      .where(eq(rolePermissions.configurationVersionId, versionId));
    await client
      .delete(roles)
      .where(eq(roles.configurationVersionId, versionId));

    for (const roleData of input.rolesConfig) {
      const [newRole] = await client
        .insert(roles)
        .values({
          organizationId,
          configurationVersionId: versionId,
          name: roleData.name,
          code: roleData.code,
          description: roleData.description || null,
        })
        .returning();

      if (roleData.permissions.length > 0) {
        await client.insert(rolePermissions).values(
          roleData.permissions.map((perm) => ({
            organizationId,
            configurationVersionId: versionId,
            roleId: newRole.id,
            permissionKey: perm,
          })),
        );
      }
    }
  }
}

/**
 * Publishes a configuration version.
 * Requires the caller to have the 'configuration:publish' permission.
 * Marks the previous published version as 'replaced'.
 */
export async function publishDraftConfiguration(
  input: PublishDraftInput,
  txClient?: DrizzleClient,
): Promise<ConfigurationVersionDetail> {
  // Validate reason is mandatory and non-empty (HU-004)
  if (!input.reason || input.reason.trim() === '') {
    throw new Error('La publicación de una versión exige un motivo explícito no vacío');
  }

  // 1. Enforce permission (HU-004 Escenario: Publicar exige el permiso correspondiente)
  await enforceUserPermission(
    {
      userId: input.publishedBy,
      organizationId: input.organizationId,
    },
    'configuration:publish',
    { versionId: input.versionId, reason: input.reason },
    txClient,
  );

  const execute = async (tx: DatabaseTransaction) => {
    const [draft] = await tx
      .select()
      .from(configurationVersions)
      .where(
        and(
          eq(configurationVersions.organizationId, input.organizationId),
          eq(configurationVersions.id, input.versionId),
        ),
      );

    if (!draft) {
      throw new Error('Versión de configuración no encontrada');
    }

    if (draft.status === 'published' || draft.status === 'replaced') {
      throw new Error('La versión ya fue publicada o reemplazada previamente');
    }

    // Validate completeness of requirement matrix for any declared counterparty types (HU-007)
    await assertRequirementMatrixIsComplete(input.organizationId, input.versionId, tx);

    // Validate that privacy notice exists (HU-062)
    await assertPrivacyNoticeExists(input.organizationId, input.versionId, tx);

    const effectiveDate = input.effectiveFrom || new Date();

    // 2. Mark existing published version as 'replaced'
    const currentPublished = await tx
      .select()
      .from(configurationVersions)
      .where(
        and(
          eq(configurationVersions.organizationId, input.organizationId),
          eq(configurationVersions.status, 'published'),
        ),
      );

    for (const prev of currentPublished) {
      await tx
        .update(configurationVersions)
        .set({ status: 'replaced' })
        .where(eq(configurationVersions.id, prev.id));
    }

    // 3. Mark target version as 'published'
    const [published] = await tx
      .update(configurationVersions)
      .set({
        status: 'published',
        publishedBy: input.publishedBy,
        publishedAt: new Date(),
        reason: input.reason,
        effectiveFrom: effectiveDate,
      })
      .where(eq(configurationVersions.id, input.versionId))
      .returning();

    // 4. Audit trail via transversal logAuditEvent (ADR-0007, HU-006)
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.publishedBy,
        action: 'configuration.published',
        entity: 'configuration_version',
        entityId: published.id,
        reason: input.reason,
        configurationVersionId: published.id,
        metadata: {
          version_id: published.id,
          version_number: published.versionNumber,
          reason: input.reason,
          effective_from: published.effectiveFrom,
        },
        origin: { actor: 'user', action: 'publishDraftConfiguration' },
      },
      tx,
    );

    return getConfigurationVersionDetail(input.organizationId, published.id, tx);
  };

  if (txClient && 'execute' in txClient) {
    return execute(txClient as DatabaseTransaction);
  }
  return db.transaction(execute);
}

/**
 * Retrieves the currently active published configuration version.
 * Returns null if no version has been published (drafts do NOT count).
 */
export async function getActiveConfiguration(
  organizationId: string,
  txClient?: DrizzleClient,
): Promise<ConfigurationVersionDetail | null> {
  const client = txClient || db;
  const [active] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.status, 'published'),
      ),
    )
    .orderBy(desc(configurationVersions.effectiveFrom))
    .limit(1);

  if (!active) return null;
  return getConfigurationVersionDetail(organizationId, active.id, client);
}

/**
 * Reconstructs the exact configuration that was effective at a specific past date.
 * (HU-004 Escenario: Reconstruir la configuración de una fecha pasada)
 */
export async function getConfigurationAtDate(
  organizationId: string,
  date: Date,
  txClient?: DrizzleClient,
): Promise<ConfigurationVersionDetail | null> {
  const client = txClient || db;

  // Search published or replaced versions effective at or before given date
  const [match] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        sql`${configurationVersions.status} IN ('published', 'replaced')`,
        lte(configurationVersions.effectiveFrom, date),
      ),
    )
    .orderBy(desc(configurationVersions.effectiveFrom))
    .limit(1);

  if (!match) return null;
  return getConfigurationVersionDetail(organizationId, match.id, client);
}

/**
 * Retrieves the current draft configuration version if one exists.
 * Returns null if there is no draft version.
 */
export async function getDraftConfiguration(
  organizationId: string,
  txClient?: DrizzleClient,
): Promise<ConfigurationVersionDetail | null> {
  const client = txClient || db;
  const [draft] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.status, 'draft'),
      ),
    )
    .orderBy(desc(configurationVersions.createdAt))
    .limit(1);

  if (!draft) return null;
  return getConfigurationVersionDetail(organizationId, draft.id, client);
}

/**
 * Helper to fetch complete detail with nested roles, permissions, counterparty types, requirements, and privacy notice.
 */
export async function getConfigurationVersionDetail(
  organizationId: string,
  versionId: string,
  txClient?: DrizzleClient,
): Promise<ConfigurationVersionDetail> {
  const client = txClient || db;

  const [version] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.id, versionId),
      ),
    );

  if (!version) {
    throw new Error('Versión no encontrada');
  }

  const roleRows = await client
    .select()
    .from(roles)
    .where(
      and(
        eq(roles.organizationId, organizationId),
        eq(roles.configurationVersionId, versionId),
      ),
    );

  const permRows = await client
    .select()
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.organizationId, organizationId),
        eq(rolePermissions.configurationVersionId, versionId),
      ),
    );

  const rolesDetail: ConfigurationRoleDetail[] = roleRows.map((r) => {
    const rolePerms = permRows
      .filter((p) => p.roleId === r.id)
      .map((p) => p.permissionKey as PermissionKey);

    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      permissions: rolePerms,
    };
  });

  // Load counterparty types with their requirements
  const typeRows = await listCounterpartyTypes(organizationId, versionId, client);
  const counterpartyTypesDetail: CounterpartyTypeWithRequirements[] = [];
  for (const type of typeRows) {
    const typeRequirements = await getRequirementsForType(organizationId, versionId, type.id, client);
    counterpartyTypesDetail.push({
      id: type.id,
      name: type.name,
      nature: type.nature as 'natural_person' | 'legal_entity',
      requirements: typeRequirements.map((r) => ({
        id: r.requirementId,
        type: r.type as 'field' | 'document_type',
        key: r.key,
        mandatory: r.mandatory as 'always' | 'conditional' | 'optional',
        blocking: r.blocking,
      })),
    });
  }

  // Load privacy notice
  const privacyNoticeDetail = await getPrivacyNoticeForVersion(organizationId, versionId, client);
  const privacyNotice = privacyNoticeDetail ? {
    id: privacyNoticeDetail.id,
    text: privacyNoticeDetail.text,
    purposes: privacyNoticeDetail.purposes,
  } : null;

  return {
    id: version.id,
    organizationId: version.organizationId,
    versionNumber: version.versionNumber,
    status: version.status,
    standard: version.standard,
    referenceRegulation: version.referenceRegulation,
    effectiveFrom: version.effectiveFrom,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt,
    reason: version.reason,
    signatureLevelRequired: version.signatureLevelRequired,
    roles: rolesDetail,
    counterpartyTypes: counterpartyTypesDetail,
    privacyNotice,
  };
}

/**
 * Computes semantic diff between two configuration versions.
 * (HU-004 Escenario: Cambiar la configuración es publicar una versión nueva - consultar qué cambió)
 */
export async function compareConfigurationVersions(
  organizationId: string,
  v1Number: string,
  v2Number: string,
  txClient?: DrizzleClient,
): Promise<VersionDiffResult> {
  const client = txClient || db;

  const [v1Row] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.versionNumber, v1Number),
      ),
    );

  const [v2Row] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, organizationId),
        eq(configurationVersions.versionNumber, v2Number),
      ),
    );

  if (!v1Row || !v2Row) {
    throw new Error('Una o ambas versiones no existen');
  }

  const v1 = await getConfigurationVersionDetail(organizationId, v1Row.id, client);
  const v2 = await getConfigurationVersionDetail(organizationId, v2Row.id, client);

  // Roles diff
  const v1RoleCodes = new Set(v1.roles.map((r) => r.code));
  const v2RoleCodes = new Set(v2.roles.map((r) => r.code));

  const rolesAdded = [...v2RoleCodes].filter((c) => !v1RoleCodes.has(c));
  const rolesRemoved = [...v1RoleCodes].filter((c) => !v2RoleCodes.has(c));

  const permissionsChanged: VersionDiffResult['permissionsChanged'] = [];

  for (const r2 of v2.roles) {
    const r1 = v1.roles.find((r) => r.code === r2.code);
    if (r1) {
      const p1 = new Set(r1.permissions);
      const p2 = new Set(r2.permissions);

      const added = [...p2].filter((p) => !p1.has(p));
      const removed = [...p1].filter((p) => !p2.has(p));

      if (added.length > 0 || removed.length > 0) {
        permissionsChanged.push({
          roleCode: r2.code,
          added,
          removed,
        });
      }
    }
  }

  // Counterparty types diff (by name, since ids change between versions)
  const v1TypeNames = new Set(v1.counterpartyTypes.map((t) => t.name));
  const v2TypeNames = new Set(v2.counterpartyTypes.map((t) => t.name));

  const counterpartyTypesAdded = [...v2TypeNames].filter((n) => !v1TypeNames.has(n));
  const counterpartyTypesRemoved = [...v1TypeNames].filter((n) => !v2TypeNames.has(n));

  // Requirements diff (by type name, then by requirement key)
  const requirementsChanged: VersionDiffResult['requirementsChanged'] = [];

  for (const t2 of v2.counterpartyTypes) {
    const t1 = v1.counterpartyTypes.find((t) => t.name === t2.name);
    if (t1) {
      const r1Keys = new Set(t1.requirements.map((r) => r.key));
      const r2Keys = new Set(t2.requirements.map((r) => r.key));

      const reqAdded = [...r2Keys].filter((k) => !r1Keys.has(k));
      const reqRemoved = [...r1Keys].filter((k) => !r2Keys.has(k));

      if (reqAdded.length > 0 || reqRemoved.length > 0) {
        requirementsChanged.push({
          counterpartyTypeName: t2.name,
          added: reqAdded,
          removed: reqRemoved,
        });
      }
    }
  }

  // Privacy notice diff
  const privacyNoticeChanged = v1.privacyNotice?.text !== v2.privacyNotice?.text;

  return {
    previousVersionNumber: v1Number,
    newVersionNumber: v2Number,
    rolesAdded,
    rolesRemoved,
    permissionsChanged,
    counterpartyTypesAdded,
    counterpartyTypesRemoved,
    requirementsChanged,
    privacyNoticeChanged,
  };
}

/**
 * Lists configuration versions for an organization ordered by effective date / version.
 * (HU-004 & Panel de administración consolidado)
 */
export async function listConfigurationVersions(
  organizationId: string,
  txClient?: DrizzleClient,
): Promise<Pick<ConfigurationVersionDetail, 'id' | 'versionNumber' | 'status' | 'standard' | 'effectiveFrom' | 'publishedAt' | 'reason'>[]> {
  const client = txClient || db;

  const rows = await client
    .select({
      id: configurationVersions.id,
      versionNumber: configurationVersions.versionNumber,
      status: configurationVersions.status,
      standard: configurationVersions.standard,
      effectiveFrom: configurationVersions.effectiveFrom,
      publishedAt: configurationVersions.publishedAt,
      reason: configurationVersions.reason,
    })
    .from(configurationVersions)
    .where(eq(configurationVersions.organizationId, organizationId))
    .orderBy(desc(configurationVersions.effectiveFrom), desc(configurationVersions.createdAt));

  return rows.map((r) => ({
    id: r.id,
    versionNumber: r.versionNumber,
    status: r.status as 'draft' | 'published' | 'replaced',
    standard: r.standard,
    effectiveFrom: r.effectiveFrom,
    publishedAt: r.publishedAt,
    reason: r.reason,
  }));
}

