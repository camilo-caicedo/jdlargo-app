import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin } from './use-cases';
import {
  inviteMember,
  revokeInvitation,
  listPendingInvitations,
} from './invitations';
import { seedBaseConfiguration } from '../auth/role-config';
import { mockSentEmails } from '../notifications/email';

const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

const TEST_ORG_NAMES = ['Org Test Invitations A', 'Org Test Invitations B'];

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

async function cleanupTestData() {
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%test-hu056%')
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%test-hu056%')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.invitations
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR invited_by IN (SELECT id FROM auth.users WHERE email LIKE '%test-hu056%')
  `;
  await adminSql`
    DELETE FROM public.role_permissions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.roles
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.requirements
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.counterparty_types
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.privacy_notices
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.configuration_versions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  // Ensure audit_log is wiped for those orgs completely before deleting organizations
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.organizations
    WHERE name IN ${adminSql(TEST_ORG_NAMES)}
  `;
  await adminSql`DELETE FROM public.users WHERE email LIKE '%test-hu056%'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%test-hu056%'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-056: Invitar miembros a la organización', () => {
  let adminUserId: string;
  let unauthorizedUserId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    await cleanupTestData();

    adminUserId = await createTestAuthUser('admin@test-hu056.com', 'Admin Org A');
    unauthorizedUserId = await createTestAuthUser('unauthorized@test-hu056.com', 'User Sin Permiso');

    // Org A with adminUserId as admin
    const orgA = await createOrganizationWithAdmin(
      adminUserId,
      { name: TEST_ORG_NAMES[0], taxId: '900111000-1' },
    );
    orgAId = orgA.id;
    await seedBaseConfiguration(orgAId, adminUserId);

    // Org B
    const orgB = await createOrganizationWithAdmin(
      unauthorizedUserId,
      { name: TEST_ORG_NAMES[1], taxId: '900222000-2' },
    );
    orgBId = orgB.id;
    await seedBaseConfiguration(orgBId, unauthorizedUserId);
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('Escenario: Invitar a una persona nueva en la plataforma con memberships:manage', async () => {
    mockSentEmails.length = 0;

    const invitation = await inviteMember({
      callerUserId: adminUserId,
      organizationId: orgAId,
      email: 'nueva@test-hu056.com',
      role: 'compliance_analyst',
    });

    expect(invitation).toBeDefined();
    expect(invitation.email).toBe('nueva@test-hu056.com');
    expect(invitation.role).toBe('compliance_analyst');
    expect(invitation.state).toBe('pending');
    expect(invitation.organizationId).toBe(orgAId);

    // Email mock verified
    const sent = mockSentEmails.find((e) => e.to === 'nueva@test-hu056.com');
    expect(sent).toBeDefined();
    expect(sent?.type).toBe('invitation');

    // Appears in pending invitations list
    const pendingList = await listPendingInvitations(adminUserId, orgAId);
    expect(pendingList.some((i) => i.id === invitation.id)).toBe(true);
  });

  it('Escenario: Invitar exige el permiso correspondiente', async () => {
    // User unauthorizedUserId is not member of Org A and has no memberships:manage on Org A
    await expect(
      inviteMember({
        callerUserId: unauthorizedUserId,
        organizationId: orgAId,
        email: 'attacker@test-hu056.com',
        role: 'compliance_analyst',
      }),
    ).rejects.toThrow();
  });

  it('Escenario: Reenviar una invitación invalida la anterior (reemplaza)', async () => {
    const firstInvitation = await inviteMember({
      callerUserId: adminUserId,
      organizationId: orgAId,
      email: 'reemplazo@test-hu056.com',
      role: 'compliance_analyst',
    });

    expect(firstInvitation.state).toBe('pending');

    const secondInvitation = await inviteMember({
      callerUserId: adminUserId,
      organizationId: orgAId,
      email: 'reemplazo@test-hu056.com',
      role: 'compliance_analyst',
    });

    expect(secondInvitation.id).not.toBe(firstInvitation.id);
    expect(secondInvitation.state).toBe('pending');

    // First invitation in DB is now replaced
    const [firstRow] = await adminSql`SELECT state FROM public.invitations WHERE id = ${firstInvitation.id}`;
    expect(firstRow.state).toBe('replaced');
  });

  it('Escenario: Revocar una invitación pendiente', async () => {
    const invToRevoke = await inviteMember({
      callerUserId: adminUserId,
      organizationId: orgAId,
      email: 'pararevocar@test-hu056.com',
      role: 'compliance_analyst',
    });

    await revokeInvitation(adminUserId, orgAId, invToRevoke.id);

    const [row] = await adminSql`SELECT state, revoked_by FROM public.invitations WHERE id = ${invToRevoke.id}`;
    expect(row.state).toBe('revoked');
    expect(row.revoked_by).toBe(adminUserId);
  });

  it('Inmutabilidad: Trigger rechaza DELETE y UPDATEs indebidos sobre invitations', async () => {
    const inv = await inviteMember({
      callerUserId: adminUserId,
      organizationId: orgAId,
      email: 'inmutable@test-hu056.com',
      role: 'compliance_analyst',
    });

    // 1. DELETE debe ser rechazado por trigger
    await expect(
      adminSql`DELETE FROM public.invitations WHERE id = ${inv.id}`,
    ).rejects.toThrow(/invitations are permanent records/);

    // 2. Modificar email o columnas no autorizadas debe ser rechazado
    await expect(
      adminSql`UPDATE public.invitations SET state = 'revoked', revoked_at = now(), revoked_by = ${adminUserId}, email = 'hack@test.com' WHERE id = ${inv.id}`,
    ).rejects.toThrow(/Cannot modify core invitation fields/);

    // 3. Transición a revoked sin revoked_at/revoked_by debe ser rechazada por el trigger
    await expect(
      adminSql`UPDATE public.invitations SET state = 'revoked' WHERE id = ${inv.id}`,
    ).rejects.toThrow(/Transition to revoked requires revoked_by and revoked_at/);

    // 4. Transición a accepted con campos de revocación debe ser rechazada
    await expect(
      adminSql`UPDATE public.invitations SET state = 'accepted', accepted_at = now(), revoked_by = ${adminUserId} WHERE id = ${inv.id}`,
    ).rejects.toThrow(/Transition to accepted cannot set revocation fields/);
  });
});