import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { withTenantContext } from '../db/client';
import { invitations, organizations } from '../db/schema';
import { enforceUserPermission } from '../auth/access-control';
import { getActiveConfiguration } from '../configuration/service';
import { logAuditEvent } from '../audit/service';
import { sendInvitationEmail } from '../notifications/email';

export interface InviteMemberInput {
  callerUserId: string;
  organizationId: string;
  email: string;
  role: string; // role code matching memberships.role
}

export interface InvitationDetail {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  state: 'pending' | 'accepted' | 'expired' | 'revoked' | 'replaced';
  expiresAt: Date;
  invitedBy: string;
  createdAt: Date;
  rawToken?: string;
}

/**
 * Invites a new member to the organization.
 * - Requires 'memberships:manage' permission.
 * - Validates that the role code exists in the active configuration version.
 * - Replaces any existing 'pending' invitation for the same email & org.
 * - Generates cryptographically secure raw token (sha256 saved to DB).
 * - Sends email on best-effort basis.
 */
export async function inviteMember(input: InviteMemberInput): Promise<InvitationDetail> {
  const normalizedEmail = input.email.trim().toLowerCase();

  // 1. Enforce permission
  await enforceUserPermission(
    {
      userId: input.callerUserId,
      organizationId: input.organizationId,
    },
    'memberships:manage',
    {
      entity: 'invitation',
      action: 'inviteMember',
    },
  );

  // 2. Validate role code against active configuration
  const activeConfig = await getActiveConfiguration(input.organizationId);
  if (!activeConfig) {
    throw new Error('No se puede invitar miembros: la organización no tiene una versión de configuración activa');
  }

  const roleExists = activeConfig.roles.some((r) => r.code === input.role);
  if (!roleExists) {
    throw new Error(`El rol especificado '${input.role}' no existe en la configuración activa de la organización`);
  }

  // 3. Generate secure token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  return withTenantContext(
    {
      userId: input.callerUserId,
      organizationId: input.organizationId,
    },
    async (tx) => {
      const orgId = input.organizationId;
      // 4. Mark existing pending invitation for same email as 'replaced'
      const [existingPending] = await tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, orgId),
            eq(invitations.email, normalizedEmail),
            eq(invitations.state, 'pending'),
          ),
        );

      if (existingPending) {
        await tx
          .update(invitations)
          .set({
            state: 'replaced',
          })
          .where(eq(invitations.id, existingPending.id));

        await logAuditEvent(
          {
            organizationId: orgId,
            actorType: 'user',
            actorUserId: input.callerUserId,
            action: 'invitation.replaced',
            entity: 'invitation',
            entityId: existingPending.id,
            metadata: {
              replaced_invitation_id: existingPending.id,
              email: normalizedEmail,
            },
            origin: { actor: 'user', action: 'inviteMember' },
          },
          tx,
        );
      }

      // 5. Insert new invitation
      const [inserted] = await tx
        .insert(invitations)
        .values({
          organizationId: orgId,
          email: normalizedEmail,
          role: input.role,
          tokenHash,
          expiresAt,
          state: 'pending',
          invitedBy: input.callerUserId,
        })
        .returning();

      // 6. Audit trail
      await logAuditEvent(
        {
          organizationId: orgId,
          actorType: 'user',
          actorUserId: input.callerUserId,
          action: 'invitation.created',
          entity: 'invitation',
          entityId: inserted.id,
          metadata: {
            invitation_id: inserted.id,
            email: normalizedEmail,
            role: input.role,
            expires_at: expiresAt.toISOString(),
          },
          origin: { actor: 'user', action: 'inviteMember' },
        },
        tx,
      );

      const detail: InvitationDetail = {
        id: inserted.id,
        organizationId: inserted.organizationId,
        email: inserted.email,
        role: inserted.role,
        state: inserted.state as InvitationDetail['state'],
        expiresAt: inserted.expiresAt,
        invitedBy: inserted.invitedBy,
        createdAt: inserted.createdAt,
        rawToken,
      };

      // 7. Fetch org name and send email notification (best-effort)
      const [orgRow] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId));

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
      const invitationUrl = `${appUrl}/invitaciones/${rawToken}`;

      sendInvitationEmail({
        to: normalizedEmail,
        organizationName: orgRow?.name || 'Organización',
        invitationUrl,
        roleName: activeConfig.roles.find((r) => r.code === input.role)?.name || input.role,
      }).catch((err) => {
        console.error('[inviteMember] Error sending invitation email:', err);
      });

      return detail;
    },
  );
}

/**
 * Revokes a pending invitation.
 */
export async function revokeInvitation(
  callerUserId: string,
  organizationId: string,
  invitationId: string,
): Promise<void> {
  await enforceUserPermission(
    {
      userId: callerUserId,
      organizationId,
    },
    'memberships:manage',
    {
      entity: 'invitation',
      entityId: invitationId,
      action: 'revokeInvitation',
    },
  );

  await withTenantContext(
    {
      userId: callerUserId,
      organizationId,
    },
    async (tx) => {
      const [inv] = await tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.id, invitationId), eq(invitations.organizationId, organizationId)));

      if (!inv) {
        throw new Error('La invitación no existe en la organización');
      }

      if (inv.state !== 'pending') {
        throw new Error(`No se puede revocar una invitación que no está pendiente (estado: ${inv.state})`);
      }

      const now = new Date();
      await tx
        .update(invitations)
        .set({
          state: 'revoked',
          revokedBy: callerUserId,
          revokedAt: now,
        })
        .where(eq(invitations.id, invitationId));

      await logAuditEvent(
        {
          organizationId,
          actorType: 'user',
          actorUserId: callerUserId,
          action: 'invitation.revoked',
          entity: 'invitation',
          entityId: invitationId,
          metadata: {
            invitation_id: invitationId,
            email: inv.email,
            revoked_at: now.toISOString(),
          },
          origin: { actor: 'user', action: 'revokeInvitation' },
        },
        tx,
      );
    },
  );
}

/**
 * Lists pending invitations for an organization.
 */
export async function listPendingInvitations(
  callerUserId: string,
  organizationId: string,
): Promise<InvitationDetail[]> {
  await enforceUserPermission(
    {
      userId: callerUserId,
      organizationId,
    },
    'memberships:manage',
    {
      entity: 'invitation',
      action: 'listPendingInvitations',
    },
  );

  return withTenantContext(
    {
      userId: callerUserId,
      organizationId,
    },
    async (tx) => {
      const rows = await tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.organizationId, organizationId), eq(invitations.state, 'pending')))
        .orderBy(invitations.createdAt);

      return rows.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        email: r.email,
        role: r.role,
        state: r.state as InvitationDetail['state'],
        expiresAt: r.expiresAt,
        invitedBy: r.invitedBy,
        createdAt: r.createdAt,
      }));
    },
  );
}