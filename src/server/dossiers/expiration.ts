import { and, eq, inArray, sql } from 'drizzle-orm';
import { adminDb } from '../db/admin-client';
import {
  dossiers,
  dossierAccessTokens,
  users,
  roles,
  rolePermissions,
  memberships,
  organizations,
  assertions,
} from '../db/schema';
import { executeTransition } from './state-machine';
import { getActiveConfigurationVersion } from '../auth/role-config';
import { getEntityAuditHistory, logAuditEvent } from '../audit/service';
import {
  sendDossierExpirationReminderEmail,
  sendDossierExpirationEscalationEmail,
} from '../notifications/email';

export interface ExpirationRunSummary {
  transitionedToExpired: number;
  remindersSent: number;
  escalationsSent: number;
}

const REMINDER_THRESHOLD_BEFORE_ESCALATION = 3;

/**
 * Executes a daily check of pending dossiers whose counterparty access link expired.
 * Runs across all organizations using privileged admin connection.
 * Scoped by organization for all transitions, reminders and audit entries.
 */
export async function detectAndProcessExpiredDossiers(): Promise<ExpirationRunSummary> {
  const summary: ExpirationRunSummary = {
    transitionedToExpired: 0,
    remindersSent: 0,
    escalationsSent: 0,
  };

  const now = new Date();

  // -------------------------------------------------------------------------
  // 1. Mark expired active tokens whose expiresAt <= now as 'expired'
  //    (Triggers allow updating active token to 'expired')
  // -------------------------------------------------------------------------
  const expiredTokens = await adminDb
    .select({
      id: dossierAccessTokens.id,
      dossierId: dossierAccessTokens.dossierId,
      organizationId: dossierAccessTokens.organizationId,
    })
    .from(dossierAccessTokens)
    .where(
      and(
        eq(dossierAccessTokens.state, 'active'),
        sql`${dossierAccessTokens.expiresAt} <= now()`,
      ),
    );

  if (expiredTokens.length > 0) {
    const expiredTokenIds = expiredTokens.map((t) => t.id);
    await adminDb
      .update(dossierAccessTokens)
      .set({ state: 'expired' })
      .where(inArray(dossierAccessTokens.id, expiredTokenIds));
  }

  // -------------------------------------------------------------------------
  // 2. Identify candidate dossiers in ('enviada', 'en_diligenciamiento')
  //    whose latest token is expired (and has no active token).
  // -------------------------------------------------------------------------
  const candidateDossiers = await adminDb
    .select({
      id: dossiers.id,
      organizationId: dossiers.organizationId,
      state: dossiers.state,
    })
    .from(dossiers)
    .where(inArray(dossiers.state, ['enviada', 'en_diligenciamiento']));

  for (const dossier of candidateDossiers) {
    // Check if there is any active token
    const [activeToken] = await adminDb
      .select({ id: dossierAccessTokens.id })
      .from(dossierAccessTokens)
      .where(
        and(
          eq(dossierAccessTokens.organizationId, dossier.organizationId),
          eq(dossierAccessTokens.dossierId, dossier.id),
          eq(dossierAccessTokens.state, 'active'),
        ),
      )
      .limit(1);

    if (activeToken) {
      continue;
    }

    // Check if there is at least one expired token (a dossier without any tokens issued doesn't expire)
    const [expiredToken] = await adminDb
      .select({ id: dossierAccessTokens.id })
      .from(dossierAccessTokens)
      .where(
        and(
          eq(dossierAccessTokens.organizationId, dossier.organizationId),
          eq(dossierAccessTokens.dossierId, dossier.id),
          eq(dossierAccessTokens.state, 'expired'),
        ),
      )
      .limit(1);

    if (!expiredToken) {
      continue;
    }

    // Execute state transition: enviada / en_diligenciamiento -> expirado_pendiente
    await adminDb.transaction(async (tx) => {
      await executeTransition(
        {
          organizationId: dossier.organizationId,
          dossierId: dossier.id,
          toState: 'expirado_pendiente',
          actorType: 'system',
        },
        tx,
      );
    });

    summary.transitionedToExpired += 1;
  }

  // -------------------------------------------------------------------------
  // 3. Process all dossiers currently in 'expirado_pendiente'
  //    (both newly transitioned and existing ones)
  // -------------------------------------------------------------------------
  const expiredPendingDossiers = await adminDb
    .select({
      id: dossiers.id,
      code: dossiers.code,
      organizationId: dossiers.organizationId,
      internalOwnerId: dossiers.internalOwnerId,
      configurationVersionId: dossiers.configurationVersionId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(dossiers)
    .leftJoin(organizations, eq(dossiers.organizationId, organizations.id))
    .leftJoin(users, eq(dossiers.internalOwnerId, users.id))
    .where(eq(dossiers.state, 'expirado_pendiente'));

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const item of expiredPendingDossiers) {
    const orgId = item.organizationId;
    const dossierId = item.id;

    // Fetch declared counterparty name
    const [nameAssertion] = await adminDb
      .select({ value: assertions.value })
      .from(assertions)
      .where(
        and(
          eq(assertions.organizationId, orgId),
          eq(assertions.dossierId, dossierId),
          eq(assertions.field, 'party.declared_name'),
        ),
      )
      .limit(1);

    const partyDeclaredName = nameAssertion?.value ? String(nameAssertion.value) : 'Contraparte';
    const organizationName = item.orgName || 'Organización';
    const dossierCode = item.code || 'SIN-CODIGO';

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const dossierUrl = `${baseUrl}/app/${item.orgSlug || orgId}/expedientes/${dossierId}`;

    // Query audit history for reminders and escalations
    const auditLogs = await getEntityAuditHistory(orgId, 'dossier', dossierId, adminDb);

    // b. If already escalated -> do nothing
    const alreadyEscalated = auditLogs.some((l) => l.action === 'dossier.expiration_escalated');
    if (alreadyEscalated) {
      continue;
    }

    // c. If a reminder was already sent TODAY -> do nothing (prevent duplicate in same day / rerun)
    const sentToday = auditLogs.some(
      (l) =>
        l.action === 'dossier.expiration_reminder_sent' &&
        new Date(l.occurredAt) >= todayStart,
    );
    if (sentToday) {
      continue;
    }

    // Count reminders sent so far
    const reminderLogs = auditLogs.filter((l) => l.action === 'dossier.expiration_reminder_sent');
    const reminderCount = reminderLogs.length;

    if (reminderCount >= REMINDER_THRESHOLD_BEFORE_ESCALATION) {
      // d. Threshold reached -> Send escalation to all members with 'dossier:approve'
      // Uses the organization's CURRENTLY ACTIVE configuration version to resolve who has
      // dossier:approve today — same source of truth as checkUserPermission — never the
      // dossier's own frozen configurationVersionId, which reflects the matrix at the time
      // the dossier was opened, not who currently holds decision authority.
      const activeVersion = await getActiveConfigurationVersion(orgId, adminDb);

      const decisionMakers = activeVersion
        ? await adminDb
            .select({
              userId: users.id,
              name: users.name,
              email: users.email,
            })
            .from(memberships)
            .innerJoin(users, eq(memberships.userId, users.id))
            .innerJoin(
              roles,
              and(
                eq(roles.organizationId, orgId),
                eq(roles.configurationVersionId, activeVersion.id),
                eq(roles.code, memberships.role),
              ),
            )
            .innerJoin(
              rolePermissions,
              and(
                eq(rolePermissions.organizationId, orgId),
                eq(rolePermissions.configurationVersionId, activeVersion.id),
                eq(rolePermissions.roleId, roles.id),
                eq(rolePermissions.permissionKey, 'dossier:approve'),
              ),
            )
            .where(
              and(
                eq(memberships.organizationId, orgId),
                eq(memberships.status, 'active'),
              ),
            )
        : [];

      // Send escalation email to each decision maker
      for (const dm of decisionMakers) {
        if (dm.email) {
          await sendDossierExpirationEscalationEmail({
            to: dm.email,
            recipientName: dm.name || undefined,
            dossierCode,
            partyDeclaredName,
            organizationName,
            internalOwnerName: item.ownerName || undefined,
            dossierUrl,
            reminderCount,
          });
        }
      }

      await logAuditEvent(
        {
          organizationId: orgId,
          actorType: 'system',
          action: 'dossier.expiration_escalated',
          entity: 'dossier',
          entityId: dossierId,
          configurationVersionId: item.configurationVersionId,
          automatic: true,
          metadata: {
            reminder_count: reminderCount,
            decision_makers_count: decisionMakers.length,
          },
          origin: { actor: 'system', action: 'detectAndProcessExpiredDossiers' },
        },
        adminDb,
      );

      summary.escalationsSent += 1;
    } else {
      // e. Send reminder to internalOwnerId
      if (item.ownerEmail) {
        await sendDossierExpirationReminderEmail({
          to: item.ownerEmail,
          ownerName: item.ownerName || undefined,
          dossierCode,
          partyDeclaredName,
          organizationName,
          dossierUrl,
        });
      }

      await logAuditEvent(
        {
          organizationId: orgId,
          actorType: 'system',
          action: 'dossier.expiration_reminder_sent',
          entity: 'dossier',
          entityId: dossierId,
          configurationVersionId: item.configurationVersionId,
          automatic: true,
          metadata: {
            reminder_number: reminderCount + 1,
            internal_owner_id: item.internalOwnerId,
          },
          origin: { actor: 'system', action: 'detectAndProcessExpiredDossiers' },
        },
        adminDb,
      );

      summary.remindersSent += 1;
    }
  }

  return summary;
}
