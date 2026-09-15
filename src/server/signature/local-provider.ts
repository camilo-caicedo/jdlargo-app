import { db, DrizzleClient } from '../db/client';
import { signatures } from '../db/schema';
import type { SignatureProvider, SignatureRequest, SignatureResult } from './port';

export function createLocalSignatureProvider(txClient?: DrizzleClient): SignatureProvider {
  const client = txClient || db;
  return {
    async sign(request: SignatureRequest): Promise<SignatureResult> {
      const [inserted] = await client.insert(signatures).values({
        organizationId: request.organizationId,
        dossierId: request.dossierId,
        partyId: request.partyId,
        level: request.level,
        contentHash: request.contentHash,
        contentVersion: request.contentVersion,
        ipAddress: request.ipAddress,
        additionalFactor: request.additionalFactor || null,
      }).returning();
      return { signatureId: inserted.id, signedAt: inserted.signedAt };
    },
  };
}
