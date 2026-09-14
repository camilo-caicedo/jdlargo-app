"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { checkUserPermission } from "@/server/auth/access-control";
import {
  updateDraftConfiguration,
  createDraftConfiguration,
  getDraftConfiguration,
} from "@/server/configuration/service";
import type { PermissionKey } from "@/server/auth/permissions";

export async function createDraftFromRolesAction(organizationId: string, slug: string) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, organizationId, "configuration:administer");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para crear borradores de configuración." };
  }

  try {
    await createDraftConfiguration({ organizationId });
    revalidatePath(`/app/${slug}/admin/roles`);
    return { success: true };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al crear borrador" };
  }
}

export async function updateDraftRolesAction(
  organizationId: string,
  slug: string,
  rolesConfig: Array<{
    code: string;
    name: string;
    description?: string;
    permissions: PermissionKey[];
  }>,
) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, organizationId, "configuration:administer");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para editar la configuración de roles." };
  }

  try {
    const draft = await getDraftConfiguration(organizationId);
    if (!draft) {
      return { error: "No se encontró un borrador activo para actualizar." };
    }

    await updateDraftConfiguration(organizationId, draft.id, { rolesConfig });
    revalidatePath(`/app/${slug}/admin/roles`);
    return { success: true };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al actualizar roles" };
  }
}
