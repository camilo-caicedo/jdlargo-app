import { eq, and, desc } from 'drizzle-orm';
import { db, DatabaseTransaction, DrizzleClient } from '../db/client';
import { configurationVersions, roles, rolePermissions } from '../db/schema';
import type { PermissionKey } from './permissions';
import { logAuditEvent } from '../audit/service';
import baseRolesData from './data/base-roles.json';

export interface BaseRoleSeed {
  code: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
}

/**
 * Base template permissions loaded as external seed data (ADR-0004 & HU-003).
 * These are inserted as dynamic data rows in the database, NEVER checked as hardcoded enums in application logic.
 */
export const BASE_ROLES_TEMPLATE: readonly BaseRoleSeed[] = baseRolesData as unknown as BaseRoleSeed[];

export interface PublishVersionInput {
  organizationId: string;
  publishedBy: string;
  reason: string;
  rolesConfig: {
    code: string;
    name: string;
    description?: string;
    permissions: PermissionKey[];
  }[];
}

/**
 * Publishes a new configuration version with its role and permission matrix.
 * Marks the previous published version as 'replaced'.
 */
export async function publishConfigurationVersion(
  input: PublishVersionInput,
  txClient?: DatabaseTransaction,
): Promise<{ versionId: string; versionNumber: string }> {
  const execute = async (tx: DatabaseTransaction) => {
    // 1. Find current active version
    const existing = await tx
      .select()
      .from(configurationVersions)
      .where(
        and(
          eq(configurationVersions.organizationId, input.organizationId),
          eq(configurationVersions.status, 'published'),
        ),
      )
      .orderBy(desc(configurationVersions.effectiveFrom))
      .limit(1);

    const nextNumber = existing.length > 0 ? (Number(existing[0].versionNumber) + 1).toString() : '1';

    // 2. Mark previous as replaced
    if (existing.length > 0) {
      await tx
        .update(configurationVersions)
        .set({ status: 'replaced' })
        .where(eq(configurationVersions.id, existing[0].id));
    }

    // 3. Insert new published configuration version
    const [newVer] = await tx
      .insert(configurationVersions)
      .values({
        organizationId: input.organizationId,
        versionNumber: nextNumber,
        status: 'published',
        publishedBy: input.publishedBy,
        publishedAt: new Date(),
        reason: input.reason,
        effectiveFrom: new Date(),
      })
      .returning();

    // 4. Insert roles and role_permissions
    for (const roleData of input.rolesConfig) {
      const [newRole] = await tx
        .insert(roles)
        .values({
          organizationId: input.organizationId,
          configurationVersionId: newVer.id,
          name: roleData.name,
          code: roleData.code,
          description: roleData.description || null,
        })
        .returning();

      if (roleData.permissions.length > 0) {
        await tx.insert(rolePermissions).values(
          roleData.permissions.map((permKey) => ({
            organizationId: input.organizationId,
            configurationVersionId: newVer.id,
            roleId: newRole.id,
            permissionKey: permKey,
          })),
        );
      }
    }

    // 5. Audit log entry for publishing via transversal logAuditEvent
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.publishedBy,
        action: 'configuration.published',
        entity: 'configuration_version',
        entityId: newVer.id,
        reason: input.reason,
        configurationVersionId: newVer.id,
        metadata: {
          version_id: newVer.id,
          version_number: nextNumber,
          reason: input.reason,
          roles_count: input.rolesConfig.length,
        },
        origin: { actor: 'user', action: 'publishConfigurationVersion' },
      },
      tx,
    );

    return { versionId: newVer.id, versionNumber: nextNumber };
  };

  if (txClient) {
    return execute(txClient);
  }
  return db.transaction(execute);
}

/**
 * Initializes the base roles matrix for a new organization as published version 1.
 */
export async function seedBaseConfiguration(
  organizationId: string,
  publishedBy: string,
  txClient?: DatabaseTransaction,
) {
  return publishConfigurationVersion(
    {
      organizationId,
      publishedBy,
      reason: 'Configuración inicial de roles y permisos base (§30)',
      rolesConfig: BASE_ROLES_TEMPLATE.map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: [...r.permissions],
      })),
    },
    txClient,
  );
}

/**
 * Gets the current active published configuration version for an organization.
 */
export async function getActiveConfigurationVersion(
  organizationId: string,
  txClient?: DrizzleClient,
) {
  const client = txClient || db;
  const rows = await client
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

  return rows.length > 0 ? rows[0] : null;
}
