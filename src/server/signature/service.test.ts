import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '../db/client';
import { createOrganizationWithAdmin } from '../organizations/use-cases';
import { seedBaseConfiguration } from '../auth/role-config';
import { createDraftConfiguration, publishDraftConfiguration } from '../configuration/service';
import { addCounterpartyType, addRequirement } from '../configuration/requirement-matrix';
import { createDossierRequest } from '../dossiers/dossier';
import { executeTransition } from '../dossiers/state-machine';
import { ensureReviewEntryTransition } from '../dossiers/review';
import { registerAssertion } from '../assertions/service';
import { confirmDocumentUpload } from '../documents/document';
import { issueAccessLink } from '../dossiers/access';
import {
  computeDossierContentHash,
  getDossierSignatureStatus,
  signDossier,
  invalidateActiveSignatureIfContentChanged,
} from './service';

const directUrl = process.env.DIRECT_URL;
const adminSql = postgres(directUrl || '');

async function createTestAuthUser(email: string, name: string): Promise<string> {
  const meta = JSON.stringify({ name });
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
      ${meta}::jsonb,
      now(),
      now()
    ) RETURNING id
  `;
  return res[0].id;
}

const TEST_ORG_NAMES = ['Signature Test Org Alfa', 'Signature Test Org Beta', 'Signature Test Org Gamma'];

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`
    DELETE FROM public.audit_log
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR actor_user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu022.com')
  `;
  await adminSql`
    DELETE FROM public.signatures
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossier_access_otp_codes
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossier_access_uses
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.dossier_access_tokens
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.assertions
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.documents
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
  await adminSql`
    DELETE FROM public.requirements
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`
    DELETE FROM public.counterparty_types
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
  `;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`
    DELETE FROM public.memberships
    WHERE organization_id IN (SELECT id FROM public.organizations WHERE name IN ${adminSql(TEST_ORG_NAMES)})
       OR user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-hu022.com')
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
  await adminSql`DELETE FROM public.users WHERE email LIKE '%@test-hu022.com'`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu022.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-022: Firma electrónica de niveles 1 y 2', () => {
  let orgId: string;
  let adminUserId: string;
  let cpTypeIdLevel1: string;
  let cpTypeIdLevel2: string;
  let configVersionIdLevel1: string;
  let configVersionIdLevel2: string;

  // Organización separada para nivel 2: cada organización solo puede tener UNA versión
  // activa a la vez (publicar una nueva reemplaza la anterior) — usar dos organizaciones
  // en vez de dos versiones de la misma evita que la segunda publicación se lleve por
  // delante la vigencia de la primera para los dossiers de nivel 1 ya creados.
  let orgLevel2Id: string;
  let adminLevel2Id: string;

  let orgBetaId: string;
  let adminBetaId: string;

  // Crea un dossier fresco en 'documentos_recibidos' con un campo declarado y un documento,
  // usando la organización/versión de configuración (nivel 1 o 2) indicada.
  async function createTestDossier(opts: {
    level: 1 | 2;
    identificationNumber: string;
    docHash?: string;
  }) {
    const targetOrgId = opts.level === 1 ? orgId : orgLevel2Id;
    const targetAdminId = opts.level === 1 ? adminUserId : adminLevel2Id;
    const configVersionId = opts.level === 1 ? configVersionIdLevel1 : configVersionIdLevel2;
    const cpTypeName = opts.level === 1 ? 'proveedor_l1' : 'proveedor_l2';

    const dossier = await createDossierRequest({
      organizationId: targetOrgId,
      requestedBy: targetAdminId,
      counterpartyTypeName: cpTypeName,
      party: {
        identificationType: 'NIT',
        identificationNumber: opts.identificationNumber,
        declaredName: `Test Dossier ${opts.identificationNumber}`,
      },
      internalOwnerId: targetAdminId,
    });

    await executeTransition({
      organizationId: targetOrgId,
      dossierId: dossier.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: targetAdminId,
    });
    await executeTransition({
      organizationId: targetOrgId,
      dossierId: dossier.id,
      toState: 'en_diligenciamiento',
      actorType: 'counterparty',
    });

    await registerAssertion({
      organizationId: targetOrgId,
      dossierId: dossier.id,
      partyId: dossier.partyId,
      configurationVersionId: configVersionId,
      field: 'razon_social',
      value: `Empresa ${opts.identificationNumber}`,
      origin: 'declared',
    });

    await confirmDocumentUpload({
      organizationId: targetOrgId,
      dossierId: dossier.id,
      documentType: 'doc_rut',
      storagePath: `${dossier.id}/doc_rut/rut.pdf`,
      hash: opts.docHash || `hash-${opts.identificationNumber}-v1`,
      format: 'pdf',
      size: 1024,
      uploadedByType: 'counterparty',
    });

    await executeTransition({
      organizationId: targetOrgId,
      dossierId: dossier.id,
      toState: 'documentos_recibidos',
      actorType: 'counterparty',
    });

    return { dossierId: dossier.id, partyId: dossier.partyId, configVersionId, organizationId: targetOrgId };
  }

  beforeAll(async () => {
    await cleanupTestData();

    adminUserId = await createTestAuthUser('admin@test-hu022.com', 'Admin HU022');
    const org = await createOrganizationWithAdmin(adminUserId, { name: 'Signature Test Org Alfa' });
    orgId = org.id;
    await seedBaseConfiguration(orgId, adminUserId);

    // Organización Alfa: configuración con nivel de firma 1 (default)
    const draftL1 = await createDraftConfiguration({ organizationId: orgId, standard: 'SARLAFT' });
    const cpL1 = await addCounterpartyType({
      organizationId: orgId,
      configurationVersionId: draftL1.versionId,
      name: 'proveedor_l1',
      nature: 'legal_entity',
    });
    cpTypeIdLevel1 = cpL1.id;
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draftL1.versionId,
      counterpartyTypeId: cpTypeIdLevel1,
      standard: 'SARLAFT',
      type: 'field',
      key: 'razon_social',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await addRequirement({
      organizationId: orgId,
      configurationVersionId: draftL1.versionId,
      counterpartyTypeId: cpTypeIdLevel1,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });
    await publishDraftConfiguration({
      organizationId: orgId,
      versionId: draftL1.versionId,
      publishedBy: adminUserId,
      reason: 'Config nivel 1 para HU-022',
    });
    configVersionIdLevel1 = draftL1.versionId;

    // Organización separada para nivel 2
    adminLevel2Id = await createTestAuthUser('admin-l2@test-hu022.com', 'Admin Nivel 2 HU022');
    const orgLevel2 = await createOrganizationWithAdmin(adminLevel2Id, { name: 'Signature Test Org Gamma' });
    orgLevel2Id = orgLevel2.id;
    await seedBaseConfiguration(orgLevel2Id, adminLevel2Id);

    const draftL2 = await createDraftConfiguration({
      organizationId: orgLevel2Id,
      standard: 'SARLAFT',
      signatureLevelRequired: 2,
    });
    const cpL2 = await addCounterpartyType({
      organizationId: orgLevel2Id,
      configurationVersionId: draftL2.versionId,
      name: 'proveedor_l2',
      nature: 'legal_entity',
    });
    cpTypeIdLevel2 = cpL2.id;
    await addRequirement({
      organizationId: orgLevel2Id,
      configurationVersionId: draftL2.versionId,
      counterpartyTypeId: cpTypeIdLevel2,
      standard: 'SARLAFT',
      type: 'field',
      key: 'razon_social',
      mandatory: 'always',
      validation: { dataType: 'string' },
    });
    await addRequirement({
      organizationId: orgLevel2Id,
      configurationVersionId: draftL2.versionId,
      counterpartyTypeId: cpTypeIdLevel2,
      standard: 'SARLAFT',
      type: 'document_type',
      key: 'doc_rut',
      mandatory: 'always',
    });
    await publishDraftConfiguration({
      organizationId: orgLevel2Id,
      versionId: draftL2.versionId,
      publishedBy: adminLevel2Id,
      reason: 'Config nivel 2 para HU-022',
    });
    configVersionIdLevel2 = draftL2.versionId;

    // Tercera organización para el test de aislamiento
    adminBetaId = await createTestAuthUser('admin-beta@test-hu022.com', 'Admin Beta HU022');
    const orgBeta = await createOrganizationWithAdmin(adminBetaId, { name: 'Signature Test Org Beta' });
    orgBetaId = orgBeta.id;
    await seedBaseConfiguration(orgBetaId, adminBetaId);
  }, 60000);

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  describe('computeDossierContentHash', () => {
    it('es determinístico para el mismo contenido', async () => {
      const { dossierId } = await createTestDossier({ level: 1, identificationNumber: '900000001' });
      const hash1 = await computeDossierContentHash(orgId, dossierId);
      const hash2 = await computeDossierContentHash(orgId, dossierId);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('cambia si cambia un campo declarado', async () => {
      const { dossierId, partyId, configVersionId } = await createTestDossier({
        level: 1,
        identificationNumber: '900000002',
      });
      const hashBefore = await computeDossierContentHash(orgId, dossierId);

      await registerAssertion({
        organizationId: orgId,
        dossierId,
        partyId,
        configurationVersionId: configVersionId,
        field: 'razon_social',
        value: 'Empresa corregida S.A.S.',
        origin: 'declared',
      });

      const hashAfter = await computeDossierContentHash(orgId, dossierId);
      expect(hashAfter).not.toBe(hashBefore);
    });

    it('cambia si cambia el hash de un documento vigente', async () => {
      const { dossierId } = await createTestDossier({ level: 1, identificationNumber: '900000003' });
      const hashBefore = await computeDossierContentHash(orgId, dossierId);

      // El dossier ya está en 'documentos_recibidos' (confirmDocumentUpload exige
      // 'en_diligenciamiento') — se inserta la nueva versión directo para aislar lo que
      // este test verifica (que el hash reacciona a un documento distinto), sin reabrir
      // el flujo completo de subida.
      await adminSql`
        INSERT INTO public.documents
          (organization_id, dossier_id, document_type, version, storage_path, hash, size, format, uploaded_by_type)
        VALUES (
          ${orgId}::uuid, ${dossierId}::uuid, 'doc_rut', 2,
          ${dossierId + '/doc_rut/rut-v2.pdf'}, 'hash-900000003-v2', 2048, 'pdf', 'counterparty'
        )
      `;

      const hashAfter = await computeDossierContentHash(orgId, dossierId);
      expect(hashAfter).not.toBe(hashBefore);
    });
  });

  describe('signDossier — nivel 1', () => {
    it('firma directo sin exigir OTP', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 1, identificationNumber: '900000010' });

      const result = await signDossier({
        organizationId: orgId,
        dossierId,
        partyId,
        ipAddress: '203.0.113.10',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');

      const [row] = await adminSql`
        SELECT level, status, ip_address, content_hash FROM public.signatures WHERE id = ${result.signatureId}::uuid
      `;
      expect(row.level).toBe(1);
      expect(row.status).toBe('active');
      expect(row.ip_address).toBe('203.0.113.10');
      expect(row.content_hash).toBeTruthy();

      const [auditRow] = await adminSql`
        SELECT action FROM public.audit_log
        WHERE organization_id = ${orgId} AND entity_id = ${dossierId} AND action = 'dossier.signed'
      `;
      expect(auditRow).toBeDefined();
    });

    it('es idempotente: firmar de nuevo sin cambios retorna la misma firma', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 1, identificationNumber: '900000011' });

      const first = await signDossier({
        organizationId: orgId,
        dossierId,
        partyId,
        ipAddress: '203.0.113.11',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });
      expect(first.success).toBe(true);

      const second = await signDossier({
        organizationId: orgId,
        dossierId,
        partyId,
        ipAddress: '203.0.113.11',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });
      expect(second.success).toBe(true);
      if (!first.success || !second.success) throw new Error('expected success');
      expect(second.signatureId).toBe(first.signatureId);

      const rows = await adminSql`
        SELECT id FROM public.signatures WHERE dossier_id = ${dossierId}::uuid AND status = 'active'
      `;
      expect(rows.length).toBe(1);
    });
  });

  describe('signDossier — nivel 2 (OTP)', () => {
    it('sin otpCode retorna error y no inserta ninguna firma', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 2, identificationNumber: '900000020' });

      const result = await signDossier({
        organizationId: orgLevel2Id,
        dossierId,
        partyId,
        ipAddress: '203.0.113.20',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });

      expect(result.success).toBe(false);
      const rows = await adminSql`SELECT id FROM public.signatures WHERE dossier_id = ${dossierId}::uuid`;
      expect(rows.length).toBe(0);
    });

    it('con otpCode inválido retorna error y no inserta ninguna firma', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 2, identificationNumber: '900000021' });

      const link = await issueAccessLink({
        organizationId: orgLevel2Id,
        dossierId,
        issuedBy: adminLevel2Id,
        requiresSecondFactor: false,
        recipientEmail: 'contraparte-900000021@test-hu022.com',
      });

      const result = await signDossier({
        organizationId: orgLevel2Id,
        dossierId,
        partyId,
        ipAddress: '203.0.113.21',
        accessTokenId: link.id,
        otpCode: '000000',
      });

      expect(result.success).toBe(false);
      const rows = await adminSql`SELECT id FROM public.signatures WHERE dossier_id = ${dossierId}::uuid`;
      expect(rows.length).toBe(0);
    });

    it('con otpCode válido firma correctamente y registra el factor adicional', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 2, identificationNumber: '900000022' });

      const link = await issueAccessLink({
        organizationId: orgLevel2Id,
        dossierId,
        issuedBy: adminLevel2Id,
        requiresSecondFactor: false,
        recipientEmail: 'contraparte-900000022@test-hu022.com',
      });

      const rawCode = '654321';
      const codeHash = (await import('crypto')).createHash('sha256').update(rawCode).digest('hex');
      await adminSql`
        INSERT INTO public.dossier_access_otp_codes
          (organization_id, dossier_id, access_token_id, code_hash, expires_at, attempts, purpose)
        VALUES (
          ${orgLevel2Id}::uuid, ${dossierId}::uuid, ${link.id}::uuid, ${codeHash},
          now() + interval '15 minutes', 0, 'signature'
        )
      `;

      const result = await signDossier({
        organizationId: orgLevel2Id,
        dossierId,
        partyId,
        ipAddress: '203.0.113.22',
        accessTokenId: link.id,
        otpCode: rawCode,
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');

      const [row] = await adminSql`
        SELECT level, status, additional_factor FROM public.signatures WHERE id = ${result.signatureId}::uuid
      `;
      expect(row.level).toBe(2);
      expect(row.status).toBe('active');
      expect(row.additional_factor).toBeTruthy();
      expect(row.additional_factor.method).toBe('otp_email');
      expect(row.additional_factor.verifiedAt).toBeTruthy();
    });
  });

  describe('createDraftConfiguration — rechazo de nivel 3', () => {
    it('lanza un error de dominio antes de llegar al CHECK constraint', async () => {
      await expect(
        createDraftConfiguration({
          organizationId: orgId,
          standard: 'SARLAFT',
          signatureLevelRequired: 3,
        }),
      ).rejects.toThrow(/proveedor externo/i);
    });
  });

  describe('invalidateActiveSignatureIfContentChanged', () => {
    it('invalida la firma activa cuando el contenido cambió', async () => {
      const { dossierId, partyId, configVersionId } = await createTestDossier({
        level: 1,
        identificationNumber: '900000030',
      });

      const signed = await signDossier({
        organizationId: orgId,
        dossierId,
        partyId,
        ipAddress: '203.0.113.30',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });
      expect(signed.success).toBe(true);

      await registerAssertion({
        organizationId: orgId,
        dossierId,
        partyId,
        configurationVersionId: configVersionId,
        field: 'razon_social',
        value: 'Empresa modificada tras firmar',
        origin: 'declared',
      });

      await invalidateActiveSignatureIfContentChanged(orgId, dossierId);

      if (!signed.success) throw new Error('expected success');
      const [row] = await adminSql`
        SELECT status, invalidated_at, invalidated_reason FROM public.signatures WHERE id = ${signed.signatureId}::uuid
      `;
      expect(row.status).toBe('invalid');
      expect(row.invalidated_at).toBeTruthy();
      expect(row.invalidated_reason).toBeTruthy();

      const [auditRow] = await adminSql`
        SELECT action FROM public.audit_log
        WHERE organization_id = ${orgId} AND entity_id = ${dossierId} AND action = 'dossier.signature_invalidated'
      `;
      expect(auditRow).toBeDefined();
    });

    it('no toca la firma si el contenido no cambió (no-op)', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 1, identificationNumber: '900000031' });

      const signed = await signDossier({
        organizationId: orgId,
        dossierId,
        partyId,
        ipAddress: '203.0.113.31',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });
      expect(signed.success).toBe(true);
      if (!signed.success) throw new Error('expected success');

      await invalidateActiveSignatureIfContentChanged(orgId, dossierId);

      const [row] = await adminSql`
        SELECT status, invalidated_at FROM public.signatures WHERE id = ${signed.signatureId}::uuid
      `;
      expect(row.status).toBe('active');
      expect(row.invalidated_at).toBeNull();
    });

    it('es un no-op barato cuando no hay firma activa', async () => {
      const { dossierId } = await createTestDossier({ level: 1, identificationNumber: '900000032' });
      // No debe lanzar ni hacer nada, simplemente retornar
      await expect(invalidateActiveSignatureIfContentChanged(orgId, dossierId)).resolves.toBeUndefined();
    });
  });

  describe('ensureReviewEntryTransition — guard de firma', () => {
    it('no promueve a en_revision si no hay firma activa', async () => {
      const { dossierId } = await createTestDossier({ level: 1, identificationNumber: '900000040' });

      await ensureReviewEntryTransition(orgId, dossierId);

      const [row] = await adminSql`SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid`;
      expect(row.state).toBe('documentos_recibidos');
    });

    it('promueve a en_revision una vez que existe una firma activa', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 1, identificationNumber: '900000041' });

      const signed = await signDossier({
        organizationId: orgId,
        dossierId,
        partyId,
        ipAddress: '203.0.113.41',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });
      expect(signed.success).toBe(true);

      await ensureReviewEntryTransition(orgId, dossierId);

      const [row] = await adminSql`SELECT state FROM public.dossiers WHERE id = ${dossierId}::uuid`;
      expect(row.state).toBe('en_revision');
    });
  });

  describe('Aislamiento entre organizaciones', () => {
    it('getDossierSignatureStatus y las firmas no cruzan organizaciones', async () => {
      const { dossierId, partyId } = await createTestDossier({ level: 1, identificationNumber: '900000050' });
      const signed = await signDossier({
        organizationId: orgId,
        dossierId,
        partyId,
        ipAddress: '203.0.113.50',
        accessTokenId: '00000000-0000-0000-0000-000000000000',
      });
      expect(signed.success).toBe(true);
      if (!signed.success) throw new Error('expected success');

      // Beta no debe poder ver la firma de Alfa con su propio contexto de usuario
      const visibleInBeta = await withTenantContext(
        { userId: adminBetaId, organizationId: orgBetaId },
        async (tx) => {
          return tx.execute<{ id: string }>(
            sql`SELECT id FROM public.signatures WHERE id = ${signed.signatureId}::uuid`,
          );
        },
      );
      expect(visibleInBeta.length).toBe(0);

      // getDossierSignatureStatus con el organizationId de Beta sobre un dossier de Alfa
      // debe fallar (expediente no encontrado), nunca devolver datos de Alfa.
      await expect(getDossierSignatureStatus(orgBetaId, dossierId)).rejects.toThrow();
    });
  });
});
