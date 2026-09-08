import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '../db/client';
import { createOrganizationWithAdmin, grantMembership, revokeMembership } from '../organizations/use-cases';
import { seedBaseConfiguration, getActiveConfigurationVersion } from '../auth/role-config';
import type { Organization } from '../organizations/types';
import {
  logAuditEvent,
  getEntityAuditHistory,
} from './service';

const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

async function createTestAuthUser(email: string, name: string): Promise<string> {
  const res = await adminSql`
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      ${email},
      'fake_encrypted_pw',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      ${JSON.stringify({ name })}::jsonb,
      now(),
      now()
    ) RETURNING id
  `;
  return res[0].id;
}

const TEST_ORG_NAMES = [
  'Alfa Ficticia S.A.S.',
  'Beta Ficticia S.A.S.',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql.begin(async (tx) => {
    await tx`SET app.allow_config_cleanup = 'true'`;
    await tx`
      DELETE FROM public.audit_log
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${tx(TEST_ORG_NAMES)})
         OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu006.com')
    `;
    await tx`
      DELETE FROM public.assertions
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${tx(TEST_ORG_NAMES)})
    `;
    await tx`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
    await tx`
      DELETE FROM public.memberships
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${tx(TEST_ORG_NAMES)})
         OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu006.com')
    `;
    await tx`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
    await tx`
      DELETE FROM public.role_permissions
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${tx(TEST_ORG_NAMES)})
    `;
    await tx`
      DELETE FROM public.roles
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${tx(TEST_ORG_NAMES)})
    `;
    await tx`
      DELETE FROM public.configuration_versions
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${tx(TEST_ORG_NAMES)})
    `;
    await tx`
      DELETE FROM public.organizations
      WHERE name IN ${tx(TEST_ORG_NAMES)}
    `;
    await tx`DELETE FROM public.users WHERE email LIKE '%@test-hu006.com'`;
    await tx`DELETE FROM auth.users WHERE email LIKE '%@test-hu006.com'`;
    await tx`RESET app.allow_config_cleanup`;
  });
}

describe('HU-006: Bitácora inmutable transversal', () => {
  let orgAlfa: Organization;
  let orgBeta: Organization;
  let adminAlfaId: string;
  let auditorAlfaId: string;
  let adminBetaId: string;

  beforeAll(async () => {
    await cleanupTestData();

    // Org Alfa & Users
    adminAlfaId = await createTestAuthUser('adminAlfa@test-hu006.com', 'Admin Alfa');
    orgAlfa = await createOrganizationWithAdmin(adminAlfaId, { name: 'Alfa Ficticia S.A.S.' });
    await seedBaseConfiguration(orgAlfa.id, adminAlfaId);

    auditorAlfaId = await createTestAuthUser('auditorAlfa@test-hu006.com', 'Auditor Alfa');
    await grantMembership(adminAlfaId, {
      organizationId: orgAlfa.id,
      userId: auditorAlfaId,
      role: 'auditor',
    });

    // Org Beta & Admin
    adminBetaId = await createTestAuthUser('adminBeta@test-hu006.com', 'Admin Beta');
    orgBeta = await createOrganizationWithAdmin(adminBetaId, { name: 'Beta Ficticia S.A.S.' });
    await seedBaseConfiguration(orgBeta.id, adminBetaId);
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 30000);

  it('Escenario: Toda escritura sobre el dominio deja rastro', async () => {
    const activeVer = await getActiveConfigurationVersion(orgAlfa.id);
    expect(activeVer).not.toBeNull();

    const entry = await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'user',
      actorUserId: adminAlfaId,
      action: 'counterparty.updated',
      entity: 'counterparty',
      entityId: 'cp-001',
      requestOrigin: { ipAddress: '190.14.22.10', userAgent: 'Mozilla/5.0' },
      previousValue: { legalName: 'Transportes ABC S.A.S.' },
      newValue: { legalName: 'Transportes ABC Logística S.A.S.' },
      configurationVersionId: activeVer!.id,
    });

    expect(entry.id).toBeDefined();
    expect(entry.actorUserId).toBe(adminAlfaId);
    expect(entry.action).toBe('counterparty.updated');
    expect(entry.entity).toBe('counterparty');
    expect(entry.entityId).toBe('cp-001');
    expect(entry.requestOrigin?.ipAddress).toBe('190.14.22.10');
    expect(entry.previousValue).toEqual({ legalName: 'Transportes ABC S.A.S.' });
    expect(entry.newValue).toEqual({ legalName: 'Transportes ABC Logística S.A.S.' });
    expect(entry.configurationVersionId).toBe(activeVer!.id);
    expect(entry.eventHash).toBeDefined();
    expect(entry.eventHash.length).toBe(64); // SHA-256 length
  });

  it('Escenario: La bitácora no se puede alterar (inmutabilidad por trigger)', async () => {
    const entry = await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'user',
      actorUserId: adminAlfaId,
      action: 'security.alert_checked',
      entity: 'alert',
      entityId: 'alt-999',
    });

    // Attempting direct UPDATE on audit_log
    await expect(
      adminSql`
        UPDATE public.audit_log
        SET action = 'tampered_action'
        WHERE id = ${entry.id}::uuid
      `
    ).rejects.toThrow(/Audit log is strictly immutable: UPDATE operation is forbidden/);

    // Attempting direct DELETE on audit_log
    await expect(
      adminSql`
        DELETE FROM public.audit_log
        WHERE id = ${entry.id}::uuid
      `
    ).rejects.toThrow(/Audit log is strictly immutable: DELETE operation is forbidden/);

    // Attempt recorded tampering verification
    const rows = await adminSql`SELECT action FROM public.audit_log WHERE id = ${entry.id}::uuid`;
    expect(rows[0].action).toBe('security.alert_checked');
  });

  it('Escenario: Un proceso automático se distingue de una persona', async () => {
    const jobEntry = await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'system',
      actorDetails: { cronJob: 'daily_renewal_check_job' },
      action: 'renewal.checked',
      entity: 'renewal',
      entityId: 'ren-456',
      automatic: true,
    });

    expect(jobEntry.actorType).toBe('system');
    expect(jobEntry.actorUserId).toBeNull();
    expect(jobEntry.automatic).toBe(true);
    expect(jobEntry.actorDetails).toEqual({ cronJob: 'daily_renewal_check_job' });

    // Ensure rejecting system event if someone tries to falsely attribute it to a user
    await expect(
      logAuditEvent({
        organizationId: orgAlfa.id,
        actorType: 'system',
        actorUserId: adminAlfaId,
        action: 'fraudulent_system_action',
      })
    ).rejects.toThrow(/Un proceso automático del sistema no se puede atribuir a una persona/);
  });

  it('Escenario: Una acción sin motivo no se registra a medias', async () => {
    // Attempting sensitive action requiring mandatory justification
    await expect(
      logAuditEvent({
        organizationId: orgAlfa.id,
        actorType: 'user',
        actorUserId: adminAlfaId,
        action: 'dossier.override_risk',
        entity: 'dossier',
        entityId: 'dos-100',
        requireReason: true,
        // reason is missing
      })
    ).rejects.toThrow(/Esta acción exige una justificación o motivo explícito/);

    // Verify nothing was recorded in audit_log
    const rows = await adminSql`
      SELECT id FROM public.audit_log
      WHERE organization_id = ${orgAlfa.id}::uuid AND action = 'dossier.override_risk'
    `;
    expect(rows.length).toBe(0);
  });

  it('Escenario: Aislamiento entre organizaciones sobre la bitácora (RLS)', async () => {
    const entryAlfa = await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'user',
      actorUserId: adminAlfaId,
      action: 'dossier.created',
      entity: 'dossier',
      entityId: 'dos-alpha-777',
    });

    // Query audit_log using Org Beta context via withTenantContext
    const visibleInBeta = await withTenantContext(
      { userId: adminBetaId, organizationId: orgBeta.id },
      async (tx) => {
        return tx.execute<{ id: string; organization_id: string }>(
          sql`SELECT id, organization_id FROM public.audit_log WHERE id = ${entryAlfa.id}::uuid`
        );
      },
    );
    expect(visibleInBeta.length).toBe(0);

    // Cross-tenant write attempt from Org Beta context into Org Alfa
    await expect(
      withTenantContext(
        { userId: adminBetaId, organizationId: orgBeta.id },
        async (tx) => {
          return tx.execute(
            sql`INSERT INTO public.audit_log (
              organization_id, actor_user_id, action, event_hash
            ) VALUES (
              ${orgAlfa.id}::uuid, ${adminBetaId}::uuid, 'unauthorized_cross_tenant_audit', 'fake_hash'
            )`
          );
        },
      )
    ).rejects.toThrow();
  });

  it('Escenario: Reconstruir la historia de una fila', async () => {
    const entityType = 'dossier';
    const entityId = 'dossier-trace-001';

    // Step 1: Created
    await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'user',
      actorUserId: adminAlfaId,
      action: 'dossier.created',
      entity: entityType,
      entityId,
      previousValue: null,
      newValue: { state: 'draft', riskLevel: null },
      requestOrigin: { ipAddress: '190.1.1.1' },
    });

    // Step 2: Risk evaluated
    await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'system',
      action: 'dossier.risk_evaluated',
      entity: entityType,
      entityId,
      previousValue: { state: 'draft', riskLevel: null },
      newValue: { state: 'under_review', riskLevel: 'medium' },
      automatic: true,
    });

    // Step 3: Approved with justification
    await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'user',
      actorUserId: adminAlfaId,
      action: 'dossier.approved',
      entity: entityType,
      entityId,
      previousValue: { state: 'under_review', riskLevel: 'medium' },
      newValue: { state: 'approved', riskLevel: 'medium' },
      reason: 'Cumple requisitos documentales y listas restrictivas limpias',
    });

    const history = await getEntityAuditHistory(orgAlfa.id, entityType, entityId);
    expect(history.length).toBe(3);
    expect(history[0].action).toBe('dossier.created');
    expect(history[1].action).toBe('dossier.risk_evaluated');
    expect(history[2].action).toBe('dossier.approved');
    expect(history[2].reason).toBe('Cumple requisitos documentales y listas restrictivas limpias');
  });

  it('Escenario: El registro sobrevive a la baja del usuario', async () => {
    // Analyst user
    const analystId = await createTestAuthUser('analyst-to-revoke@test-hu006.com', 'Analyst To Revoke');
    const membership = await grantMembership(adminAlfaId, {
      organizationId: orgAlfa.id,
      userId: analystId,
      role: 'compliance_analyst',
    });

    // Analyst performs an action
    await logAuditEvent({
      organizationId: orgAlfa.id,
      actorType: 'user',
      actorUserId: analystId,
      action: 'document.reviewed',
      entity: 'document',
      entityId: 'doc-rut-009',
    });

    // Admin revokes membership of analyst
    await revokeMembership(adminAlfaId, {
      organizationId: orgAlfa.id,
      membershipId: membership.id,
    });

    // Verify past action still exists intact attributing the revoked analyst
    const analystActions = await adminSql`
      SELECT * FROM public.audit_log
      WHERE organization_id = ${orgAlfa.id}::uuid
        AND actor_user_id = ${analystId}::uuid
        AND action = 'document.reviewed'
    `;
    expect(analystActions.length).toBe(1);
    expect(analystActions[0].actor_user_id).toBe(analystId);

    // Verify revocation itself exists in audit_log
    const revocationAudit = await adminSql`
      SELECT * FROM public.audit_log
      WHERE organization_id = ${orgAlfa.id}::uuid
        AND action = 'membership.revoked'
    `;
    expect(revocationAudit.length).toBeGreaterThan(0);
  });
});
