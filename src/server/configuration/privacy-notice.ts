import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient } from '../db/client';
import { privacyNotices, configurationVersions } from '../db/schema';

export interface PrivacyNoticePurpose {
  key: string;
  description: string;
  requiresAuthorization: boolean;
}

export const privacyNoticePurposeSchema = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  requiresAuthorization: z.boolean(),
}).strict();

export interface AddPrivacyNoticeInput {
  organizationId: string;
  configurationVersionId: string;
  text: string;
  purposes: PrivacyNoticePurpose[];
  dataController: string;
  dataProcessor: string;
  rightsChannels: string;
}

export interface PrivacyNoticeDetail {
  id: string;
  organizationId: string;
  configurationVersionId: string;
  text: string;
  purposes: PrivacyNoticePurpose[];
  dataController: string;
  dataProcessor: string;
  rightsChannels: string;
  createdAt: Date;
}

/**
 * Adds or updates the privacy notice for a configuration version in draft state.
 * Validates version exists and is in draft status.
 */
export async function addPrivacyNotice(
  input: AddPrivacyNoticeInput,
  txClient?: DrizzleClient,
): Promise<{ id: string }> {
  const client = txClient || db;

  const [version] = await client
    .select()
    .from(configurationVersions)
    .where(
      and(
        eq(configurationVersions.organizationId, input.organizationId),
        eq(configurationVersions.id, input.configurationVersionId),
      ),
    );

  if (!version) {
    throw new Error('Versión de configuración no encontrada');
  }

  if (version.status !== 'draft') {
    throw new Error('Solo se pueden modificar avisos de privacidad en versiones en estado borrador');
  }

  // Validate purposes schema
  z.array(privacyNoticePurposeSchema).parse(input.purposes);

  const [inserted] = await client
    .insert(privacyNotices)
    .values({
      organizationId: input.organizationId,
      configurationVersionId: input.configurationVersionId,
      text: input.text,
      purposes: input.purposes,
      dataController: input.dataController,
      dataProcessor: input.dataProcessor,
      rightsChannels: input.rightsChannels,
    })
    .onConflictDoUpdate({
      target: [privacyNotices.organizationId, privacyNotices.configurationVersionId],
      set: {
        text: input.text,
        purposes: input.purposes,
        dataController: input.dataController,
        dataProcessor: input.dataProcessor,
        rightsChannels: input.rightsChannels,
      },
    })
    .returning();

  return { id: inserted.id };
}

/**
 * Retrieves the privacy notice associated with a specific configuration version.
 */
export async function getPrivacyNoticeForVersion(
  organizationId: string,
  configurationVersionId: string,
  txClient?: DrizzleClient,
): Promise<PrivacyNoticeDetail | null> {
  const client = txClient || db;

  const [row] = await client
    .select()
    .from(privacyNotices)
    .where(
      and(
        eq(privacyNotices.organizationId, organizationId),
        eq(privacyNotices.configurationVersionId, configurationVersionId),
      ),
    );

  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    configurationVersionId: row.configurationVersionId,
    text: row.text,
    purposes: row.purposes as PrivacyNoticePurpose[],
    dataController: row.dataController,
    dataProcessor: row.dataProcessor,
    rightsChannels: row.rightsChannels,
    createdAt: row.createdAt,
  };
}