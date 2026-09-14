"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUserId } from "@/server/auth/session";
import { checkUserPermission } from "@/server/auth/access-control";
import {
  addCounterpartyType,
  addRequirement,
  type AddCounterpartyTypeInput,
  type AddRequirementInput,
} from "@/server/configuration/requirement-matrix";

export async function addCounterpartyTypeAction(
  slug: string,
  input: AddCounterpartyTypeInput,
) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, input.organizationId, "configuration:administer");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para editar la matriz de requisitos." };
  }

  try {
    const result = await addCounterpartyType(input);
    revalidatePath(`/app/${slug}/admin/matriz-requisitos`);
    return { success: true, id: result.id };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al registrar tipo de contraparte" };
  }
}

export async function addRequirementAction(
  slug: string,
  input: AddRequirementInput,
) {
  const userId = await requireAuthenticatedUserId();
  const perm = await checkUserPermission(userId, input.organizationId, "configuration:administer");
  if (!perm.granted) {
    return { error: perm.reason || "No tiene permiso para editar la matriz de requisitos." };
  }

  try {
    const result = await addRequirement(input);
    revalidatePath(`/app/${slug}/admin/matriz-requisitos`);
    return { success: true, id: result.id };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : "Error al registrar requisito" };
  }
}
