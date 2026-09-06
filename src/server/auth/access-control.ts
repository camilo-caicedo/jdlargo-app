import { sql, eq, and } from 'drizzle-orm';
import { db, DrizzleClient, TenantContext } from '../db/client';
import { memberships, roles, rolePermissions } from '../db/schema';
import type { PermissionKey } from './permissions';
import { getActiveConfigurationVersion } from './role-config';

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
    // Audit log entry for authorization denial (Escenario: Una acción sin permiso se rechaza y queda registrada)
    const client = txClient || db;
    await client.execute(sql`
      INSERT INTO public.audit_log (
        organization_id,
        actor_user_id,
        action,
        metadata,
        origin
      ) VALUES (
        ${context.organizationId}::uuid,
        ${context.userId}::uuid,
        'security.permission_denied',
        ${JSON.stringify({
          permission,
          user_role: result.userRole,
          configuration_version_id: result.configurationVersionId,
          configuration_version_number: result.configurationVersionNumber,
          reason: result.reason,
          attempted_action: permission,
          ...(metadata || {}),
        })}::jsonb,
        ${JSON.stringify({ actor: 'user', context: 'enforceUserPermission' })}::jsonb
      )
    `);

    throw new Error(
      `Acción no autorizada: falta el permiso '${permission}' en la versión de configuración ${result.configurationVersionNumber || 'N/A'}.`,
    );
  }

  return result;
}
