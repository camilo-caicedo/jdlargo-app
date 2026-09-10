import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import {
  createDraftConfiguration,
  publishDraftConfiguration,
} from '../configuration/service';
import {
  addCounterpartyType,
  addRequirement,
} from '../configuration/requirement-matrix';
import { withTenantContext } from '../db/client';
import {
  createDossierRequest,
  getDossierPendingRequirements,
  updateDossierAdministrativeData,
} from './dossier';
import { executeTransition } from './state-machine';

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
  'Matrix Inheritance Org',
  'Version Freeze Org',
  'No Config Org',
  'Beta Ficticia S.A.S.',
  'Permission Org',
  'Party Reuse Org',
  'HU-061 Edit Org',
];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu008.com' OR email LIKE '%@test-hu061.com')
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu008.com' OR email LIKE '%@test-hu061.com')
  `;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu008.com' OR email LIKE '%@test-hu061.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu008.com' OR email LIKE '%@test-hu061.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-008: Crear la solicitud de vinculación y abrir el expediente', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  }, 60000);

  it('Escenario: Crear una solicitud y abrir su expediente', async () => {
    const adminUser = await createTestAuthUser('admin1@test-hu008.com', 'Admin Org 1');
    const operationalUser = await createTestAuthUser('op1@test-hu008.com', 'Usuario Operativo 1');
    const internalOwner = await createTestAuthUser('owner1@test-hu008.com', 'Responsable Interno 1');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Alfa Ficticia S.A.S.' });
    await seedBaseConfiguration(org.id, adminUser);

    // Otorgar membresía operational_user (tiene dossier:create) y reviewer/compliance para internal owner
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: operationalUser,
      role: 'operational_user',
    });
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: internalOwner,
      role: 'compliance_analyst',
    });

    // Publicar versión con tipo de contraparte 'proveedor'
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

    const publishedConfig = await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Versión con tipo proveedor',
    });

    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días en el futuro

    // Cuando crea una solicitud para la contraparte 'Ficticia S.A.S.' de tipo 'proveedor'
    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: operationalUser,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900123456-1',
        declaredName: 'Ficticia S.A.S.',
      },
      internalOwnerId: internalOwner,
      deadline,
    });

    // Entonces queda creado un expediente con identificador único dentro de la organización cliente
    expect(dossier.id).toBeDefined();
    expect(dossier.code).toMatch(/^EXP-\d{6}$/);
    expect(dossier.organizationId).toBe(org.id);

    // Y el expediente queda en el estado inicial de la máquina de estados ('borrador')
    expect(dossier.state).toBe('borrador');

    // Y el expediente cita la versión de configuración con la que se abrió
    expect(dossier.configurationVersionId).toBe(publishedConfig.id);

    // Y queda registrado el responsable interno y la fecha límite
    expect(dossier.internalOwnerId).toBe(internalOwner);
    expect(dossier.deadline?.getTime()).toBe(deadline.getTime());

    // Y la creación queda registrada en la bitácora
    const auditLogs = await adminSql<{ action: string; metadata: Record<string, unknown> | null }[]>`
      SELECT action, metadata FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action = 'dossier.created'
        AND entity_id = ${dossier.id}
    `;
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].metadata?.code).toBe(dossier.code);

    // Y la contraparte declarada queda registrada como afirmación con origen 'declared'
    const assertionsList = await adminSql<{ field: string; value: string; origin: string }[]>`
      SELECT field, value::text, origin FROM public.assertions
      WHERE organization_id = ${org.id}
        AND dossier_id = ${dossier.id}
        AND field = 'party.declared_name'
    `;
    expect(assertionsList).toHaveLength(1);
    expect(assertionsList[0].origin).toBe('declared');
    expect(assertionsList[0].value).toBe('"Ficticia S.A.S."');
  }, 30000);

  it('Escenario: El expediente hereda lo que exige la matriz', async () => {
    const adminUser = await createTestAuthUser('admin2@test-hu008.com', 'Admin Org 2');
    const operationalUser = await createTestAuthUser('op2@test-hu008.com', 'Usuario Operativo 2');
    const internalOwner = await createTestAuthUser('owner2@test-hu008.com', 'Responsable Interno 2');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Matrix Inheritance Org' });
    await seedBaseConfiguration(org.id, adminUser);

    await grantMembership(adminUser, { organizationId: org.id, userId: operationalUser, role: 'operational_user' });
    await grantMembership(adminUser, { organizationId: org.id, userId: internalOwner, role: 'compliance_analyst' });

    // Versión cuya matriz exige 6 campos y 3 tipos documentales
    const draft = await createDraftConfiguration({ organizationId: org.id, standard: 'SARLAFT' });
    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });

    const fieldKeys = ['nit', 'razon_social', 'direccion', 'telefono', 'ciudad', 'representante_legal'];
    for (const key of fieldKeys) {
      await addRequirement({
        organizationId: org.id,
        configurationVersionId: draft.versionId,
        counterpartyTypeId: typeRes.id,
        standard: 'SARLAFT',
        type: 'field',
        key,
        mandatory: 'always',
        validation: { dataType: 'string' },
      });
    }

    const docKeys = ['rut', 'camara_comercio', 'estados_financieros'];
    for (const key of docKeys) {
      await addRequirement({
        organizationId: org.id,
        configurationVersionId: draft.versionId,
        counterpartyTypeId: typeRes.id,
        standard: 'SARLAFT',
        type: 'document_type',
        key,
        mandatory: 'always',
      });
    }

    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Matriz completa 6 campos y 3 documentos',
    });

    const dossier = await createDossierRequest({
      organizationId: org.id,
      requestedBy: operationalUser,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: '800555666-1',
        declaredName: 'Aliado Logístico S.A.S.',
      },
      internalOwnerId: internalOwner,
    });

    // Obtener requisitos pendientes
    const reqs = await getDossierPendingRequirements(org.id, dossier.id);
    const fields = reqs.filter((r) => r.type === 'field');
    const docs = reqs.filter((r) => r.type === 'document_type');

    expect(fields).toHaveLength(6);
    expect(docs).toHaveLength(3);
    expect(fields.map((f) => f.key)).toEqual(expect.arrayContaining(fieldKeys));
    expect(docs.map((d) => d.key)).toEqual(expect.arrayContaining(docKeys));
  }, 30000);

  it('Escenario: Publicar una versión nueva no altera un expediente ya abierto', async () => {
    const adminUser = await createTestAuthUser('admin3@test-hu008.com', 'Admin Org 3');
    const operationalUser = await createTestAuthUser('op3@test-hu008.com', 'Usuario Operativo 3');
    const internalOwner = await createTestAuthUser('owner3@test-hu008.com', 'Responsable Interno 3');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Version Freeze Org' });
    await seedBaseConfiguration(org.id, adminUser);

    await grantMembership(adminUser, { organizationId: org.id, userId: operationalUser, role: 'operational_user' });
    await grantMembership(adminUser, { organizationId: org.id, userId: internalOwner, role: 'compliance_analyst' });

    // Publicar versión 2 (actúa como la v3 del escenario)
    const draftV2 = await createDraftConfiguration({ organizationId: org.id, standard: 'SARLAFT' });
    const typeV2 = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draftV2.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draftV2.versionId,
      counterpartyTypeId: typeV2.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draftV2.versionId,
      publishedBy: adminUser,
      reason: 'Versión inicial con 1 requisito',
    });

    // Abrir expediente con esta versión vigente
    const dossierOld = await createDossierRequest({
      organizationId: org.id,
      requestedBy: operationalUser,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999000-1',
        declaredName: 'Proveedor Antiguo S.A.S.',
      },
      internalOwnerId: internalOwner,
    });

    // Oficial de cumplimiento publica una versión posterior con requisitos adicionales
    const draftV3 = await createDraftConfiguration({ organizationId: org.id, standard: 'SARLAFT' });
    const typeV3 = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draftV3.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draftV3.versionId,
      counterpartyTypeId: typeV3.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await addRequirement({
      organizationId: org.id,
      configurationVersionId: draftV3.versionId,
      counterpartyTypeId: typeV3.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'extra_field_v3',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draftV3.versionId,
      publishedBy: adminUser,
      reason: 'Nueva versión con requisito extra',
    });

    // Abrir expediente nuevo con la nueva versión
    const dossierNew = await createDossierRequest({
      organizationId: org.id,
      requestedBy: operationalUser,
      counterpartyTypeName: 'proveedor',
      party: {
        identificationType: 'NIT',
        identificationNumber: '900999000-2',
        declaredName: 'Proveedor Nuevo S.A.S.',
      },
      internalOwnerId: internalOwner,
    });

    // Entonces el expediente abierto sigue exigiendo lo que decía su versión citada (1 requisito)
    const oldReqs = await getDossierPendingRequirements(org.id, dossierOld.id);
    expect(oldReqs).toHaveLength(1);
    expect(oldReqs[0].key).toBe('tax_id');

    // Y los expedientes que se abran desde ese momento exigen lo que dice la versión nueva (2 requisitos)
    const newReqs = await getDossierPendingRequirements(org.id, dossierNew.id);
    expect(newReqs).toHaveLength(2);
    expect(newReqs.map((r) => r.key)).toContain('extra_field_v3');
  }, 60000);

  it('Escenario: No se abre un expediente sin tipo de contraparte válido', async () => {
    const adminUser = await createTestAuthUser('admin4@test-hu008.com', 'Admin Org 4');
    const operationalUser = await createTestAuthUser('op4@test-hu008.com', 'Usuario Operativo 4');

    // Organización recién creada SIN configuración publicada
    const org = await createOrganizationWithAdmin(adminUser, { name: 'No Config Org' });
    // Damos membresía operational_user pero no publicamos configuración
    await grantMembership(adminUser, { organizationId: org.id, userId: operationalUser, role: 'operational_user' });

    // Intento de crear solicitud
    await expect(
      createDossierRequest({
        organizationId: org.id,
        requestedBy: operationalUser,
        counterpartyTypeName: 'proveedor',
        party: {
          identificationType: 'NIT',
          identificationNumber: '900888777-1',
          declaredName: 'Empresa Sin Config',
        },
        internalOwnerId: adminUser,
      })
    ).rejects.toThrow(/No hay configuración vigente/);

    // No queda ningún expediente a medias
    const dossiersInDb = await adminSql<{ count: string }[]>`
      SELECT count(*) as count FROM public.dossiers WHERE organization_id = ${org.id}
    `;
    expect(Number(dossiersInDb[0].count)).toBe(0);

    const partiesInDb = await adminSql<{ count: string }[]>`
      SELECT count(*) as count FROM public.parties WHERE organization_id = ${org.id}
    `;
    expect(Number(partiesInDb[0].count)).toBe(0);
  }, 30000);

  it('Escenario: Dos organizaciones clientes vinculan a la misma contraparte', async () => {
    const adminAlfa = await createTestAuthUser('admin-alfa@test-hu008.com', 'Admin Alfa');
    const adminBeta = await createTestAuthUser('admin-beta@test-hu008.com', 'Admin Beta');
    const userAlfa = await createTestAuthUser('user-alfa@test-hu008.com', 'User Alfa');
    const userBeta = await createTestAuthUser('user-beta@test-hu008.com', 'User Beta');

    const orgAlfa = await createOrganizationWithAdmin(adminAlfa, { name: 'Alfa Ficticia S.A.S.' });
    const orgBeta = await createOrganizationWithAdmin(adminBeta, { name: 'Beta Ficticia S.A.S.' });

    await seedBaseConfiguration(orgAlfa.id, adminAlfa);
    await seedBaseConfiguration(orgBeta.id, adminBeta);

    await grantMembership(adminAlfa, { organizationId: orgAlfa.id, userId: userAlfa, role: 'operational_user' });
    await grantMembership(adminBeta, { organizationId: orgBeta.id, userId: userBeta, role: 'operational_user' });

    // Configurar tipo en Alfa
    const draftAlfa = await createDraftConfiguration({ organizationId: orgAlfa.id, standard: 'SARLAFT' });
    const typeAlfa = await addCounterpartyType({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: orgAlfa.id,
      configurationVersionId: draftAlfa.versionId,
      counterpartyTypeId: typeAlfa.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({ organizationId: orgAlfa.id, versionId: draftAlfa.versionId, publishedBy: adminAlfa, reason: 'Alfa config' });

    // Configurar tipo en Beta
    const draftBeta = await createDraftConfiguration({ organizationId: orgBeta.id, standard: 'SARLAFT' });
    const typeBeta = await addCounterpartyType({
      organizationId: orgBeta.id,
      configurationVersionId: draftBeta.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
    await addRequirement({
      organizationId: orgBeta.id,
      configurationVersionId: draftBeta.versionId,
      counterpartyTypeId: typeBeta.id,
      standard: 'SARLAFT',
      type: 'field',
      key: 'tax_id',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await publishDraftConfiguration({ organizationId: orgBeta.id, versionId: draftBeta.versionId, publishedBy: adminBeta, reason: 'Beta config' });

    // Misma información declarada de contraparte
    const sharedParty = {
      identificationType: 'NIT',
      identificationNumber: '900333444-5',
      declaredName: 'Ficticia Compartida S.A.S.',
    };

    const dossierAlfa = await createDossierRequest({
      organizationId: orgAlfa.id,
      requestedBy: userAlfa,
      counterpartyTypeName: 'proveedor',
      party: sharedParty,
      internalOwnerId: adminAlfa,
    });

    const dossierBeta = await createDossierRequest({
      organizationId: orgBeta.id,
      requestedBy: userBeta,
      counterpartyTypeName: 'proveedor',
      party: sharedParty,
      internalOwnerId: adminBeta,
    });

    // Existen dos sujetos distintos y dos expedientes independientes
    expect(dossierAlfa.id).not.toBe(dossierBeta.id);
    expect(dossierAlfa.partyId).not.toBe(dossierBeta.partyId);

    // Ninguna de las dos organizaciones clientes puede ver el expediente de la otra con contexto de usuario
    const alfaView = await withTenantContext(
      { userId: userAlfa, organizationId: orgAlfa.id },
      async (tx) => {
        return tx.execute<{ id: string }>(
          sql`SELECT id FROM public.dossiers WHERE id = ${dossierBeta.id}::uuid`,
        );
      },
    );
    expect(alfaView).toHaveLength(0);

    const betaView = await withTenantContext(
      { userId: userBeta, organizationId: orgBeta.id },
      async (tx) => {
        return tx.execute<{ id: string }>(
          sql`SELECT id FROM public.dossiers WHERE id = ${dossierAlfa.id}::uuid`,
        );
      },
    );
    expect(betaView).toHaveLength(0);
  }, 60000);

  it('Escenario: Crear una solicitud exige permiso', async () => {
    const adminUser = await createTestAuthUser('admin5@test-hu008.com', 'Admin Org 5');
    const auditorUser = await createTestAuthUser('auditor5@test-hu008.com', 'Auditor 5');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Permission Org' });
    await seedBaseConfiguration(org.id, adminUser);

    // El rol auditor NO tiene dossier:create
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: auditorUser,
      role: 'auditor',
    });

    // Publicar config
    const draft = await createDraftConfiguration({ organizationId: org.id, standard: 'SARLAFT' });
    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
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
    await publishDraftConfiguration({ organizationId: org.id, versionId: draft.versionId, publishedBy: adminUser, reason: 'Config 1' });

    // Intento del auditor de crear una solicitud
    await expect(
      createDossierRequest({
        organizationId: org.id,
        requestedBy: auditorUser,
        counterpartyTypeName: 'proveedor',
        party: {
          identificationType: 'NIT',
          identificationNumber: '900111222-3',
          declaredName: 'Empresa Intento No Autorizado',
        },
        internalOwnerId: adminUser,
      })
    ).rejects.toThrow(/Acción no autorizada: falta el permiso 'dossier:create'/);

    // El intento queda registrado en la bitácora
    const deniedLogs = await adminSql<{ action: string; actor_user_id: string }[]>`
      SELECT action, actor_user_id FROM public.audit_log
      WHERE organization_id = ${org.id}
        AND action = 'security.permission_denied'
        AND actor_user_id = ${auditorUser}::uuid
    `;
    expect(deniedLogs).toHaveLength(1);
  }, 60000);

  it('Escenario: El mismo proveedor puede tener varias vinculaciones reutilizando el sujeto (find-or-create)', async () => {
    const adminUser = await createTestAuthUser('admin6@test-hu008.com', 'Admin Org 6');
    const operationalUser = await createTestAuthUser('op6@test-hu008.com', 'Usuario Operativo 6');

    const org = await createOrganizationWithAdmin(adminUser, { name: 'Party Reuse Org' });
    await seedBaseConfiguration(org.id, adminUser);
    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: operationalUser,
      role: 'operational_user',
    });

    const draft = await createDraftConfiguration({ organizationId: org.id, standard: 'SARLAFT' });
    const typeRes = await addCounterpartyType({
      organizationId: org.id,
      configurationVersionId: draft.versionId,
      name: 'proveedor',
      nature: 'legal_entity',
    });
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
    await publishDraftConfiguration({
      organizationId: org.id,
      versionId: draft.versionId,
      publishedBy: adminUser,
      reason: 'Configuración para reutilización',
    });

    const sharedPartyInput = {
      identificationType: 'NIT',
      identificationNumber: '900777888-9',
      declaredName: 'Proveedor Frecuente S.A.S.',
    };

    // Primera vinculación para este proveedor
    const dossier1 = await createDossierRequest({
      organizationId: org.id,
      requestedBy: operationalUser,
      counterpartyTypeName: 'proveedor',
      party: sharedPartyInput,
      internalOwnerId: adminUser,
    });

    // Segunda vinculación para el mismo proveedor (p. ej. nuevo contrato o vinculación periódica)
    const dossier2 = await createDossierRequest({
      organizationId: org.id,
      requestedBy: operationalUser,
      counterpartyTypeName: 'proveedor',
      party: {
        ...sharedPartyInput,
        declaredName: 'Proveedor Frecuente S.A.S. - Sucursal 2',
      },
      internalOwnerId: adminUser,
    });

    // Son dos expedientes distintos
    expect(dossier1.id).not.toBe(dossier2.id);
    expect(dossier1.code).not.toBe(dossier2.code);

    // Ambos expedientes apuntan exactamente al mismo sujeto (reutilización)
    expect(dossier1.partyId).toBe(dossier2.partyId);

    // La base de datos tiene exactamente una fila de parties para esa identificación
    const partyCount = await adminSql<{ count: string }[]>`
      SELECT count(*) as count FROM public.parties
      WHERE organization_id = ${org.id}
        AND identification_type = ${sharedPartyInput.identificationType}
        AND identification_number = ${sharedPartyInput.identificationNumber}
    `;
    expect(Number(partyCount[0].count)).toBe(1);
  }, 60000);

  describe('HU-061: Editar datos administrativos del expediente', () => {
    it('permite cambiar responsable interno y fecha límite, registra en audit_log, y rechaza si cerrada o sin permisos', async () => {
      const adminUser = await createTestAuthUser('admin-hu061@test-hu061.com', 'Admin HU061');
      const analystUser = await createTestAuthUser('analyst-hu061@test-hu061.com', 'Analista HU061');
      const officerUser = await createTestAuthUser('officer-hu061@test-hu061.com', 'Oficial HU061');
      const newOwnerUser = await createTestAuthUser('newowner-hu061@test-hu061.com', 'Nuevo Responsable HU061');
      const auditorUser = await createTestAuthUser('auditor-hu061@test-hu061.com', 'Auditor HU061');

      const org = await createOrganizationWithAdmin(adminUser, { name: 'HU-061 Edit Org' });
      await seedBaseConfiguration(org.id, adminUser);

      // Grant officer (dossier:approve), analyst (dossier:edit), newOwner (operational_user), auditor (auditor - no edit)
      await grantMembership(adminUser, {
        organizationId: org.id,
        userId: officerUser,
        role: 'compliance_officer',
      });
      await grantMembership(adminUser, {
        organizationId: org.id,
        userId: analystUser,
        role: 'compliance_analyst',
      });
      await grantMembership(adminUser, {
        organizationId: org.id,
        userId: newOwnerUser,
        role: 'operational_user',
      });
      await grantMembership(adminUser, {
        organizationId: org.id,
        userId: auditorUser,
        role: 'auditor',
      });

      // Seed draft and publish with counterparty type
      const draft = await createDraftConfiguration({
        organizationId: org.id,
        standard: 'SARLAFT',
      });
      const cpType = await addCounterpartyType({
        organizationId: org.id,
        configurationVersionId: draft.versionId,
        name: 'proveedor',
        nature: 'legal_entity',
      });
      await addRequirement({
        organizationId: org.id,
        configurationVersionId: draft.versionId,
        counterpartyTypeId: cpType.id,
        standard: 'SARLAFT',
        type: 'field',
        key: 'tax_id',
        mandatory: 'always',
        validation: { dataType: 'string' },
      });
      await publishDraftConfiguration({
        organizationId: org.id,
        versionId: draft.versionId,
        publishedBy: adminUser,
        reason: 'Publicar config HU-061',
      });

      const initialDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const dossier = await createDossierRequest({
        organizationId: org.id,
        requestedBy: analystUser,
        counterpartyTypeName: 'proveedor',
        party: {
          identificationType: 'NIT',
          identificationNumber: '900111222-3',
          declaredName: 'Empresa Test HU061 S.A.S.',
        },
        internalOwnerId: adminUser,
        deadline: initialDeadline,
      });

      expect(dossier.internalOwnerId).toBe(adminUser);

      // 1. Éxito cambiando responsable interno y fecha límite
      const newDeadline = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const updated1 = await updateDossierAdministrativeData({
        organizationId: org.id,
        dossierId: dossier.id,
        updatedBy: analystUser,
        internalOwnerId: newOwnerUser,
        deadline: newDeadline,
      });

      expect(updated1.internalOwnerId).toBe(newOwnerUser);
      expect(updated1.deadline?.toISOString()).toBe(newDeadline.toISOString());

      // Verificar en audit_log
      const [auditEntry1] = await adminSql<{ action: string; previous_value: Record<string, unknown>; new_value: Record<string, unknown> }[]>`
        SELECT action, previous_value, new_value
        FROM public.audit_log
        WHERE organization_id = ${org.id}::uuid
          AND action = 'dossier.updated'
        ORDER BY occurred_at DESC
        LIMIT 1
      `;
      expect(auditEntry1).toBeDefined();
      expect(auditEntry1.previous_value.internalOwnerId).toBe(adminUser);
      expect(auditEntry1.new_value.internalOwnerId).toBe(newOwnerUser);

      // 2. Éxito limpiando fecha límite (null)
      const updated2 = await updateDossierAdministrativeData({
        organizationId: org.id,
        dossierId: dossier.id,
        updatedBy: analystUser,
        deadline: null,
      });
      expect(updated2.deadline).toBeNull();
      expect(updated2.internalOwnerId).toBe(newOwnerUser);

      // 3. Rechazo si el nuevo responsable no es miembro activo
      const nonMemberId = await createTestAuthUser('outsider@test-hu061.com', 'Outsider');
      await expect(
        updateDossierAdministrativeData({
          organizationId: org.id,
          dossierId: dossier.id,
          updatedBy: analystUser,
          internalOwnerId: nonMemberId,
        }),
      ).rejects.toThrow(/El responsable interno debe ser un miembro activo de la organización/);

      // 4. Rechazo si no tiene permiso dossier:edit (auditor)
      await expect(
        updateDossierAdministrativeData({
          organizationId: org.id,
          dossierId: dossier.id,
          updatedBy: auditorUser,
          deadline: newDeadline,
        }),
      ).rejects.toThrow(/Acción no autorizada: falta el permiso 'dossier:edit'/);

      // 5. Rechazo si el expediente está en estado 'cerrada'
      // Avanzar: borrador -> enviada -> en_diligenciamiento -> documentos_recibidos -> en_revision -> pendiente_de_decision -> aprobada -> cerrada
      await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'enviada', actorType: 'user', actorId: adminUser });
      await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_diligenciamiento', actorType: 'user', actorId: adminUser });
      await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'documentos_recibidos', actorType: 'user', actorId: adminUser });
      await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_revision', actorType: 'user', actorId: adminUser });
      await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'pendiente_de_decision', actorType: 'user', actorId: adminUser });
      await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'aprobada', actorType: 'user', actorId: officerUser });
      await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'cerrada', actorType: 'user', actorId: adminUser });

      await expect(
        updateDossierAdministrativeData({
          organizationId: org.id,
          dossierId: dossier.id,
          updatedBy: adminUser,
          deadline: newDeadline,
        }),
      ).rejects.toThrow(/Un expediente cerrado no se puede editar/);
    }, 60000);
  });
});