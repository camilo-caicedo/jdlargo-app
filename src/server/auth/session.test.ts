import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import {
  listActiveMembershipsForUser,
  createOrganizationWithAdmin,
  grantMembership,
} from '../organizations/use-cases';
import { resolvePostLoginDestination } from './session';

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

async function cleanupTestData() {
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`DELETE FROM public.audit_log WHERE actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu055.com')`;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.memberships WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu055.com')`;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.role_permissions WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ('Alfa Ficticia S.A.S.', 'Beta Ficticia S.A.S.'))`;
  await adminSql`DELETE FROM public.roles WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ('Alfa Ficticia S.A.S.', 'Beta Ficticia S.A.S.'))`;
  await adminSql`DELETE FROM public.configuration_versions WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ('Alfa Ficticia S.A.S.', 'Beta Ficticia S.A.S.'))`;
  await adminSql`DELETE FROM public.organizations WHERE name IN ('Alfa Ficticia S.A.S.', 'Beta Ficticia S.A.S.')`;
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu055.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu055.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-055: Auth Session & Membership Resolution', () => {
  let userNoOrgId: string;
  let userSingleOrgId: string;
  let userMultiOrgId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Create 3 test users
    userNoOrgId = await createTestAuthUser('user-no-org@test-hu055.com', 'Usuario Sin Org');
    userSingleOrgId = await createTestAuthUser('user-single-org@test-hu055.com', 'Usuario Una Org');
    userMultiOrgId = await createTestAuthUser('user-multi-org@test-hu055.com', 'Usuario Multi Org');

    // 2. Create organization A where userSingleOrgId is admin
    const orgA = await createOrganizationWithAdmin(
      userSingleOrgId,
      {
        name: 'Alfa Ficticia S.A.S.',
        taxId: '900111222-1',
      },
    );
    orgAId = orgA.id;

    // 3. Create organization B where userMultiOrgId is admin
    const orgB = await createOrganizationWithAdmin(
      userMultiOrgId,
      {
        name: 'Beta Ficticia S.A.S.',
        taxId: '900333444-2',
      },
    );
    orgBId = orgB.id;

    // 4. Grant userMultiOrgId membership in org A as well
    await grantMembership(userSingleOrgId, {
      organizationId: orgAId,
      userId: userMultiOrgId,
      role: 'compliance_analyst',
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('listActiveMembershipsForUser returns empty array when user has no memberships', async () => {
    const memberships = await listActiveMembershipsForUser(userNoOrgId);
    expect(memberships).toEqual([]);
  });

  it('resolvePostLoginDestination returns no_access when user has no active memberships', async () => {
    const destination = await resolvePostLoginDestination(userNoOrgId);
    expect(destination).toEqual({ kind: 'no_access' });
  });

  it('listActiveMembershipsForUser returns exactly 1 organization for single org user', async () => {
    const memberships = await listActiveMembershipsForUser(userSingleOrgId);
    expect(memberships.length).toBe(1);
    expect(memberships[0].organizationId).toBe(orgAId);
    expect(memberships[0].organizationName).toBe('Alfa Ficticia S.A.S.');
  });

  it('resolvePostLoginDestination returns single_org with organizationId for single org user', async () => {
    const destination = await resolvePostLoginDestination(userSingleOrgId);
    expect(destination).toEqual({
      kind: 'single_org',
      organizationId: orgAId,
    });
  });

  it('listActiveMembershipsForUser returns multiple organizations for multi-org user', async () => {
    const memberships = await listActiveMembershipsForUser(userMultiOrgId);
    expect(memberships.length).toBe(2);
    const orgIds = memberships.map((m) => m.organizationId);
    expect(orgIds).toContain(orgAId);
    expect(orgIds).toContain(orgBId);
  });

  it('resolvePostLoginDestination returns select_org for multi-org user', async () => {
    const destination = await resolvePostLoginDestination(userMultiOrgId);
    expect(destination).toEqual({ kind: 'select_org' });
  });
});