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
  createDraftConfiguration,
  publishDraftConfiguration,
  getConfigurationVersionDetail,
} from './service';
import {
  addCounterpartyType,
  addRequirement,
  listCounterpartyTypes,
  getRequirementsForType,
} from './requirement-matrix';
import { withTenantContext } from '../db/client';
import { sql } from 'drizzle-orm';

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
  'Matriz Detail Org',
  'Distinct Types Org',
  'Version Upgrade Org',
  'Incomplete Matrix Org',
  'Alfa Matrix Org',
  'Beta Matrix Org',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu007.com')
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu007.com')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.requirements
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.counterparty_types
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
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
  await adminSql`
    DELETE FROM public.organizations
    WHERE name IN ${adminSql(TEST_ORG_NAMES)}
  `;
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu007.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu007.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-007: Tipos de contraparte y matriz de requisitos', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('Escenario: Cargar tipos de contraparte en una versión de configuración', async () => {
    const adminUser = await createTestAuthUser('admin1@test-hu007.com', 'Admin Org 1');
    const org = await createOrganizationWithAdmin(adminUser, { name: 'Alfa Ficticia S.A.S.' });
    await seedBaseConfiguration(org.id, adminUser);

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
    });

    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
    expect(typeRes.id).toBeDefined();

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeRes.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });

    const published = await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Carga inicial tipos y matriz',
    });
    expect(published.status).toBe('published');

    const types = await listCounterpartyTypes(org.id, draft.versionId);
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('proveedor');
    expect(types[0].nature).toBe('legal_entity');
  });

  it('Escenario: La matriz define qué se exige a cada combinación', async () => {
    const adminUser = await createTestAuthUser('admin2@test-hu007.com', 'Admin Org 2');
    const org = await createOrganizationWithAdmin(adminUser, { name: 'Matriz Detail Org' });
    await seedBaseConfiguration(org.id, adminUser);

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
    });

    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });

    const reqField = await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeRes.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'company_name',
      mandatory: 'always',
      validation: { dataType: 'string', min: 3 },
    });

    const reqDoc = await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: typeRes.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'rut_tax_certificate',
      mandatory: 'conditional',
      condition: { field: 'country', operator: 'eq', value: 'CO' },
      validation: { dataType: 'string', format: 'pdf' },
    });

    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Publicar requisitos proveedor',
    });

    const requirements = await getRequirementsForType(org.id, draft.versionId, typeRes.id);
    expect(requirements).toHaveLength(2);

    const fieldItem = requirements.find((r) => r.key === 'company_name');
    expect(fieldItem).toBeDefined();
    expect(fieldItem?.requirementId).toBe(reqField.id);
    expect(fieldItem?.type).toBe('field');
    expect(fieldItem?.mandatory).toBe('always');
    expect(fieldItem?.validation?.dataType).toBe('string');
    expect(fieldItem?.validation?.min).toBe(3);

    const docItem = requirements.find((r) => r.key === 'rut_tax_certificate');
    expect(docItem).toBeDefined();
    expect(docItem?.requirementId).toBe(reqDoc.id);
    expect(docItem?.type).toBe('document_type');
    expect(docItem?.mandatory).toBe('conditional');
    expect(docItem?.condition).toEqual({ field: 'country', operator: 'eq', value: 'CO' });
  });

  it('Escenario: Dos tipos de contraparte exigen cosas distintas', async () => {
    const adminUser = await createTestAuthUser('admin3@test-hu007.com', 'Admin Org 3');
    const org = await createOrganizationWithAdmin(adminUser, { name: 'Distinct Types Org' });
    await seedBaseConfiguration(org.id, adminUser);

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
    });

    const proveedor = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });

    const conductor = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'conductor',
      nature: 'natural_person',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: proveedor.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'camara_comercio',
      mandatory: 'always',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      counterpartyTypeId: conductor.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'licencia_conduccion',
      mandatory: 'always',
    });

    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Publicar proveedor y conductor',
    });

    const reqsProveedor = await getRequirementsForType(org.id, draft.versionId, proveedor.id);
    const reqsConductor = await getRequirementsForType(org.id, draft.versionId, conductor.id);

    expect(reqsProveedor.map((r) => r.key)).toContain('camara_comercio');
    expect(reqsProveedor.map((r) => r.key)).not.toContain('licencia_conduccion');

    expect(reqsConductor.map((r) => r.key)).toContain('licencia_conduccion');
    expect(reqsConductor.map((r) => r.key)).not.toContain('camara_comercio');
  });

  it('Escenario: Cambiar la matriz es publicar una versión nueva', async () => {
    const adminUser = await createTestAuthUser('admin4@test-hu007.com', 'Admin Org 4');
    const org = await createOrganizationWithAdmin(adminUser, { name: 'Version Upgrade Org' });
    await seedBaseConfiguration(org.id, adminUser);

    // Versión 2 con proveedor exigiendo solo tax_id
    const draft1 = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
    });

    const tipoV1 = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft1.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft1.versionId,
      counterpartyTypeId: tipoV1.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
    });

    const v1 = await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft1.versionId,
      publishedBy: adminUser,
      reason: 'Versión inicial con requisitos mínimos',
    });

    // Inmutabilidad: una versión publicada no permite agregar requisitos ni tipos
    await expect(
      addRequirement({
        organizationId: org.id,
        configurationVersionId: v1.id,
        counterpartyTypeId: tipoV1.id,
        standard: 'SARLAFT',
        type: 'document_type',
        key: 'certificacion_bancaria',
        mandatory: 'always',
      })
    ).rejects.toThrow(/Solo se pueden modificar versiones en estado borrador/);

    // Para cambiar la matriz, se crea borrador v3
    const draft2 = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
    });

    const tipoV2 = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft2.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft2.versionId,
      counterpartyTypeId: tipoV2.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
    });

    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draft2.versionId,
      counterpartyTypeId: tipoV2.id,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'certificacion_bancaria',
      mandatory: 'always',
    });

    const v2 = await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft2.versionId,
      publishedBy: adminUser,
      reason: 'Versión 2 añade certificación bancaria a proveedores',
    });

    // V1 sigue legible con sus requisitos originales
    const reqsV1 = await getRequirementsForType(org.id, v1.id, tipoV1.id);
    expect(reqsV1).toHaveLength(1);
    expect(reqsV1[0].key).toBe('tax_id');

    // V2 exige los dos
    const reqsV2 = await getRequirementsForType(org.id, v2.id, tipoV2.id);
    expect(reqsV2).toHaveLength(2);
    expect(reqsV2.map((r) => r.key)).toContain('tax_id');
    expect(reqsV2.map((r) => r.key)).toContain('certificacion_bancaria');
  }, 30000);

  it('Escenario: Una matriz incompleta no se puede publicar', async () => {
    const adminUser = await createTestAuthUser('admin5@test-hu007.com', 'Admin Org 5');
    const org = await createOrganizationWithAdmin(adminUser, { name: 'Incomplete Matrix Org' });
    await seedBaseConfiguration(org.id, adminUser);

    const draft = await createDraftConfiguration({
      organizationId: org.id,
      standard: 'SARLAFT',
    });

    // Creamos tipo 'empleado' sin requisitos
    await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'empleado',
      nature: 'natural_person',
    });

    // Intentar publicar debe ser rechazado indicando qué tipo quedó sin requisitos
    await expect(
      publishDraftConfiguration({
        organizationId: org.id,
        versionId: draft.versionId,
        publishedBy: adminUser,
        reason: 'Intento con tipo sin requisitos',
      })
    ).rejects.toThrow(/empleado/);

    // La versión permanece en borrador
    const versionDetail = await getConfigurationVersionDetail(org.id, draft.versionId);
    expect(versionDetail.status).toBe('draft');
  });

  it('Escenario: Aislamiento entre organizaciones sobre la matriz', async () => {
    const userAlfa = await createTestAuthUser('alfa-iso@test-hu007.com', 'Alfa User');
    const userBeta = await createTestAuthUser('beta-iso@test-hu007.com', 'Beta User');

    const orgAlfa = await createOrganizationWithAdmin(userAlfa, { name: 'Alfa Matrix Org' });
    const orgBeta = await createOrganizationWithAdmin(userBeta, { name: 'Beta Matrix Org' });

    await seedBaseConfiguration(orgAlfa.id, userAlfa);
    await seedBaseConfiguration(orgBeta.id, userBeta);

    const draftAlfa = await createDraftConfiguration({
      organizationId: orgAlfa.id,
      standard: 'SARLAFT',
    });

    const typeAlfa = await addCounterpartyType({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      name: 'cliente_alfa',
      nature: 'legal_entity',
    });

    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: typeAlfa.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'alfa_custom_field',
      mandatory: 'always',
    });

    // 1. Consulta con contexto de usuario Alfa propagado
    const alfaTypes = await withTenantContext(
      { userId: userAlfa, organizationId: orgAlfa.id },
      async (tx) => {
        return listCounterpartyTypes(orgAlfa.id, draftAlfa.versionId, tx);
      }
    );
    expect(alfaTypes).toHaveLength(1);
    expect(alfaTypes[0].name).toBe('cliente_alfa');

    // 2. Consulta con contexto de usuario Beta hacia datos de Alfa devuelve vacío (RLS)
    const betaReadingAlfa = await withTenantContext(
      { userId: userBeta, organizationId: orgBeta.id },
      async (tx) => {
        return listCounterpartyTypes(orgAlfa.id, draftAlfa.versionId, tx);
      }
    );
    expect(betaReadingAlfa).toHaveLength(0);

    // 3. Intento de escritura cruzada en Beta con contexto de Alfa es rechazado por la base de datos
    await expect(
      withTenantContext(
        { userId: userAlfa, organizationId: orgAlfa.id },
        async (tx) => {
          return tx.execute(
            sql`INSERT INTO public.counterparty_types (organization_id, configuration_version_id, name, nature)
                VALUES (${orgBeta.id}, gen_random_uuid(), 'illegal_type', 'natural_person')`
          );
        }
      )
    ).rejects.toThrow();

    await expect(
      withTenantContext(
        { userId: userAlfa, organizationId: orgAlfa.id },
        async (tx) => {
          return tx.execute(
            sql`INSERT INTO public.requirements (organization_id, configuration_version_id, counterparty_type_id, standard, type, key, mandatory)
                VALUES (${orgBeta.id}, gen_random_uuid(), gen_random_uuid(), 'SARLAFT', 'field', 'illegal_key', 'always')`
          );
        }
      )
    ).rejects.toThrow();
  }, 30000);
});