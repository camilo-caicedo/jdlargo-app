import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { consents, privacyNotices, dossiers, users, organizations, assertions } from '../db/schema';
import { executeTransition } from '../dossiers/state-machine';
import { sendDossierRejectedEmail } from '../notifications/email';
import { logAuditEvent } from '../audit/service';

export class DomainError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface RecordConsentInput {
  organizationId: string;
  dossierId: string;
  privacyNoticeId: string;
  result: 'accepted' | 'not_accepted';
  channel: 'portal';
  ipAddress: string;
}

export interface ConsentRecord {
  id: string;
  organizationId: string;
  dossierId: string;
  privacyNoticeId: string;
  privacyNoticeTextSnapshot: string;
  result: 'accepted' | 'not_accepted';
  occurredAt: Date;
  channel: string;
  ipAddress: string;
}

/**
 * Records counterparty consent (accepted or not_accepted) for a dossier.
 * Idempotent by dossierId: throws DomainError('CONSENT_ALREADY_RECORDED') if already recorded.
 * If result === 'not_accepted', transitions dossier to 'rechazada_por_contraparte' and sends notification.
 */
export async function recordConsent(
  input: RecordConsentInput,
  txClient?: DrizzleClient,
): Promise<ConsentRecord> {
  const executeInTx = async (tx: DatabaseTransaction): Promise<ConsentRecord> => {
    // 1. Check idempotency: only one consent per dossier
    const [existing] = await tx
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.organizationId, input.organizationId),
          eq(consents.dossierId, input.dossierId),
        ),
      )
      .limit(1);

    if (existing) {
      throw new DomainError('El consentimiento para este expediente ya ha sido registrado', 'CONSENT_ALREADY_RECORDED');
    }

    // 2. Fetch the referenced privacy notice to create an immutable snapshot of its text
    const [notice] = await tx
      .select()
      .from(privacyNotices)
      .where(
        and(
          eq(privacyNotices.organizationId, input.organizationId),
          eq(privacyNotices.id, input.privacyNoticeId),
        ),
      )
      .limit(1);

    if (!notice) {
      throw new DomainError('Aviso de privacidad no encontrado', 'NOT_FOUND');
    }

    // 3. Fetch dossier details for notification and transition
    const [dossier] = await tx
      .select({
        id: dossiers.id,
        code: dossiers.code,
        state: dossiers.state,
        internalOwnerId: dossiers.internalOwnerId,
        configurationVersionId: dossiers.configurationVersionId,
      })
      .from(dossiers)
      .where(
        and(
          eq(dossiers.organizationId, input.organizationId),
          eq(dossiers.id, input.dossierId),
        ),
      )
      .limit(1);

    if (!dossier) {
      throw new DomainError('Expediente no encontrado', 'NOT_FOUND');
    }

    // 4. Insert consent event
    const [inserted] = await tx
      .insert(consents)
      .values({
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        privacyNoticeId: input.privacyNoticeId,
        privacyNoticeTextSnapshot: notice.text,
        result: input.result,
        channel: input.channel,
        ipAddress: input.ipAddress,
      })
      .returning();

    // 5. Audit event
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'counterparty',
        action: input.result === 'accepted' ? 'consent.accepted' : 'consent.not_accepted',
        entity: 'consent',
        entityId: inserted.id,
        configurationVersionId: dossier.configurationVersionId,
        metadata: {
          dossier_id: input.dossierId,
          privacy_notice_id: input.privacyNoticeId,
          result: input.result,
          channel: input.channel,
          ip_address: input.ipAddress,
        },
        origin: { actor: 'counterparty', action: 'recordConsent' },
      },
      tx,
    );

    // 6. If not accepted: trigger state transition and notify internal owner
    if (input.result === 'not_accepted') {
      await executeTransition(
        {
          dossierId: input.dossierId,
          organizationId: input.organizationId,
          toState: 'rechazada_por_contraparte',
          actorType: 'counterparty',
          reason: 'Aviso de privacidad no aceptado por la contraparte',
        },
        tx as unknown as DrizzleClient,
      );

      // Fetch owner and organization info for email if owner exists
      let ownerEmail: string | undefined;
      let ownerName: string | undefined;

      if (dossier.internalOwnerId) {
        const [owner] = await tx
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, dossier.internalOwnerId))
          .limit(1);

        if (owner) {
          ownerEmail = owner.email;
          ownerName = owner.name ?? undefined;
        }
      }

      const [org] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);

      // Fetch party declared name from assertions if available
      const [nameAssertion] = await tx
        .select({ value: assertions.value })
        .from(assertions)
        .where(
          and(
            eq(assertions.dossierId, input.dossierId),
            eq(assertions.field, 'party.declared_name'),
            eq(assertions.status, 'active'),
          ),
        )
        .limit(1);

      const partyDeclaredName =
        (typeof nameAssertion?.value === 'string'
          ? nameAssertion.value
          : (nameAssertion?.value as { name?: string })?.name) || 'Contraparte';

      if (ownerEmail) {
        // Send notification email asynchronously (best-effort)
        sendDossierRejectedEmail({
          to: ownerEmail,
          ownerName,
          dossierCode: dossier.code || dossier.id,
          partyDeclaredName,
          organizationName: org?.name || 'JD Largo',
          rejectionReason: 'La contraparte no aceptó el aviso de privacidad y tratamiento de datos personales.',
        }).catch((err) => {
          console.warn('[recordConsent] Error sending rejection notification email:', err);
        });
      }
    }

    return {
      id: inserted.id,
      organizationId: inserted.organizationId,
      dossierId: inserted.dossierId,
      privacyNoticeId: inserted.privacyNoticeId,
      privacyNoticeTextSnapshot: inserted.privacyNoticeTextSnapshot,
      result: inserted.result as 'accepted' | 'not_accepted',
      occurredAt: inserted.occurredAt,
      channel: inserted.channel,
      ipAddress: inserted.ipAddress,
    };
  };

  if (txClient && 'execute' in txClient) {
    return executeInTx(txClient as DatabaseTransaction);
  }
  return db.transaction(executeInTx);
}

/**
 * Retrieves consent record for a dossier.
 */
export async function getConsentForDossier(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<ConsentRecord | null> {
  const client = txClient || db;

  const [row] = await client
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.organizationId, organizationId),
        eq(consents.dossierId, dossierId),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    organizationId: row.organizationId,
    dossierId: row.dossierId,
    privacyNoticeId: row.privacyNoticeId,
    privacyNoticeTextSnapshot: row.privacyNoticeTextSnapshot,
    result: row.result as 'accepted' | 'not_accepted',
    occurredAt: row.occurredAt,
    channel: row.channel,
    ipAddress: row.ipAddress,
  };
}