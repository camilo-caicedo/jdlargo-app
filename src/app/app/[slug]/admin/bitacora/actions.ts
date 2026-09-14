"use server";

import { requireAuthenticatedUserId } from "@/server/auth/session";
import { checkUserPermission } from "@/server/auth/access-control";
import {
  listAuditLogForOrganization,
  getEntityAuditHistory,
  type ListAuditLogFilter,
} from "@/server/audit/service";

export async function fetchAuditLogsAction(
  organizationId: string,
  filter: {
    actorUserId?: string;
    action?: string;
    entity?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  },
) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, organizationId, "audit:view");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para consultar la bitácora." };
  }

  try {
    const domainFilter: ListAuditLogFilter = {
      actorUserId: filter.actorUserId || undefined,
      action: filter.action || undefined,
      entity: filter.entity || undefined,
      from: filter.from ? new Date(filter.from) : undefined,
      to: filter.to ? new Date(filter.to) : undefined,
      cursor: filter.cursor || undefined,
      limit: filter.limit || 50,
    };

    const result = await listAuditLogForOrganization(organizationId, domainFilter);
    return {
      success: true,
      entries: result.entries.map((e) => ({
        ...e,
        occurredAt: e.occurredAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al consultar bitácora" };
  }
}

export async function getEntityAuditHistoryAction(
  organizationId: string,
  entity: string,
  entityId: string,
) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, organizationId, "audit:view");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para consultar el historial de la entidad." };
  }

  try {
    const history = await getEntityAuditHistory(organizationId, entity, entityId);
    return {
      success: true,
      history: history.map((h) => ({
        ...h,
        occurredAt: h.occurredAt.toISOString(),
      })),
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al obtener historial de la entidad" };
  }
}
