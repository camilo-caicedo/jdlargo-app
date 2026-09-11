import { randomBytes, createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { dossierAccessTokens, dossiers, organizations } from '../db/schema';
import { enforceUserPermission } from '../auth/access-control';
import { logAuditEvent } from '../audit/service';
import { sendAccessLinkEmail } from '../notifications/email';
import { executeTransition } from './state-machine';

export interface IssueAccessLinkInput {
  organizationId: string;
  dossierId: string;
  issuedBy: string;              // exige dossier:edit
  requiresSecondFactor: boolean; // parámetro explícito, no derivado
  recipientEmail: string;        // obligatorio: destinatario para el enlace y segundo factor
  ttlHours?: number;              // duración configurable; default 72 horas si se omite
}

export interface AccessLinkDetail {
  id: string;
  dossierId: string;
  rawToken: string;     // se devuelve UNA sola vez, aquí; nunca se puede volver a leer
  expiresAt: Date;
  requiresSecondFactor: boolean;
  recipientEmail: string;
  state: 'active' | 'expired' | 'revoked' | 'replaced';
}

/**
 * Issues the primary or a replacement access link for a dossier.
 * If an active token already exists, it is marked 'replaced' atomically.
 * Sends the access link email on a best-effort basis.
 */
export async function issueAccessLink(
  input: IssueAccessLinkInput,
  txClient?: DrizzleClient,
): Promise<AccessLinkDetail> {
  const client = txClient || db;

  // 1. Permission check: requires dossier:edit
  await enforceUserPermission(
    {
      userId: input.issuedBy,
      organizationId: input.organizationId,
    },
    'dossier:edit',
    {
      dossierId: input.dossierId,
      action: 'issue_access_link',
    },
    txClient,
  );

  // 2. Load dossier
  const [dossier] = await client
    .select()
    .from(dossiers)
    .where(
      and(
        eq(dossiers.id, input.dossierId),
        eq(dossiers.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!dossier) {
    throw new Error('Expediente no encontrado');
  }

  // 3. Generate raw token (64 hex characters) and its SHA-256 hash
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const ttl = input.ttlHours ?? 72;
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);

  // 4. Atomic transaction to replace any currently active token and insert new token
  const executeInTx = async (tx: DatabaseTransaction): Promise<AccessLinkDetail> => {
    // Emitir el primer enlace de acceso es lo que envía la solicitud a la contraparte
    // (HU-010 asume 'enviada' ya cumplida antes de que el enlace se use). Si el expediente
    // sigue en 'borrador', esta es la transición que lo saca de ahí; reemitir un enlace más
    // adelante (dossier ya 'enviada' o posterior) no repite la transición.
    if (dossier.state === 'borrador') {
      await executeTransition(
        {
          organizationId: input.organizationId,
          dossierId: input.dossierId,
          toState: 'enviada',
          actorType: 'user',
          actorId: input.issuedBy,
        },
        tx,
      );
    }

    // Find active token if any
    const [existingActive] = await tx
      .select()
      .from(dossierAccessTokens)
      .where(
        and(
          eq(dossierAccessTokens.dossierId, input.dossierId),
          eq(dossierAccessTokens.organizationId, input.organizationId),
          eq(dossierAccessTokens.state, 'active'),
        ),
      )
      .limit(1);

    if (existingActive) {
      await tx
        .update(dossierAccessTokens)
        .set({
          state: 'replaced',
        })
        .where(eq(dossierAccessTokens.id, existingActive.id));

      await logAuditEvent(
        {
          organizationId: input.organizationId,
          actorType: 'user',
          actorUserId: input.issuedBy,
          action: 'dossier.access_link_replaced',
          entity: 'dossier',
          entityId: input.dossierId,
          configurationVersionId: dossier.configurationVersionId,
          metadata: {
            replaced_token_id: existingActive.id,
            dossier_id: input.dossierId,
          },
        },
        tx,
      );
    }

    // Insert new token
    const [inserted] = await tx
      .insert(dossierAccessTokens)
      .values({
        organizationId: input.organizationId,
        dossierId: input.dossierId,
        tokenHash,
        expiresAt,
        state: 'active',
        requiresSecondFactor: input.requiresSecondFactor,
        recipientEmail: input.recipientEmail.trim().toLowerCase(),
        issuedBy: input.issuedBy,
      })
      .returning();

    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.issuedBy,
        action: 'dossier.access_link_issued',
        entity: 'dossier',
        entityId: input.dossierId,
        configurationVersionId: dossier.configurationVersionId,
        metadata: {
          access_token_id: inserted.id,
          dossier_id: input.dossierId,
          requires_second_factor: input.requiresSecondFactor,
          recipient_email: inserted.recipientEmail,
          expires_at: expiresAt.toISOString(),
        },
      },
      tx,
    );

    return {
      id: inserted.id,
      dossierId: inserted.dossierId,
      rawToken,
      expiresAt: inserted.expiresAt,
      requiresSecondFactor: inserted.requiresSecondFactor,
      recipientEmail: inserted.recipientEmail,
      state: inserted.state as 'active',
    };
  };

  const result = txClient && 'execute' in txClient && typeof (txClient as DatabaseTransaction).execute === 'function'
    ? await executeInTx(txClient as DatabaseTransaction)
    : await db.transaction(executeInTx);

  // 5. Send notification email (best effort, do not revert business transaction)
  if (input.recipientEmail) {
    const [org] = await client
      .select()
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const accessUrl = `${baseUrl}/portal/access/${rawToken}`;

    await sendAccessLinkEmail({
      to: input.recipientEmail,
      dossierCode: dossier.code || 'Expediente',
      accessUrl,
      organizationName: org?.name || 'Organización',
    }).catch((err) => {
      console.warn('[issueAccessLink] Error enviando correo de acceso:', err);
    });
  }

  return result;
}

/**
 * Revokes the active access link for a dossier.
 */
export async function revokeAccessLink(
  input: { organizationId: string; dossierId: string; revokedBy: string },
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  // 1. Permission check: requires dossier:edit
  await enforceUserPermission(
    {
      userId: input.revokedBy,
      organizationId: input.organizationId,
    },
    'dossier:edit',
    {
      dossierId: input.dossierId,
      action: 'revoke_access_link',
    },
    txClient,
  );

  const [dossier] = await client
    .select()
    .from(dossiers)
    .where(
      and(
        eq(dossiers.id, input.dossierId),
        eq(dossiers.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!dossier) {
    throw new Error('Expediente no encontrado');
  }

  const executeInTx = async (tx: DatabaseTransaction): Promise<void> => {
    const [activeToken] = await tx
      .select()
      .from(dossierAccessTokens)
      .where(
        and(
          eq(dossierAccessTokens.dossierId, input.dossierId),
          eq(dossierAccessTokens.organizationId, input.organizationId),
          eq(dossierAccessTokens.state, 'active'),
        ),
      )
      .limit(1);

    if (!activeToken) {
      return;
    }

    const revokedAt = new Date();

    await tx
      .update(dossierAccessTokens)
      .set({
        state: 'revoked',
        revokedBy: input.revokedBy,
        revokedAt,
      })
      .where(eq(dossierAccessTokens.id, activeToken.id));

    await logAuditEvent(
      {
        organizationId: input.organizationId,
        actorType: 'user',
        actorUserId: input.revokedBy,
        action: 'dossier.access_link_revoked',
        entity: 'dossier',
        entityId: input.dossierId,
        configurationVersionId: dossier.configurationVersionId,
        metadata: {
          access_token_id: activeToken.id,
          dossier_id: input.dossierId,
          revoked_by: input.revokedBy,
          revoked_at: revokedAt.toISOString(),
        },
      },
      tx,
    );
  };

  if (txClient && 'execute' in txClient && typeof (txClient as DatabaseTransaction).execute === 'function') {
    await executeInTx(txClient as DatabaseTransaction);
  } else {
    await db.transaction(executeInTx);
  }
}

/**
 * Returns active access link details (without raw token since it's never stored).
 */
export async function getActiveAccessLinkForDossier(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<{
  id: string;
  recipientEmail: string;
  expiresAt: Date;
  state: string;
  requiresSecondFactor: boolean;
  isExpired: boolean;
} | null> {
  const client = txClient || db;

  const [token] = await client
    .select()
    .from(dossierAccessTokens)
    .where(
      and(
        eq(dossierAccessTokens.organizationId, organizationId),
        eq(dossierAccessTokens.dossierId, dossierId),
        eq(dossierAccessTokens.state, 'active'),
      ),
    )
    .limit(1);

  if (!token) {
    return null;
  }

  const isExpired = new Date() > token.expiresAt;

  return {
    id: token.id,
    recipientEmail: token.recipientEmail,
    expiresAt: token.expiresAt,
    state: isExpired ? 'expired' : token.state,
    requiresSecondFactor: token.requiresSecondFactor,
    isExpired,
  };
}
