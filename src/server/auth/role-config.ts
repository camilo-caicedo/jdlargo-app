import { sql, eq, and, desc } from 'drizzle-orm';
import { db, DatabaseTransaction, DrizzleClient } from '../db/client';
import { configurationVersions, roles, rolePermissions } from '../db/schema';
import type { PermissionKey } from './permissions';

export interface BaseRoleSeed {
  code: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
}

/**
 * Base template permissions according to §30 and actores-y-roles.md.
 * These are inserted as dynamic data rows in the database, NEVER checked as hardcoded enums.
 */
export const BASE_ROLES_TEMPLATE: readonly BaseRoleSeed[] = [
  {
    code: 'admin',
    name: 'Administrador',
    description: 'Configura la plataforma para su empresa, gestiona usuarios y administra roles',
    permissions: [
      'configuration:view',
      'configuration:publish',
      'configuration:administer',
      'memberships:manage',
      'audit:view',
    ],
  },
  {
    code: 'compliance_officer',
    name: 'Oficial de Cumplimiento',
    description: 'Responsable legal del proceso. Aprueba o rechaza expedientes, alertas y metodología',
    permissions: [
      'dossier:view',
      'dossier:review',
      'dossier:approve',
      'dossier:export',
      'document:view',
      'document:review',
      'alert:view',
      'alert:resolve',
      'risk_methodology:view',
      'risk_methodology:edit',
      'audit:view',
      'configuration:view',
      'configuration:publish',
    ],
  },
  {
    code: 'compliance_analyst',
    name: 'Analista de Cumplimiento',
    description: 'Revisa expedientes y alertas del día a día',
    permissions: [
      'dossier:view',
      'dossier:review',
      'dossier:export',
      'document:view',
      'document:review',
      'alert:view',
      'alert:resolve',
      'audit:view',
      'configuration:view',
    ],
  },
  {
    code: 'reviewer',
    name: 'Revisor / Aprobador',
    description: 'Revisa expedientes y aprueba según la política de la organización',
    permissions: [
      'dossier:view',
      'dossier:review',
      'document:view',
      'document:review',
    ],
  },
  {
    code: 'auditor',
    name: 'Auditor / Consulta',
    description: 'Solo lectura e inspección de expedientes y bitácora. Cero permisos de escritura',
    permissions: [
      'dossier:view',
      'document:view',
      'alert:view',
      'risk_methodology:view',
      'audit:view',
      'configuration:view',
    ],
  },
  {
    code: 'operational_user',
    name: 'Usuario operativo',
    description: 'Crea solicitudes de vinculación desde su área',
    permissions: [
      'dossier:create',
      'dossier:view',
      'document:upload',
    ],
  },
] as const;

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

    // 5. Audit log entry for publishing
    await tx.execute(sql`
      INSERT INTO public.audit_log (
        organization_id,
        actor_user_id,
        action,
        metadata,
        origin
      ) VALUES (
        ${input.organizationId}::uuid,
        ${input.publishedBy}::uuid,
        'configuration.published',
        ${JSON.stringify({
          version_id: newVer.id,
          version_number: nextNumber,
          reason: input.reason,
          roles_count: input.rolesConfig.length,
        })}::jsonb,
        ${JSON.stringify({ actor: 'user', action: 'publishConfigurationVersion' })}::jsonb
      )
    `);

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
