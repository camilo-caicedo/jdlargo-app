export type Role = 'admin' | 'compliance_analyst' | 'auditor';
export type OrganizationStatus = 'active' | 'suspended';
export type MembershipStatus = 'active' | 'revoked';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  taxId: string | null;
  status: OrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  origin: Record<string, unknown> | null;
  occurredAt: Date;
}