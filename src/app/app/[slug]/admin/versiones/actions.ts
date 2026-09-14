"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { checkUserPermission } from "@/server/auth/access-control";
import {
  createDraftConfiguration,
  publishDraftConfiguration,
  compareConfigurationVersions,
  getConfigurationVersionDetail,
} from "@/server/configuration/service";

export async function createDraftAction(organizationId: string, slug: string) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, organizationId, "configuration:administer");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para crear borradores de configuración." };
  }

  try {
    const draft = await createDraftConfiguration({ organizationId });
    revalidatePath(`/app/${slug}/admin/versiones`);
    return { success: true, versionId: draft.versionId };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al crear borrador" };
  }
}

export async function publishDraftAction(
  organizationId: string,
  versionId: string,
  slug: string,
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const userId = await requireAuthenticatedUserId();
  const rawReason = formData.get("reason");
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";

  if (!reason) {
    return { error: "Debe ingresar un motivo explícito para publicar la versión." };
  }

  try {
    await publishDraftConfiguration({
      organizationId,
      versionId,
      publishedBy: userId,
      reason,
    });
    revalidatePath(`/app/${slug}/admin/versiones`);
    return { success: true };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al publicar la versión" };
  }
}

export async function compareVersionsAction(organizationId: string, v1: string, v2: string) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, organizationId, "configuration:view");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para ver versiones." };
  }

  try {
    const diff = await compareConfigurationVersions(organizationId, v1, v2);
    return { success: true, diff };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al comparar versiones" };
  }
}

export async function getVersionDetailAction(organizationId: string, versionId: string) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, organizationId, "configuration:view");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para ver versiones." };
  }

  try {
    const detail = await getConfigurationVersionDetail(organizationId, versionId);
    return { success: true, detail };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al obtener detalle de versión" };
  }
}
