'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { validateExtractedAssertion, correctExtractedAssertion, resolveDiscrepancy } from '@/server/assertions/service';

export async function confirmExtractedFieldAction(
  organizationId: string,
  slug: string,
  dossierId: string,
  assertionId: string,
): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  await validateExtractedAssertion({
    organizationId,
    dossierId,
    assertionId,
    result: 'confirmed',
    validatedBy: userId,
  });
  revalidatePath(`/app/${slug}/expedientes/${dossierId}`, 'page');
}

export async function discardExtractedFieldAction(
  organizationId: string,
  slug: string,
  dossierId: string,
  assertionId: string,
  reason: string,
): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  await validateExtractedAssertion({
    organizationId,
    dossierId,
    assertionId,
    result: 'discarded',
    reason,
    validatedBy: userId,
  });
  revalidatePath(`/app/${slug}/expedientes/${dossierId}`, 'page');
}

export async function correctExtractedFieldAction(
  organizationId: string,
  slug: string,
  dossierId: string,
  assertionId: string,
  correctedValue: unknown,
  reason: string,
  evidenceId: string,
  partyId: string,
  configVersionId: string,
): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  await correctExtractedAssertion({
    organizationId,
    dossierId,
    partyId,
    configurationVersionId: configVersionId,
    originalAssertionId: assertionId,
    correctedValue,
    reason,
    correctedBy: userId,
    evidenceId,
  });
  revalidatePath(`/app/${slug}/expedientes/${dossierId}`, 'page');
}

export async function resolveDiscrepancyAction(
  organizationId: string,
  slug: string,
  dossierId: string,
  field: string,
  selectedAssertionId: string,
  reason: string,
): Promise<void> {
  const userId = await requireAuthenticatedUserId();
  await resolveDiscrepancy({
    organizationId,
    dossierId,
    field,
    selectedAssertionId,
    resolvedBy: userId,
    resolutionNote: reason,
  });
  revalidatePath(`/app/${slug}/expedientes/${dossierId}`, 'page');
}
