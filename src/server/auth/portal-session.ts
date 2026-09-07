import { createHmac, timingSafeEqual } from 'crypto';

const secret = process.env.PORTAL_SESSION_SECRET || 'fallback_dev_secret_replace_in_production_32b';

export interface PortalSessionData {
  accessTokenId: string;
  verifiedAt: number;
}

/**
 * Creates an HMAC-SHA256 signature for a portal session payload.
 * Format: base64(payload).signatureHex
 */
export function signPortalSession(data: PortalSessionData): string {
  const payloadStr = JSON.stringify(data);
  const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

/**
 * Validates the HMAC signature and extracts the portal session data.
 */
export function verifyPortalSession(sessionCookie: string): PortalSessionData | null {
  try {
    const parts = sessionCookie.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [payloadB64, providedSig] = parts;
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(providedSig, 'hex');

    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      return null;
    }

    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr) as PortalSessionData;

    if (!parsed.accessTokenId || !parsed.verifiedAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
