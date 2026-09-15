import { createHash } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db, DrizzleClient } from '../db/client';
import {
  signatures,
  configurationVersions,
  dossiers,
} from '../db/schema';
import { getLatestDeclaredValuesForDossier } from '../assertions/service';
import { getLatestDocumentsForDossier } from '../documents/document';
import { verifyOtpCode, requestOtpCode } from '../privileged/portal-access';
import { createLocalSignatureProvider } from './local-provider';
import type { SignatureRequest } from './port';
import { logAuditEvent } from '../audit/service';

export interface SignatureRecord {
  id: string;
  level: 1 | 2;
  contentHash: string;
  signedAt: Date;
  status: 'active' | 'invalid';
}

export interface DossierSignatureStatus {
  levelRequired: 1 | 2;
  activeSignature: SignatureRecord | null;
}

/**
 * Calcula la huella digital estable del contenido declarado + documentos vigentes de un
 * expediente. Cualquier cambio en un campo declarado o en el hash de un documento vigente
 * cambia este valor.
 */
export async function computeDossierContentHash(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<string> {
  const client = txClient || db;
  const [declaredValues, latestDocs] = await Promise.all([
    getLatestDeclaredValuesForDossier(organizationId, dossierId, client),
    getLatestDocumentsForDossier(organizationId, dossierId, client),
  ]);

  const fieldsObj = Object.fromEntries(
    declaredValues.map((v) => [v.field, v.value] as const).sort(([a], [b]) => (a as string).localeCompare(b as string)),
  );
  const docHashes = latestDocs
    .filter((d) => d.state !== 'rejected')
    .map((d) => `${d.documentType}:${d.hash}`)
    .sort();

  const canonical = JSON.stringify({ fields: fieldsObj, documents: docHashes });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Obtiene el nivel de firma requerido y la firma activa más reciente (si existe) para un expediente.
 */
export async function getDossierSignatureStatus(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<DossierSignatureStatus> {
  const client = txClient || db;

  // Get configuration version ID from dossier
  const [dossierRecord] = await client
    .select({ configurationVersionId: dossiers.configurationVersionId })
    .from(dossiers)
    .where(and(
      eq(dossiers.organizationId, organizationId),
      eq(dossiers.id, dossierId),
    ))
    .limit(1);

  if (!dossierRecord) {
    throw new Error('Expediente no encontrado');
  }

  // Get required level from configuration
  const [configRecord] = await client
    .select({ signatureLevelRequired: configurationVersions.signatureLevelRequired })
    .from(configurationVersions)
    .where(eq(configurationVersions.id, dossierRecord.configurationVersionId))
    .limit(1);

  const levelRequired = (configRecord?.signatureLevelRequired || 1) as 1 | 2;

  // Get most recent active signature
  const [activeSignature] = await client
    .select({
      id: signatures.id,
      level: signatures.level,
      contentHash: signatures.contentHash,
      signedAt: signatures.signedAt,
      status: signatures.status,
    })
    .from(signatures)
    .where(and(
      eq(signatures.organizationId, organizationId),
      eq(signatures.dossierId, dossierId),
      eq(signatures.status, 'active'),
    ))
    .orderBy(desc(signatures.signedAt))
    .limit(1);

  return {
    levelRequired,
    activeSignature: activeSignature ? {
      id: activeSignature.id,
      level: activeSignature.level as 1 | 2,
      contentHash: activeSignature.contentHash,
      signedAt: activeSignature.signedAt,
      status: 'active' as const,
    } : null,
  };
}

/**
 * Wrapper para solicitar código OTP para firma.
 */
export async function requestSignatureOtp(
  accessTokenId: string,
): Promise<void> {
  await requestOtpCode(accessTokenId, 'signature');
}

export interface SignDossierInput {
  organizationId: string;
  dossierId: string;
  partyId: string;
  ipAddress: string;
  accessTokenId: string;
  otpCode?: string;
}

/**
 * Firma un expediente con el nivel especificado por la configuración.
 * Si el nivel es 2, exige verificación de OTP primero.
 * Es idempotente: si ya existe una firma activa con el mismo contentHash, retorna éxito.
 */
export async function signDossier(
  input: SignDossierInput,
  txClient?: DrizzleClient,
): Promise<{ success: true; signatureId: string } | { success: false; error: string }> {
  const client = txClient || db;

  // 1. Verify dossier state and tenant isolation
  const [dossierRecord] = await client
    .select({ state: dossiers.state, organizationId: dossiers.organizationId })
    .from(dossiers)
    .where(and(
      eq(dossiers.organizationId, input.organizationId),
      eq(dossiers.id, input.dossierId),
    ))
    .limit(1);

  if (!dossierRecord) {
    return { success: false, error: 'Expediente no encontrado' };
  }

  if (dossierRecord.state !== 'documentos_recibidos') {
    return {
      success: false,
      error: 'El expediente no está en estado pendiente de firma',
    };
  }

  // 2. Get signature status
  const status = await getDossierSignatureStatus(input.organizationId, input.dossierId, client);

  // 3. Check if already signed with current content
  const currentHash = await computeDossierContentHash(input.organizationId, input.dossierId, client);
  if (status.activeSignature && status.activeSignature.contentHash === currentHash) {
    return { success: true, signatureId: status.activeSignature.id };
  }

  // 4. If level 2, verify OTP
  if (status.levelRequired === 2) {
    if (!input.otpCode) {
      return { success: false, error: 'Se requiere código de verificación' };
    }

    const otpResult = await verifyOtpCode(input.accessTokenId, input.otpCode, 'signature');
    if (!otpResult.verified) {
      return { success: false, error: otpResult.reason || 'Código inválido o expirado' };
    }
  }

  // 5. Create signature
  const contentVersion = new Date().toISOString();
  const provider = createLocalSignatureProvider(client);
  const signRequest: SignatureRequest = {
    organizationId: input.organizationId,
    dossierId: input.dossierId,
    partyId: input.partyId,
    level: status.levelRequired,
    contentHash: currentHash,
    contentVersion,
    ipAddress: input.ipAddress,
    additionalFactor: status.levelRequired === 2
      ? { method: 'otp_email', verifiedAt: new Date().toISOString() }
      : undefined,
  };

  try {
    const result = await provider.sign(signRequest);

    // 6. Log audit event
    await logAuditEvent(
      {
        action: 'dossier.signed',
        organizationId: input.organizationId,
        entity: 'dossier',
        entityId: input.dossierId,
        metadata: {
          level: status.levelRequired,
          contentHash: currentHash,
          signatureId: result.signatureId,
        },
      },
      client,
    );

    return { success: true, signatureId: result.signatureId };
  } catch (error) {
    console.error('[signDossier] Error signing dossier:', error);
    return { success: false, error: 'Error al firmar el expediente' };
  }
}

/**
 * Invalida la firma activa si el contenido del expediente ha cambiado.
 * Si no hay firma activa, es un no-op barato.
 */
export async function invalidateActiveSignatureIfContentChanged(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<void> {
  const client = txClient || db;

  const status = await getDossierSignatureStatus(organizationId, dossierId, client);
  if (!status.activeSignature) {
    return; // No-op if no active signature
  }

  const currentHash = await computeDossierContentHash(organizationId, dossierId, client);
  if (currentHash === status.activeSignature.contentHash) {
    return; // No-op if content hasn't changed
  }

  // Content changed: invalidate the signature
  await client
    .update(signatures)
    .set({
      status: 'invalid',
      invalidatedAt: new Date(),
      invalidatedReason: 'El contenido del expediente cambió después de firmar',
    })
    .where(eq(signatures.id, status.activeSignature.id));

  await logAuditEvent(
    {
      action: 'dossier.signature_invalidated',
      organizationId,
      entity: 'dossier',
      entityId: dossierId,
      metadata: {
        signatureId: status.activeSignature.id,
      },
    },
    client,
  );
}
