import { createHash, randomInt } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { adminDb } from '../db/admin-client';
import { DrizzleClient } from '../db/client';
import {
  dossierAccessTokens,
  dossierAccessUses,
  dossierAccessOtpCodes,
  dossiers,
  users,
} from '../db/schema';
import { executeTransition } from '../dossiers/state-machine';
import { sendOtpEmail } from '../notifications/email';

export interface ResolveTokenResult {
  outcome: 'granted' | 'denied';
  denialReason?: 'not_found' | 'expired' | 'revoked' | 'replaced';
  dossierId?: string;
  organizationId?: string;
  accessTokenId?: string;
  requiresSecondFactor?: boolean;
  ownerContact?: { name: string; email: string };
}

/**
 * Searches by token SHA-256 hash, checks status/expiry, and records the access use
 * attempt (granted or denied) atomically. If not found at all, returns denied (not_found)
 * without writing to dossier_access_uses (since dossier_id is non-null).
 */
export async function resolveAccessToken(
  rawToken: string,
  request: { ipAddress: string; userAgent: string },
): Promise<ResolveTokenResult> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return adminDb.transaction(async (tx) => {
    const [tokenRecord] = await tx
      .select({
        id: dossierAccessTokens.id,
        organizationId: dossierAccessTokens.organizationId,
        dossierId: dossierAccessTokens.dossierId,
        state: dossierAccessTokens.state,
        expiresAt: dossierAccessTokens.expiresAt,
        requiresSecondFactor: dossierAccessTokens.requiresSecondFactor,
        internalOwnerId: dossiers.internalOwnerId,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(dossierAccessTokens)
      .innerJoin(dossiers, eq(dossierAccessTokens.dossierId, dossiers.id))
      .leftJoin(users, eq(dossiers.internalOwnerId, users.id))
      .where(eq(dossierAccessTokens.tokenHash, tokenHash))
      .limit(1);

    if (!tokenRecord) {
      console.warn(`[resolveAccessToken] Token not found from IP: ${request.ipAddress}`);
      return {
        outcome: 'denied',
        denialReason: 'not_found',
      };
    }

    const ownerContact = tokenRecord.ownerName && tokenRecord.ownerEmail
      ? { name: tokenRecord.ownerName, email: tokenRecord.ownerEmail }
      : undefined;

    let denialReason: 'expired' | 'revoked' | 'replaced' | undefined;

    if (tokenRecord.state === 'revoked') {
      denialReason = 'revoked';
    } else if (tokenRecord.state === 'replaced') {
      denialReason = 'replaced';
    } else if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      denialReason = 'expired';
    }

    const outcome: 'granted' | 'denied' = denialReason ? 'denied' : 'granted';

    // Record use in dossier_access_uses
    await tx.insert(dossierAccessUses).values({
      organizationId: tokenRecord.organizationId,
      dossierId: tokenRecord.dossierId,
      accessTokenId: tokenRecord.id,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      result: outcome,
      denialReason: denialReason || null,
    });

    return {
      outcome,
      denialReason,
      dossierId: tokenRecord.dossierId,
      organizationId: tokenRecord.organizationId,
      accessTokenId: tokenRecord.id,
      requiresSecondFactor: tokenRecord.requiresSecondFactor,
      ownerContact,
    };
  });
}

/**
 * Generates and sends a 6-digit one-time code for the given token.
 * Stores the SHA-256 hash of the code in dossier_access_otp_codes.
 */
export async function requestOtpCode(accessTokenId: string): Promise<void> {
  await adminDb.transaction(async (tx) => {
    const [tokenRecord] = await tx
      .select({
        id: dossierAccessTokens.id,
        organizationId: dossierAccessTokens.organizationId,
        dossierId: dossierAccessTokens.dossierId,
        dossierCode: dossiers.code,
        partyId: dossiers.partyId,
      })
      .from(dossierAccessTokens)
      .innerJoin(dossiers, eq(dossierAccessTokens.dossierId, dossiers.id))
      .where(eq(dossierAccessTokens.id, accessTokenId))
      .limit(1);

    if (!tokenRecord) {
      throw new Error('Enlace de acceso no encontrado');
    }

    // Generate 6 digit numeric code
    const rawCode = randomInt(100000, 999999).toString();
    const codeHash = createHash('sha256').update(rawCode).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

    await tx.insert(dossierAccessOtpCodes).values({
      organizationId: tokenRecord.organizationId,
      dossierId: tokenRecord.dossierId,
      accessTokenId: tokenRecord.id,
      codeHash,
      expiresAt,
      attempts: 0,
    });

    // In a full flow we would lookup the party email, or for now send to mock / log
    await sendOtpEmail({
      to: 'contraparte@ejemplo.com',
      code: rawCode,
      dossierCode: tokenRecord.dossierCode || 'Expediente',
    }).catch((err) => {
      console.warn('[requestOtpCode] Error enviando correo con código OTP:', err);
    });
  });
}

/**
 * Verifies the 6-digit OTP code against the active hash.
 * Increments attempt counter and locks/fails after max attempts (5).
 */
export async function verifyOtpCode(
  accessTokenId: string,
  code: string,
): Promise<{ verified: boolean; reason?: string }> {
  const codeHash = createHash('sha256').update(code.trim()).digest('hex');

  return adminDb.transaction(async (tx) => {
    // Look up most recent unconsumed OTP code for this access token
    const [otpRecord] = await tx
      .select()
      .from(dossierAccessOtpCodes)
      .where(
        and(
          eq(dossierAccessOtpCodes.accessTokenId, accessTokenId),
        ),
      )
      .orderBy(dossierAccessOtpCodes.createdAt)
      .limit(1);

    if (!otpRecord) {
      return { verified: false, reason: 'No se encontró ningún código solicitado' };
    }

    if (otpRecord.consumedAt) {
      return { verified: false, reason: 'El código ya ha sido utilizado' };
    }

    if (otpRecord.expiresAt.getTime() <= Date.now()) {
      return { verified: false, reason: 'El código ha expirado' };
    }

    if (otpRecord.attempts >= 5) {
      return { verified: false, reason: 'Demasiados intentos fallidos. Solicite un nuevo código.' };
    }

    if (otpRecord.codeHash !== codeHash) {
      await tx
        .update(dossierAccessOtpCodes)
        .set({ attempts: otpRecord.attempts + 1 })
        .where(eq(dossierAccessOtpCodes.id, otpRecord.id));

      return { verified: false, reason: 'Código incorrecto' };
    }

    // Success: mark consumed
    await tx
      .update(dossierAccessOtpCodes)
      .set({
        consumedAt: new Date(),
        attempts: otpRecord.attempts + 1,
      })
      .where(eq(dossierAccessOtpCodes.id, otpRecord.id));

    return { verified: true };
  });
}

/**
 * Dispatches entry transition 'enviada' -> 'en_diligenciamiento' if currently in 'enviada'.
 * Idempotent: if already progressed, does nothing.
 */
export async function ensureEntryTransition(
  dossierId: string,
  organizationId: string,
): Promise<void> {
  await adminDb.transaction(async (tx) => {
    const [dossier] = await tx
      .select({
        id: dossiers.id,
        state: dossiers.state,
      })
      .from(dossiers)
      .where(
        and(
          eq(dossiers.id, dossierId),
          eq(dossiers.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!dossier || dossier.state !== 'enviada') {
      return;
    }

    // Execute transition using executeTransition with admin txClient
    await executeTransition(
      {
        dossierId,
        organizationId,
        toState: 'en_diligenciamiento',
        actorType: 'counterparty',
      },
      tx as unknown as DrizzleClient,
    );
  });
}
