import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '../db/client';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import type { Organization } from '../organizations/types';
import {
  recordAiExecution,
  getAiExecutionById,
  getAiExecutionsByDossier,
  type RecordAiExecutionInput,
} from './execution';

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
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu018.com')
  `;
  await adminSql`
    DELETE FROM public.ai_executions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.documents
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossier_transitions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossiers
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.parties
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu018.com')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
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
  await adminSql`
    DELETE FROM public.organizations
    WHERE name IN ${adminSql(TEST_ORG_NAMES)}
  `;
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu018.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu018.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-018: Registro de cada ejecución de IA', () => {
  let orgAlfa: Organization;
  let orgBeta: Organization;
  let adminAlfaId: string;
  let adminBetaId: string;
  let dossierAlfaId: string;
  let dossierBetaId: string;
  let documentAlfaId: string;

  beforeAll(async () => {
    await cleanupTestData();

    adminAlfaId = await createTestAuthUser('adminAlfa@test-hu018.com', 'Admin Alfa');
    orgAlfa = await createOrganizationWithAdmin(adminAlfaId, { name: 'Alfa Ficticia S.A.S.' });
    await seedBaseConfiguration(orgAlfa.id, adminAlfaId);

    adminBetaId = await createTestAuthUser('adminBeta@test-hu018.com', 'Admin Beta');
    orgBeta = await createOrganizationWithAdmin(adminBetaId, { name: 'Beta Ficticia S.A.S.' });
    await seedBaseConfiguration(orgBeta.id, adminBetaId);

    // Create dossiers in both orgs
    const [dossierAlfa] = await adminSql<{ id: string }[]>`
      INSERT INTO public.dossiers (organization_id, state, configuration_version_id)
      VALUES (
        ${orgAlfa.id},
        'en_diligenciamiento',
        (SELECT id FROM public.configuration_versions WHERE organization_id = ${orgAlfa.id} LIMIT 1)
      )
      RETURNING id
    `;
    dossierAlfaId = dossierAlfa.id;

    const [dossierBeta] = await adminSql<{ id: string }[]>`
      INSERT INTO public.dossiers (organization_id, state, configuration_version_id)
      VALUES (
        ${orgBeta.id},
        'en_diligenciamiento',
        (SELECT id FROM public.configuration_versions WHERE organization_id = ${orgBeta.id} LIMIT 1)
      )
      RETURNING id
    `;
    dossierBetaId = dossierBeta.id;

    // Create a document in Alfa
    const [docAlfa] = await adminSql<{ id: string }[]>`
      INSERT INTO public.documents (
        organization_id, dossier_id, document_type, version, storage_path,
        hash, size, format, state, uploaded_by_type, uploaded_by_user_id
      ) VALUES (
        ${orgAlfa.id},
        ${dossierAlfaId},
        'rut',
        1,
        ${'org/' + orgAlfa.id + '/doc.pdf'},
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        1024,
        'pdf',
        'received',
        'user',
        ${adminAlfaId}
      )
      RETURNING id
    `;
    documentAlfaId = docAlfa.id;
  }, 40000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 40000);

  it('Escenario: Registrar una ejecución completa exitosa con documento, confianza y destino de datos', async () => {
    const input: RecordAiExecutionInput = {
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      provider: 'openai',
      model: 'gpt-4o-mini',
      modelVersion: '2024-07-18',
      instructionTemplateId: 'extract_rut_fields',
      instructionTemplateVersion: 'v1.0.0',
      dataDestination: 'US-East',
      sentFragmentHash: 'abc123hashfragment',
      sentFragmentReference: 'storage/snippets/snippet-1.txt',
      status: 'succeeded',
      result: { nit: '900123456-1', companyName: 'Acme Corp' },
      confidence: '0.98',
    };

    const execution = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => recordAiExecution(input, tx),
    );

    expect(execution.id).toBeDefined();
    expect(execution.status).toBe('succeeded');
    expect(execution.result).toEqual({ nit: '900123456-1', companyName: 'Acme Corp' });
    expect(execution.confidence).toBe('0.98');
    expect(execution.dataDestination).toBe('US-East');
    expect(execution.documentId).toBe(documentAlfaId);
    expect(execution.occurredAt).toBeInstanceOf(Date);
    expect(execution.validatedBy).toBeNull();
    expect(execution.validatedAt).toBeNull();
    expect(execution.finalResult).toBeNull();

    // Verify retrieval by ID
    const retrieved = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => getAiExecutionById(orgAlfa.id, execution.id, tx),
    );
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(execution.id);
    expect(retrieved?.provider).toBe('openai');
    expect(retrieved?.sentFragmentHash).toBe('abc123hashfragment');
  });

  it('Escenario: Una ejecución fallida también se registra con su causa y momento sin afirmación derivada', async () => {
    const input: RecordAiExecutionInput = {
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      documentId: documentAlfaId,
      provider: 'anthropic',
      model: 'claude-3-5-haiku',
      modelVersion: '2024-10-22',
      instructionTemplateId: 'extract_chamber_commerce',
      instructionTemplateVersion: 'v1.0.0',
      dataDestination: 'US-West',
      sentFragmentHash: 'failedhashfragment456',
      status: 'failed',
      failureReason: 'Provider timeout: 504 Gateway Timeout after 30s',
    };

    const execution = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => recordAiExecution(input, tx),
    );

    expect(execution.id).toBeDefined();
    expect(execution.status).toBe('failed');
    expect(execution.failureReason).toBe('Provider timeout: 504 Gateway Timeout after 30s');
    expect(execution.result).toBeUndefined();
    expect(execution.confidence).toBeUndefined();
    expect(execution.occurredAt).toBeInstanceOf(Date);

    // Verify assertions count for this execution is zero (no derived assertions created)
    const assertions = await adminSql`
      SELECT count(*)::int as count FROM public.assertions
      WHERE organization_id = ${orgAlfa.id}
    `;
    expect(assertions[0].count).toBe(0);
  });

  it('Rechaza inputs inválidos (succeeded sin result o confidence, failed sin failureReason o con result)', async () => {
    // succeeded missing confidence
    await expect(
      recordAiExecution({
        organizationId: orgAlfa.id,
        dossierId: dossierAlfaId,
        provider: 'openai',
        model: 'gpt-4o',
        modelVersion: '1',
        instructionTemplateId: 't1',
        instructionTemplateVersion: 'v1',
        dataDestination: 'US',
        sentFragmentHash: 'h1',
        status: 'succeeded',
        result: { foo: 'bar' },
      }),
    ).rejects.toThrow("confidence is required when status is 'succeeded'");

    // succeeded missing result
    await expect(
      recordAiExecution({
        organizationId: orgAlfa.id,
        dossierId: dossierAlfaId,
        provider: 'openai',
        model: 'gpt-4o',
        modelVersion: '1',
        instructionTemplateId: 't1',
        instructionTemplateVersion: 'v1',
        dataDestination: 'US',
        sentFragmentHash: 'h1',
        status: 'succeeded',
        confidence: '0.9',
      }),
    ).rejects.toThrow("result is required when status is 'succeeded'");

    // failed missing failureReason
    await expect(
      recordAiExecution({
        organizationId: orgAlfa.id,
        dossierId: dossierAlfaId,
        provider: 'openai',
        model: 'gpt-4o',
        modelVersion: '1',
        instructionTemplateId: 't1',
        instructionTemplateVersion: 'v1',
        dataDestination: 'US',
        sentFragmentHash: 'h1',
        status: 'failed',
      }),
    ).rejects.toThrow("failureReason is required when status is 'failed'");

    // failed with result provided
    await expect(
      recordAiExecution({
        organizationId: orgAlfa.id,
        dossierId: dossierAlfaId,
        provider: 'openai',
        model: 'gpt-4o',
        modelVersion: '1',
        instructionTemplateId: 't1',
        instructionTemplateVersion: 'v1',
        dataDestination: 'US',
        sentFragmentHash: 'h1',
        status: 'failed',
        failureReason: 'timeout',
        result: { unwanted: true },
      }),
    ).rejects.toThrow("result must not be provided when status is 'failed'");
  });

  it('Escenario: El registro es inmutable ante DELETE en la base de datos', async () => {
    const input: RecordAiExecutionInput = {
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      provider: 'openai',
      model: 'gpt-4o',
      modelVersion: '1',
      instructionTemplateId: 't1',
      instructionTemplateVersion: 'v1',
      dataDestination: 'US',
      sentFragmentHash: 'h_immutability_test',
      status: 'succeeded',
      result: { ok: true },
      confidence: '0.95',
    };

    const execution = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => recordAiExecution(input, tx),
    );

    // Try deleting via authenticated tenant context -> rejected by trigger or RLS
    await expect(
      withTenantContext(
        { userId: adminAlfaId, organizationId: orgAlfa.id },
        async (tx) => {
          await tx.execute(sql`DELETE FROM public.ai_executions WHERE id = ${execution.id}`);
        },
      ),
    ).rejects.toThrow();

    // Try deleting directly with adminSql without allow_config_cleanup -> rejected by database trigger
    await expect(
      adminSql`DELETE FROM public.ai_executions WHERE id = ${execution.id}::uuid`,
    ).rejects.toThrow(/ai_executions are immutable: deleting an AI execution record is strictly forbidden/);

    // Record still exists intact
    const row = await getAiExecutionById(orgAlfa.id, execution.id);
    expect(row).not.toBeNull();
    expect(row?.id).toBe(execution.id);
  });

  it('Escenario: Modificar columnas núcleo en UPDATE es rechazado por el trigger de la base de datos', async () => {
    const input: RecordAiExecutionInput = {
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      provider: 'openai',
      model: 'gpt-4o',
      modelVersion: '1',
      instructionTemplateId: 't1',
      instructionTemplateVersion: 'v1',
      dataDestination: 'US',
      sentFragmentHash: 'h_tamper_core',
      status: 'succeeded',
      result: { original: 'value' },
      confidence: '0.90',
    };

    const execution = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => recordAiExecution(input, tx),
    );

    // Attempt to modify provider
    await expect(
      adminSql`UPDATE public.ai_executions SET provider = 'hacked' WHERE id = ${execution.id}::uuid`,
    ).rejects.toThrow(/Cannot modify AI execution core fields/);

    // Attempt to modify model
    await expect(
      adminSql`UPDATE public.ai_executions SET model = 'gpt-5' WHERE id = ${execution.id}::uuid`,
    ).rejects.toThrow(/Cannot modify AI execution core fields/);

    // Attempt to modify result
    await expect(
      adminSql`UPDATE public.ai_executions SET result = '{"tampered":true}'::jsonb WHERE id = ${execution.id}::uuid`,
    ).rejects.toThrow(/Cannot modify AI execution core fields/);

    // Attempt to modify confidence
    await expect(
      adminSql`UPDATE public.ai_executions SET confidence = '1.00' WHERE id = ${execution.id}::uuid`,
    ).rejects.toThrow(/Cannot modify AI execution core fields/);

    // Attempt to modify sentFragmentHash
    await expect(
      adminSql`UPDATE public.ai_executions SET sent_fragment_hash = 'tampered' WHERE id = ${execution.id}::uuid`,
    ).rejects.toThrow(/Cannot modify AI execution core fields/);

    // Also attempt via tenant context (verifying rejection reaches tenant transactions)
    await expect(
      withTenantContext(
        { userId: adminAlfaId, organizationId: orgAlfa.id },
        async (tx) => {
          await tx.execute(sql`UPDATE public.ai_executions SET provider = 'hacked' WHERE id = ${execution.id}`);
        },
      ),
    ).rejects.toThrow();
  });

  it('Escenario: Registrar quién validó el resultado permite UPDATE únicamente sobre validated_by, validated_at, final_result', async () => {
    const input: RecordAiExecutionInput = {
      organizationId: orgAlfa.id,
      dossierId: dossierAlfaId,
      provider: 'openai',
      model: 'gpt-4o',
      modelVersion: '1',
      instructionTemplateId: 't1',
      instructionTemplateVersion: 'v1',
      dataDestination: 'US',
      sentFragmentHash: 'h_human_val',
      status: 'succeeded',
      result: { nit: '900123456-1' },
      confidence: '0.85',
    };

    const execution = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => recordAiExecution(input, tx),
    );

    // Human validation update (HU-020 preview) should be permitted by the trigger
    const validationDate = new Date();
    await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => {
        await tx.execute(
          sql`UPDATE public.ai_executions
              SET validated_by = ${adminAlfaId},
                  validated_at = ${validationDate.toISOString()},
                  final_result = '{"nit":"900123456-1","verified":true}'::jsonb
              WHERE id = ${execution.id}`
        );
      },
    );

    const updated = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => getAiExecutionById(orgAlfa.id, execution.id, tx),
    );

    expect(updated?.validatedBy).toBe(adminAlfaId);
    expect(updated?.validatedAt).not.toBeNull();
    expect(updated?.finalResult).toEqual({ nit: '900123456-1', verified: true });
    // Original result remains intact
    expect(updated?.result).toEqual({ nit: '900123456-1' });
    expect(updated?.confidence).toBe('0.85');
  });

  it('Escenario: Aislamiento entre organizaciones sobre el registro de ejecuciones (RLS)', async () => {
    // Record execution for Alfa
    const execAlfa = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) =>
        recordAiExecution(
          {
            organizationId: orgAlfa.id,
            dossierId: dossierAlfaId,
            provider: 'openai',
            model: 'gpt-4o',
            modelVersion: '1',
            instructionTemplateId: 'alfa_t',
            instructionTemplateVersion: '1',
            dataDestination: 'US',
            sentFragmentHash: 'hash_alfa_only',
            status: 'succeeded',
            result: { org: 'Alfa' },
            confidence: '0.99',
          },
          tx,
        ),
    );

    // Record execution for Beta
    const execBeta = await withTenantContext(
      { userId: adminBetaId, organizationId: orgBeta.id },
      async (tx) =>
        recordAiExecution(
          {
            organizationId: orgBeta.id,
            dossierId: dossierBetaId,
            provider: 'anthropic',
            model: 'claude-3-5',
            modelVersion: '1',
            instructionTemplateId: 'beta_t',
            instructionTemplateVersion: '1',
            dataDestination: 'US',
            sentFragmentHash: 'hash_beta_only',
            status: 'succeeded',
            result: { org: 'Beta' },
            confidence: '0.99',
          },
          tx,
        ),
    );

    // Query as Alfa user: can see Alfa, cannot see Beta
    const alfaViewsAlfa = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => getAiExecutionById(orgAlfa.id, execAlfa.id, tx),
    );
    expect(alfaViewsAlfa).not.toBeNull();
    expect(alfaViewsAlfa?.id).toBe(execAlfa.id);

    // Alfa user querying Beta execution directly returns null (blocked by RLS & tenant check)
    const alfaViewsBeta = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => getAiExecutionById(orgBeta.id, execBeta.id, tx),
    );
    expect(alfaViewsBeta).toBeNull();

    // Query executions by dossier
    const alfaDossierExecs = await withTenantContext(
      { userId: adminAlfaId, organizationId: orgAlfa.id },
      async (tx) => getAiExecutionsByDossier(orgAlfa.id, dossierAlfaId, tx),
    );
    expect(alfaDossierExecs.some((e) => e.id === execAlfa.id)).toBe(true);
    expect(alfaDossierExecs.some((e) => e.id === execBeta.id)).toBe(false);

    // Beta user querying dossier of Alfa gets empty list
    const betaQueriesAlfaDossier = await withTenantContext(
      { userId: adminBetaId, organizationId: orgBeta.id },
      async (tx) => getAiExecutionsByDossier(orgAlfa.id, dossierAlfaId, tx),
    );
    expect(betaQueriesAlfaDossier).toHaveLength(0);
  });
});
