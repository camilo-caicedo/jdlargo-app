import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '../db/client';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration, getActiveConfigurationVersion } from '../auth/role-config';
import type { Organization } from '../organizations/types';
import {
  registerAssertion,
  getAssertionsForField,
  resolveDiscrepancy,
  getLatestDeclaredValuesForDossier,
  type AssertionOrigin,
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
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu005.com')
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossier_transitions
    WHERE dossier_id IN (
      SELECT id FROM public.dossiers
      WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
    )
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
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu005.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu005.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu005.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-005: Registro de afirmaciones con procedencia', () => {
  let orgAlfa: Organization;
  let orgBeta: Organization;
  let adminAlfaId: string;
  let adminBetaId: string;
  let configurationVersionId: string;
  let dossierId: string;
  let partyId: string;

  beforeAll(async () => {
    await cleanupTestData();

    adminAlfaId = await createTestAuthUser('adminAlfa@test-hu005.com', 'Admin Alfa');
    orgAlfa = await createOrganizationWithAdmin(adminAlfaId, { name: 'Alfa Ficticia S.A.S.' });
    await seedBaseConfiguration(orgAlfa.id, adminAlfaId);
    const activeVer = await getActiveConfigurationVersion(orgAlfa.id);
    configurationVersionId = activeVer!.id;

    adminBetaId = await createTestAuthUser('adminBeta@test-hu005.com', 'Admin Beta');
    orgBeta = await createOrganizationWithAdmin(adminBetaId, { name: 'Beta Ficticia S.A.S.' });
    await seedBaseConfiguration(orgBeta.id, adminBetaId);

    // Create party and dossier for Alfa to satisfy real FK constraints
    const partyRes = await adminSql<{ id: string }[]>`
      INSERT INTO public.parties (organization_id, identification_type, identification_number)
      VALUES (${orgAlfa.id}, 'NIT', '900123456-1')
      RETURNING id
    `;
    partyId = partyRes[0].id;

    const dossierRes = await adminSql<{ id: string }[]>`
      INSERT INTO public.dossiers (organization_id, state, configuration_version_id, party_id)
      VALUES (${orgAlfa.id}, 'borrador', ${configurationVersionId}, ${partyId})
      RETURNING id
    `;
    dossierId = dossierRes[0].id;
  }, 30000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 30000);

  it('Escenario: Registrar una afirmación declarada por la contraparte', async () => {
    const assertion = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: 'razon_social',
      value: 'Ficticia S.A.S.',
      origin: 'declared',
      producedBy: adminAlfaId,
    });

    expect(assertion.id).toBeDefined();
    expect(assertion.field).toBe('razon_social');
    expect(assertion.value).toBe('Ficticia S.A.S.');
    expect(assertion.origin).toBe('declared');
    expect(assertion.producedBy).toBe(adminAlfaId);
    expect(assertion.producedAt).toBeDefined();
    expect(assertion.status).toBe('active');

    // Verify audit log registration
    const auditRows = await adminSql`
      SELECT * FROM public.audit_log
      WHERE organization_id = ${orgAlfa.id}::uuid AND action = 'assertion.registered'
    `;
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].metadata.field).toBe('razon_social');
    expect(auditRows[0].metadata.origin).toBe('declared');
  });

  it('Escenario: Una afirmación nunca se sobrescribe (inmutabilidad por trigger)', async () => {
    const assertion = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: 'direccion',
      value: 'Calle 100 # 10-20',
      origin: 'declared',
      producedBy: adminAlfaId,
    });

    // Attempting direct UPDATE on value
    await expect(
      adminSql`
        UPDATE public.assertions
        SET value = '"Calle 123 Modificada"'::jsonb
        WHERE id = ${assertion.id}::uuid
      `
    ).rejects.toThrow(/Cannot modify assertion provenance or value: assertions are append-only/);

    // Attempting direct UPDATE on origin
    await expect(
      adminSql`
        UPDATE public.assertions
        SET origin = 'verified'
        WHERE id = ${assertion.id}::uuid
      `
    ).rejects.toThrow(/Cannot modify assertion provenance or value: assertions are append-only/);

    // Attempting direct DELETE
    await expect(
      adminSql`
        DELETE FROM public.assertions
        WHERE id = ${assertion.id}::uuid
      `
    ).rejects.toThrow(/Assertions are immutable: deleting an assertion is strictly forbidden/);

    // Verify original assertion remains completely intact
    const rows = await adminSql`
      SELECT value, origin FROM public.assertions WHERE id = ${assertion.id}::uuid
    `;
    expect(rows[0].value).toBe('Calle 100 # 10-20');
    expect(rows[0].origin).toBe('declared');
  });

  it('Escenario: Un dato nuevo se añade, no reemplaza (convivencia y discrepancia)', async () => {
    const fieldName = 'telefono';

    // First assertion: declared
    const a1 = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: fieldName,
      value: '3001234567',
      origin: 'declared',
      producedBy: adminAlfaId,
    });

    // Second assertion: verified with independent external source
    const a2 = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: fieldName,
      value: '3007654321',
      origin: 'verified',
      producedBy: adminAlfaId,
      evidenceId: 'doc_cert_camara_comercio_001',
    });

    // Both assertions must exist simultaneously
    const list = await getAssertionsForField(orgAlfa.id, dossierId, fieldName);
    expect(list.length).toBe(2);

    const ids = list.map((a) => a.id);
    expect(ids).toContain(a1.id);
    expect(ids).toContain(a2.id);

    // Both keep their own origin, author, and are active
    expect(list.find((a) => a.id === a1.id)?.origin).toBe('declared');
    expect(list.find((a) => a.id === a2.id)?.origin).toBe('verified');
    expect(list.find((a) => a.id === a1.id)?.status).toBe('active');
    expect(list.find((a) => a.id === a2.id)?.status).toBe('active');
  });

  it('Escenario: No se puede registrar una afirmación sin origen', async () => {
    // Attempt missing origin
    await expect(
      registerAssertion({
        organizationId: orgAlfa.id,
        dossierId,
        partyId,
        configurationVersionId,
        field: 'ciudad',
        value: 'Bogota',
        origin: '' as AssertionOrigin,
        producedBy: adminAlfaId,
      })
    ).rejects.toThrow(/No se puede registrar una afirmación sin origen/);

    // Attempt missing evidence on verified origin
    await expect(
      registerAssertion({
        organizationId: orgAlfa.id,
        dossierId,
        partyId,
        configurationVersionId,
        field: 'ciudad',
        value: 'Medellin',
        origin: 'verified',
        producedBy: adminAlfaId,
        // missing evidenceId
      })
    ).rejects.toThrow(/Una afirmación verificada solo puede crearse citando la fuente externa/);
  });

  it('Escenario: Lo extraído por la IA no asciende solo a verificado', async () => {
    // Register extracted assertion with confidence and AI model metadata
    const extracted = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: 'beneficiario_final',
      value: 'Juan Perez (55%)',
      origin: 'extracted',
      confidence: '0.92',
      evidenceId: 'doc_camara_comercio_extract.pdf',
      aiModelMetadata: {
        model: 'gemini-1.5-pro',
        provider: 'google',
        promptTemplate: 'extract_ubo_v1',
      },
      producedBy: adminAlfaId,
    });

    expect(extracted.origin).toBe('extracted');
    expect(extracted.confidence).toBe('0.92');
    expect(extracted.aiModelMetadata?.model).toBe('gemini-1.5-pro');

    // Attempting to change origin directly on database
    await expect(
      adminSql`
        UPDATE public.assertions
        SET origin = 'verified'
        WHERE id = ${extracted.id}::uuid
      `
    ).rejects.toThrow(/Cannot modify assertion provenance or value/);

    // The only way to have a verified assertion is creating a new one citing the human or external source
    const verifiedNew = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: 'beneficiario_final',
      value: 'Juan Perez (55%)',
      origin: 'verified',
      producedBy: adminAlfaId,
      evidenceId: 'doc_acta_asamblea_notariada.pdf',
    });

    expect(verifiedNew.origin).toBe('verified');
    expect(verifiedNew.id).not.toBe(extracted.id);
  });

  it('Escenario: Resolver una discrepancia deja registro y no borra nada', async () => {
    const fieldName = 'actividad_economica';

    const decl = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: fieldName,
      value: 'Transporte de carga terrestre',
      origin: 'declared',
      producedBy: adminAlfaId,
    });

    const verif = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: fieldName,
      value: 'Transporte intermunicipal de pasajeros',
      origin: 'verified',
      producedBy: adminAlfaId,
      evidenceId: 'doc_rut_2025.pdf',
    });

    // Compliance Officer resolves discrepancy in favor of 'verified'
    const resolution = await resolveDiscrepancy({
      organizationId: orgAlfa.id,
      dossierId,
      field: fieldName,
      selectedAssertionId: verif.id,
      resolvedBy: adminAlfaId,
      resolutionNote: 'Se toma el valor del RUT oficial presentado y cotejado ante DIAN',
    });

    expect(resolution.activeAssertion.id).toBe(verif.id);
    expect(resolution.activeAssertion.status).toBe('active');

    expect(resolution.discardedAssertions.length).toBe(1);
    expect(resolution.discardedAssertions[0].id).toBe(decl.id);
    expect(resolution.discardedAssertions[0].status).toBe('discarded');
    expect(resolution.discardedAssertions[0].resolutionNote).toBe(
      'Se toma el valor del RUT oficial presentado y cotejado ante DIAN'
    );
    expect(resolution.discardedAssertions[0].resolvedBy).toBe(adminAlfaId);

    // Check that the discarded assertion was NOT deleted from the database
    const allDbRows = await adminSql`
      SELECT id, status, resolution_note FROM public.assertions
      WHERE organization_id = ${orgAlfa.id}::uuid AND field = ${fieldName}
      ORDER BY produced_at ASC
    `;
    expect(allDbRows.length).toBe(2);

    // Check audit log for discrepancy resolution
    const auditRows = await adminSql`
      SELECT * FROM public.audit_log
      WHERE organization_id = ${orgAlfa.id}::uuid AND action = 'assertion.discrepancy_resolved'
    `;
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].metadata.field).toBe(fieldName);
  });

  it('Escenario: Aislamiento entre organizaciones sobre las afirmaciones (RLS)', async () => {
    // Assertion in Org Alfa
    const alfaAssertion = await registerAssertion({
      organizationId: orgAlfa.id,
      dossierId,
      partyId,
      configurationVersionId,
      field: 'cuenta_bancaria',
      value: '123-456789-0',
      origin: 'declared',
      producedBy: adminAlfaId,
    });

    // Query assertions using Org Beta context via withTenantContext
    const visibleInBeta = await withTenantContext(
      { userId: adminBetaId, organizationId: orgBeta.id },
      async (tx) => {
        return tx.execute<{ id: string; organization_id: string }>(
          sql`SELECT id, organization_id FROM public.assertions WHERE id = ${alfaAssertion.id}::uuid`
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
            sql`INSERT INTO public.assertions (
              organization_id, dossier_id, party_id, configuration_version_id,
              field, value, origin, produced_by
            ) VALUES (
              ${orgAlfa.id}::uuid, ${dossierId}::uuid, ${partyId}::uuid, ${configurationVersionId}::uuid,
              'hacked_field', '"unauthorized"'::jsonb, 'declared', ${adminBetaId}::uuid
            )`
          );
        },
      )
    ).rejects.toThrow();
  });

  describe('HU-012: Afirmaciones declaradas por la contraparte y valores vigentes', () => {
    it('permite registrar afirmación con origin "declared" sin producedBy y con actorType "counterparty" en audit', async () => {
      const fieldName = 'actividad_economica_ciiu';
      const assertion = await registerAssertion({
        organizationId: orgAlfa.id,
        dossierId,
        partyId,
        configurationVersionId,
        field: fieldName,
        value: '4711',
        origin: 'declared',
      });

      expect(assertion.id).toBeDefined();
      expect(assertion.producedBy).toBeNull();
      expect(assertion.origin).toBe('declared');

      // Verify audit log has actorType counterparty and null actorUserId
      const [auditRow] = await adminSql`
        SELECT * FROM public.audit_log
        WHERE organization_id = ${orgAlfa.id}::uuid
          AND action = 'assertion.registered'
          AND entity_id = ${assertion.id}
      `;
      expect(auditRow).toBeDefined();
      expect(auditRow.actor_type).toBe('counterparty');
      expect(auditRow.actor_user_id).toBeNull();
    });

    it('rechaza registrar afirmación sin producedBy cuando origin no es "declared"', async () => {
      await expect(
        registerAssertion({
          organizationId: orgAlfa.id,
          dossierId,
          partyId,
          configurationVersionId,
          field: 'rut_tax_id',
          value: '900123456-1',
          origin: 'extracted',
          evidenceId: 'doc-123',
          confidence: '0.95',
          // producedBy omitted
        }),
      ).rejects.toThrow("Una afirmación con origen 'extracted' exige un usuario productor");
    });

    it('getLatestDeclaredValuesForDossier devuelve solo la más reciente por campo y no borra la anterior', async () => {
      const fieldName = 'direccion_fiscal';

      // First assertion
      const first = await registerAssertion({
        organizationId: orgAlfa.id,
        dossierId,
        partyId,
        configurationVersionId,
        field: fieldName,
        value: 'Calle 100 # 10-20',
        origin: 'declared',
      });

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 50));

      // Corrected assertion
      const second = await registerAssertion({
        organizationId: orgAlfa.id,
        dossierId,
        partyId,
        configurationVersionId,
        field: fieldName,
        value: 'Calle 100 # 15-30 Oficina 501',
        origin: 'declared',
      });

      const latestValues = await getLatestDeclaredValuesForDossier(orgAlfa.id, dossierId);
      const targetField = latestValues.find((v) => v.field === fieldName);

      expect(targetField).toBeDefined();
      expect(targetField?.value).toBe('Calle 100 # 15-30 Oficina 501');

      // Both assertions must still exist in table (append-only)
      const allRows = await adminSql`
        SELECT id, value FROM public.assertions
        WHERE organization_id = ${orgAlfa.id}::uuid AND field = ${fieldName} AND dossier_id = ${dossierId}::uuid
      `;
      expect(allRows.length).toBe(2);
      expect(allRows.some((r) => r.id === first.id)).toBe(true);
      expect(allRows.some((r) => r.id === second.id)).toBe(true);
    });
  });
});

