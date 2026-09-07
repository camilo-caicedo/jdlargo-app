import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient, TenantContext } from '../db/client';
import { memberships, roles, rolePermissions } from '../db/schema';
import type { PermissionKey } from './permissions';
import { getActiveConfigurationVersion } from './role-config';
import { logAuditEvent } from '../audit/service';

export interface PermissionCheckResult {
  granted: boolean;
  configurationVersionId: string | null;
  configurationVersionNumber: string | null;
  userRole: string | null;
  reason?: string;
}

/**
 * Checks whether a user possesses a specific permission within an organization
 * based on the active published configuration version.
 *
 * NOTE: The check resolves against Postgres tables (configuration_versions, roles, role_permissions)
 * and never relies on hardcoded code-level mappings.
 */
export async function checkUserPermission(
  userId: string,
  organizationId: string,
  permission: PermissionKey,
  txClient?: DrizzleClient,
): Promise<PermissionCheckResult> {
  const client = txClient || db;

  // 1. Get active published configuration version
  const activeVer = await getActiveConfigurationVersion(organizationId, client);
  if (!activeVer) {
    return {
      granted: false,
      configurationVersionId: null,
      configurationVersionNumber: null,
      userRole: null,
      reason: 'Organización sin versión de configuración publicada',
    };
  }

  // 2. Lookup active membership to get user role
  const [member] = await client
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
      ),
    )
    .limit(1);

  if (!member) {
    return {
      granted: false,
      configurationVersionId: activeVer.id,
      configurationVersionNumber: activeVer.versionNumber,
      userRole: null,
      reason: 'El usuario no posee una membresía activa en la organización',
    };
  }

  // 3. Find the role entity under the active configuration version
  const [roleEntity] = await client
    .select()
    .from(roles)
    .where(
      and(
        eq(roles.organizationId, organizationId),
        eq(roles.configurationVersionId, activeVer.id),
        eq(roles.code, member.role),
      ),
    )
    .limit(1);

  if (!roleEntity) {
    return {
      granted: false,
      configurationVersionId: activeVer.id,
      configurationVersionNumber: activeVer.versionNumber,
      userRole: member.role,
      reason: `El rol '${member.role}' no existe en la versión de configuración vigente`,
    };
  }

  // 4. Query role_permissions for this permission
  const [permMatch] = await client
    .select()
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.organizationId, organizationId),
        eq(rolePermissions.configurationVersionId, activeVer.id),
        eq(rolePermissions.roleId, roleEntity.id),
        eq(rolePermissions.permissionKey, permission),
      ),
    )
    .limit(1);

  const granted = Boolean(permMatch);

  return {
    granted,
    configurationVersionId: activeVer.id,
    configurationVersionNumber: activeVer.versionNumber,
    userRole: member.role,
    reason: granted ? undefined : `El rol '${member.role}' no tiene asignado el permiso '${permission}'`,
  };
}

/**
 * Enforces a required permission. If denied, writes an audit log entry
 * documenting the failed attempt, the evaluated configuration version, and throws an error.
 * 
 * In accordance with ADR-0007 and HU-003 audit findings, the audit event is persisted
 * using the top-level database connection (db) to guarantee that caller transaction rollbacks
 * cannot erase the security denial record.
 */
export async function enforceUserPermission(
  context: TenantContext,
  permission: PermissionKey,
  metadata?: Record<string, unknown>,
  txClient?: DrizzleClient,
): Promise<PermissionCheckResult> {
  const result = await checkUserPermission(
    context.userId,
    context.organizationId,
    permission,
    txClient,
  );

  if (!result.granted) {
    // Audit log entry for authorization denial using transversal logAuditEvent
    // Always written to top-level db connection to persist despite caller rollback
    await logAuditEvent(
      {
        organizationId: context.organizationId,
        actorType: 'user',
        actorUserId: context.userId,
        action: 'security.permission_denied',
        entity: 'role_permission',
        entityId: permission,
        configurationVersionId: result.configurationVersionId || undefined,
        reason: result.reason,
        metadata: {
          permission,
          user_role: result.userRole,
          configuration_version_id: result.configurationVersionId,
          configuration_version_number: result.configurationVersionNumber,
          reason: result.reason,
          attempted_action: permission,
          ...(metadata || {}),
        },
        origin: { actor: 'user', context: 'enforceUserPermission' },
      },
      db, // Explicitly pass top-level db so caller rollback does not lose security record
    );

    throw new Error(
      `Acción no autorizada: falta el permiso '${permission}' en la versión de configuración ${result.configurationVersionNumber || 'N/A'}.`,
    );
  }

  return result;
}

