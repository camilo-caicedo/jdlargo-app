import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import * as dbSchema from '../db/schema';
import type { DatabaseTransaction } from '../db/client';
import type { Role } from './types';

type Tx = DatabaseTransaction;

export const organizationsRepository = {
  async createOrganizationWithAdmin(
    tx: Tx,
    input: { name: string; slug: string; taxId?: string | null; origin?: Record<string, unknown> | null },
  ) {
    const originJson = input.origin ? JSON.stringify(input.origin) : null;
    const result = await tx.execute<{
      id: string;
      name: string;
      slug: string;
      tax_id: string | null;
      status: 'active' | 'suspended';
      created_at: string;
      updated_at: string;
    }>(
      sql`select * from create_organization_with_admin(${input.name}, ${input.slug}, ${input.taxId ?? null}, ${originJson}::jsonb)`
    );
    const row = result[0];
    if (!row) throw new Error('Failed to create organization');
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      taxId: row.tax_id,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  },

  async findOrganizationById(tx: Tx, id: string) {
    const rows = await tx
      .select()
      .from(dbSchema.organizations)
      .where(eq(dbSchema.organizations.id, id))
      .limit(1);
    return rows[0] || null;
  },

  async findOrganizationBySlug(tx: Tx, slug: string) {
    const rows = await tx
      .select()
      .from(dbSchema.organizations)
      .where(eq(dbSchema.organizations.slug, slug))
      .limit(1);
    return rows[0] || null;
  },

  async findMembership(tx: Tx, organizationId: string, userId: string) {
    const rows = await tx
      .select()
      .from(dbSchema.memberships)
      .where(
        and(
          eq(dbSchema.memberships.organizationId, organizationId),
          eq(dbSchema.memberships.userId, userId),
          eq(dbSchema.memberships.status, 'active')
        )
      )
      .limit(1);
    return rows[0] || null;
  },

  async grantMembership(
    tx: Tx,
    input: { organizationId: string; userId: string; role: Role },
  ) {
    const rows = await tx
      .insert(dbSchema.memberships)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        status: 'active',
      })
      .returning();
    return rows[0];
  },

  async revokeMembership(tx: Tx, organizationId: string, membershipId: string) {
    const rows = await tx
      .update(dbSchema.memberships)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
      })
      .where(
        and(
          eq(dbSchema.memberships.id, membershipId),
          eq(dbSchema.memberships.organizationId, organizationId),
          eq(dbSchema.memberships.status, 'active')
        )
      )
      .returning();
    return rows[0] || null;
  },

  async listMembers(tx: Tx, organizationId: string) {
    return tx
      .select({
        membership: dbSchema.memberships,
        user: dbSchema.users,
      })
      .from(dbSchema.memberships)
      .innerJoin(dbSchema.users, eq(dbSchema.memberships.userId, dbSchema.users.id))
      .where(
        and(
          eq(dbSchema.memberships.organizationId, organizationId),
          eq(dbSchema.memberships.status, 'active')
        )
      );
  },

  async findAuditLogs(tx: Tx, organizationId: string) {
    return tx
      .select()
      .from(dbSchema.auditLog)
      .where(eq(dbSchema.auditLog.organizationId, organizationId))
      .orderBy(desc(dbSchema.auditLog.occurredAt));
  },

  async listActiveMembershipsForUser(tx: Tx, userId: string) {
    return tx
      .select({
        organizationId: dbSchema.memberships.organizationId,
        organizationName: dbSchema.organizations.name,
        slug: dbSchema.organizations.slug,
      })
      .from(dbSchema.memberships)
      .innerJoin(dbSchema.organizations, eq(dbSchema.memberships.organizationId, dbSchema.organizations.id))
      .where(
        and(
          eq(dbSchema.memberships.userId, userId),
          eq(dbSchema.memberships.status, 'active'),
          eq(dbSchema.organizations.status, 'active'),
        ),
      );
  },
};