export interface SignatureRequest {
  organizationId: string;
  dossierId: string;
  partyId: string;
  level: 1 | 2;
  contentHash: string;
  contentVersion: string;
  ipAddress: string;
  additionalFactor?: { method: 'otp_email'; verifiedAt: string };
}

export interface SignatureResult {
  signatureId: string;
  signedAt: Date;
}

export interface SignatureProvider {
  sign(request: SignatureRequest): Promise<SignatureResult>;
}
