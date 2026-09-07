import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { executePrivilegedSystemOperation, adminDb } from './system-execution';
import { invitations, organizations, memberships, users } from '../db/schema';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface ResolveInvitationResult {
  outcome: 'valid' | 'invalid';
  reason?: 'not_found' | 'expired' | 'revoked' | 'replaced' | 'accepted';
  invitationId?: string;
  organizationId?: string;
  organizationName?: string;
  email?: string;
  role?: string;
  accountExists?: boolean;
}

/**
 * Resolves an invitation token without an existing user session.
 * Always records audit trail using executePrivilegedSystemOperation.
 */
export async function resolveInvitation(rawToken: string): Promise<ResolveInvitationResult> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Look up invitation first using adminDb to get organizationId
  const [inv] = await adminDb
    .select({
      id: invitations.id,
      organizationId: invitations.organizationId,
      email: invitations.email,
      role: invitations.role,
      state: invitations.state,
      expiresAt: invitations.expiresAt,
      orgName: organizations.name,
    })
    .from(invitations)
    .innerJoin(organizations, eq(invitations.organizationId, organizations.id))
    .where(eq(invitations.tokenHash, tokenHash));

  if (!inv) {
    return { outcome: 'invalid', reason: 'not_found' };
  }

  const isExpired = new Date() > inv.expiresAt;
  const denialReason =
    inv.state !== 'pending'
      ? (inv.state as ResolveInvitationResult['reason'])
      : isExpired
        ? 'expired'
        : undefined;

  const outcome: 'valid' | 'invalid' = denialReason ? 'invalid' : 'valid';

  return executePrivilegedSystemOperation(
    {
      action: 'invitation.resolved',
      organizationId: inv.organizationId,
      entity: 'invitation',
      entityId: inv.id,
      metadata: {
        invitation_id: inv.id,
        email: inv.email,
        role: inv.role,
        outcome,
        reason: denialReason || null,
      },
      description: 'Resolution of member invitation by raw token',
    },
    async (tx) => {
      if (isExpired && inv.state === 'pending') {
        await tx
          .update(invitations)
          .set({ state: 'expired' })
          .where(eq(invitations.id, inv.id));
      }

      if (denialReason) {
        return {
          outcome: 'invalid',
          reason: denialReason,
          invitationId: inv.id,
          organizationId: inv.organizationId,
          organizationName: inv.orgName,
          email: inv.email,
          role: inv.role,
        };
      }

      // Check if user account already exists in public.users / auth
      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, inv.email));

      return {
        outcome: 'valid',
        invitationId: inv.id,
        organizationId: inv.organizationId,
        organizationName: inv.orgName,
        email: inv.email,
        role: inv.role,
        accountExists: !!existingUser,
      };
    },
  );
}

/**
 * Accepts an invitation creating a brand new Supabase Auth user.
 */
export async function acceptInvitationAsNewUser(
  rawToken: string,
  input: { fullName: string; password: string },
): Promise<{ userId: string }> {
  // 1. First find and validate the invitation
  const initialCheck = await resolveInvitation(rawToken);
  if (initialCheck.outcome !== 'valid' || !initialCheck.organizationId || !initialCheck.invitationId || !initialCheck.email) {
    throw new Error(`Invitación inválida o no disponible para aceptación: ${initialCheck.reason || 'desconocido'}`);
  }

  const organizationId = initialCheck.organizationId;
  const invitationId = initialCheck.invitationId;
  const email = initialCheck.email;
  const role = initialCheck.role!;

  // 2. Create the user in Supabase Auth via admin client
  const supabaseAdmin = createSupabaseAdminClient();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      name: input.fullName.trim(),
    },
  });

  if (authError || !authData.user) {
    throw new Error(`Error al crear la cuenta de usuario: ${authError?.message || 'Error desconocido'}`);
  }

  const newUserId = authData.user.id;

  // 3. Complete membership and invitation state transition in privileged transaction
  await executePrivilegedSystemOperation(
    {
      action: 'invitation.accepted',
      organizationId,
      entity: 'invitation',
      entityId: invitationId,
      metadata: {
        invitation_id: invitationId,
        user_id: newUserId,
        email,
        role,
        is_new_user: true,
      },
      description: 'Acceptance of member invitation by new user',
    },
    async (tx) => {
      const now = new Date();

      // Ensure user is in public.users (trigger sync usually does it, but upsert ensures atomic transaction safety)
      await tx
        .insert(users)
        .values({
          id: newUserId,
          email,
          name: input.fullName.trim(),
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { name: input.fullName.trim() },
        });

      // Insert active membership
      await tx
        .insert(memberships)
        .values({
          organizationId,
          userId: newUserId,
          role,
          status: 'active',
        });

      // Mark invitation as accepted
      await tx
        .update(invitations)
        .set({
          state: 'accepted',
          acceptedAt: now,
        })
        .where(eq(invitations.id, invitationId));
    },
  );

  return { userId: newUserId };
}

/**
 * Accepts an invitation for an existing authenticated user.
 */
export async function acceptInvitationForExistingUser(
  rawToken: string,
  authenticatedUserId: string,
): Promise<void> {
  const initialCheck = await resolveInvitation(rawToken);
  if (initialCheck.outcome !== 'valid' || !initialCheck.organizationId || !initialCheck.invitationId || !initialCheck.email) {
    throw new Error(`Invitación inválida o no disponible: ${initialCheck.reason || 'desconocido'}`);
  }

  const organizationId = initialCheck.organizationId;
  const invitationId = initialCheck.invitationId;
  const email = initialCheck.email;
  const role = initialCheck.role!;

  await executePrivilegedSystemOperation(
    {
      action: 'invitation.accepted',
      organizationId,
      entity: 'invitation',
      entityId: invitationId,
      metadata: {
        invitation_id: invitationId,
        user_id: authenticatedUserId,
        email,
        role,
        is_new_user: false,
      },
      description: 'Acceptance of member invitation by existing authenticated user',
    },
    async (tx) => {
      // Security check: authenticatedUserId MUST match the email on the invitation
      const [userRow] = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, authenticatedUserId));

      if (!userRow || userRow.email.toLowerCase() !== email.toLowerCase()) {
        throw new Error('La sesión activa no coincide con el correo electrónico de esta invitación');
      }

      const now = new Date();

      // Check existing active membership for this user in the organization
      const [existingMembership] = await tx
        .select({ id: memberships.id, status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, authenticatedUserId),
          ),
        );

      if (existingMembership) {
        await tx
          .update(memberships)
          .set({
            role,
            status: 'active',
            revokedAt: null,
          })
          .where(eq(memberships.id, existingMembership.id));
      } else {
        await tx
          .insert(memberships)
          .values({
            organizationId,
            userId: authenticatedUserId,
            role,
            status: 'active',
          });
      }

      // Mark invitation as accepted
      await tx
        .update(invitations)
        .set({
          state: 'accepted',
          acceptedAt: now,
        })
        .where(eq(invitations.id, invitationId));
    },
  );
}