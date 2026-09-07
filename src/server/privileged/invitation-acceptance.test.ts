import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import {
  resolveInvitation,
  acceptInvitationAsNewUser,
  acceptInvitationForExistingUser,
} from './invitation-acceptance';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import crypto from 'crypto';

const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

const TEST_ORG_NAMES = ['Org Test Acceptance Privileged'];

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

describe('HU-056: Aceptación de invitaciones en capa privilegiada', () => {
  let adminUserId: string;
  let orgId: string;
  const createdNewUserIds: string[] = [];

  beforeAll(async () => {
    await cleanupTestData();

    adminUserId = await createTestAuthUser('admin@test-hu056-acc.com', 'Admin Privileged Acc');
    const org = await createOrganizationWithAdmin(
      adminUserId,
      { name: TEST_ORG_NAMES[0], taxId: '900333000-3' },
    );
    orgId = org.id;
    await seedBaseConfiguration(orgId, adminUserId);
  }, 30000);

  afterAll(async () => {
    const supabaseAdmin = createSupabaseAdminClient();
    for (const uid of createdNewUserIds) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(uid);
      } catch {}
    }
    await cleanupTestData();
    await adminSql.end();
  });

  it('Escenario: resolveInvitation valida tokens válidos, expirados, revocados e inexistentes', async () => {
    // 1. Inexistente
    const notFoundRes = await resolveInvitation('token_que_no_existe_1234567890');
    expect(notFoundRes.outcome).toBe('invalid');
    expect(notFoundRes.reason).toBe('not_found');

    // 2. Crear invitación válida en DB
    const rawValidToken = 'valid_raw_token_12345678901234567890123456789012';
    const validHash = crypto.createHash('sha256').update(rawValidToken).digest('hex');
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    await adminSql`
      INSERT INTO public.invitations (
        organization_id, email, role, token_hash, expires_at, state, invited_by
      ) VALUES (
        ${orgId}, 'valid@test-hu056-acc.com', 'compliance_analyst', ${validHash}, ${futureDate}, 'pending', ${adminUserId}
      )
    `;

    const validRes = await resolveInvitation(rawValidToken);
    expect(validRes.outcome).toBe('valid');
    expect(validRes.email).toBe('valid@test-hu056-acc.com');
    expect(validRes.role).toBe('compliance_analyst');
    expect(validRes.accountExists).toBe(false);

    // 3. Expirado
    const rawExpiredToken = 'expired_raw_token_12345678901234567890123456789012';
    const expiredHash = crypto.createHash('sha256').update(rawExpiredToken).digest('hex');
    const pastDate = new Date(Date.now() - 1000);

    await adminSql`
      INSERT INTO public.invitations (
        organization_id, email, role, token_hash, expires_at, state, invited_by
      ) VALUES (
        ${orgId}, 'expired@test-hu056-acc.com', 'auditor', ${expiredHash}, ${pastDate}, 'pending', ${adminUserId}
      )
    `;

    const expiredRes = await resolveInvitation(rawExpiredToken);
    expect(expiredRes.outcome).toBe('invalid');
    expect(expiredRes.reason).toBe('expired');

    // 4. Revocado
    const rawRevokedToken = 'revoked_raw_token_12345678901234567890123456789012';
    const revokedHash = crypto.createHash('sha256').update(rawRevokedToken).digest('hex');

    await adminSql`
      INSERT INTO public.invitations (
        organization_id, email, role, token_hash, expires_at, state, invited_by
      ) VALUES (
        ${orgId}, 'revoked@test-hu056-acc.com', 'compliance_analyst', ${revokedHash}, ${futureDate}, 'revoked', ${adminUserId}
      )
    `;

    const revokedRes = await resolveInvitation(rawRevokedToken);
    expect(revokedRes.outcome).toBe('invalid');
    expect(revokedRes.reason).toBe('revoked');
  });

  it('Escenario: acceptInvitationForExistingUser vincula membresía y pasa estado a accepted', async () => {
    const existingUserId = await createTestAuthUser('existing@test-hu056-acc.com', 'Existing Member');
    await adminSql`
      INSERT INTO public.users (id, email, name)
      VALUES (${existingUserId}, 'existing@test-hu056-acc.com', 'Existing Member')
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
    `;

    const rawToken = 'existing_token_12345678901234567890123456789012';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    await adminSql`
      INSERT INTO public.invitations (
        organization_id, email, role, token_hash, expires_at, state, invited_by
      ) VALUES (
        ${orgId}, 'existing@test-hu056-acc.com', 'reviewer', ${tokenHash}, ${futureDate}, 'pending', ${adminUserId}
      )
    `;

    await expect(
      acceptInvitationForExistingUser(rawToken, adminUserId),
    ).rejects.toThrow(/La sesión activa no coincide con el correo electrónico de esta invitación/);

    await acceptInvitationForExistingUser(rawToken, existingUserId);

    const [membership] = await adminSql`
      SELECT role, status FROM public.memberships
      WHERE organization_id = ${orgId} AND user_id = ${existingUserId}
    `;
    expect(membership.role).toBe('reviewer');
    expect(membership.status).toBe('active');

    const [invitationRow] = await adminSql`
      SELECT state, accepted_at FROM public.invitations
      WHERE token_hash = ${tokenHash}
    `;
    expect(invitationRow.state).toBe('accepted');
    expect(invitationRow.accepted_at).not.toBeNull();
  });

  it('Escenario: acceptInvitationAsNewUser crea usuario real en Supabase Auth, vincula membresía y pasa estado a accepted', async () => {
    const rawNewUserToken = 'new_user_raw_token_12345678901234567890123456789012';
    const newUserTokenHash = crypto.createHash('sha256').update(rawNewUserToken).digest('hex');
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const newUserEmail = 'nuevo-usuario@test-hu056-acc.com';

    await adminSql`
      INSERT INTO public.invitations (
        organization_id, email, role, token_hash, expires_at, state, invited_by
      ) VALUES (
        ${orgId}, ${newUserEmail}, 'operations_user', ${newUserTokenHash}, ${futureDate}, 'pending', ${adminUserId}
      )
    `;

    const result = await acceptInvitationAsNewUser(rawNewUserToken, {
      fullName: 'Nuevo Usuario Prueba',
      password: 'PasswordSegura123!',
    });

    expect(result.userId).toBeDefined();
    createdNewUserIds.push(result.userId);

    // 1. Validar que la membresía activa quedó creada
    const [membership] = await adminSql`
      SELECT role, status FROM public.memberships
      WHERE organization_id = ${orgId} AND user_id = ${result.userId}
    `;
    expect(membership).toBeDefined();
    expect(membership.role).toBe('operations_user');
    expect(membership.status).toBe('active');

    // 2. Validar que la invitación pasó a 'accepted' con accepted_at
    const [invitationRow] = await adminSql`
      SELECT state, accepted_at FROM public.invitations
      WHERE token_hash = ${newUserTokenHash}
    `;
    expect(invitationRow.state).toBe('accepted');
    expect(invitationRow.accepted_at).not.toBeNull();

    // 3. Validar que el usuario existe en public.users con el nombre provisto
    const [userRow] = await adminSql`
      SELECT name, email FROM public.users WHERE id = ${result.userId}
    `;
    expect(userRow).toBeDefined();
    expect(userRow.name).toBe('Nuevo Usuario Prueba');
    expect(userRow.email).toBe(newUserEmail);

    // 4. Intento de re-aceptar debe ser rechazado
    await expect(
      acceptInvitationAsNewUser(rawNewUserToken, {
        fullName: 'Otro Intento',
        password: 'PasswordSegura123!',
      }),
    ).rejects.toThrow();
  });
});
