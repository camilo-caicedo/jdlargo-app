import dns from 'dns';
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createOrganizationWithAdmin, grantMembership } from '../organizations/use-cases';
import { seedBaseConfiguration, publishConfigurationVersion, BASE_ROLES_TEMPLATE } from '../auth/role-config';
import { getActiveConfiguration } from '../configuration/service';
import { withTenantContext } from '../db/client';
import {
  createDossierShell,
  executeTransition,
  getDossierHistory,
  listValidTransitionsFrom,
} from './state-machine';

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

async function setupTestOrg(adminUser: string, orgName: string) {
  const org = await createOrganizationWithAdmin(adminUser, { name: orgName });
  await seedBaseConfiguration(org.id, adminUser);

  // Grant admin role dossier:edit and dossier:approve permissions for state machine tests
  const customRoles = BASE_ROLES_TEMPLATE.map((r) => {
    if (r.code === 'admin') {
      return {
        ...r,
        permissions: [...r.permissions, 'dossier:edit' as const, 'dossier:approve' as const],
      };
    }
    return { ...r, permissions: [...r.permissions] };
  });

  await publishConfigurationVersion({
    organizationId: org.id,
    publishedBy: adminUser,
    reason: 'Habilitar permisos operativos de expediente para admin en pruebas',
    rolesConfig: customRoles,
  });

  const activeConfig = await getActiveConfiguration(org.id);
  return { org, activeConfig: activeConfig! };
}

async function cleanupTestData() {
  await new Promise((r) => setTimeout(r, 100));
  await adminSql`SET app.allow_config_cleanup = 'true'`;
  await adminSql`DELETE FROM public.audit_log`;
  await adminSql`ALTER TABLE public.memberships DISABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.memberships`;
  await adminSql`ALTER TABLE public.memberships ENABLE TRIGGER trg_prevent_removing_last_admin`;
  await adminSql`DELETE FROM public.dossier_transitions`;
  await adminSql`DELETE FROM public.dossiers`;
  await adminSql`DELETE FROM public.requirements`;
  await adminSql`DELETE FROM public.counterparty_types`;
  await adminSql`DELETE FROM public.role_permissions`;
  await adminSql`DELETE FROM public.roles`;
  await adminSql`DELETE FROM public.configuration_versions`;
  await adminSql`DELETE FROM public.organizations`;
  await adminSql`DELETE FROM public.users`;
  await adminSql`DELETE FROM auth.users WHERE email LIKE '%@test-hu009.com'`;
  await adminSql`RESET app.allow_config_cleanup`;
}

describe('HU-009: Máquina de estados del expediente', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await adminSql.end();
  });

  it('Escenario: Una transición válida avanza el expediente y deja registro', async () => {
    const adminUser = await createTestAuthUser('admin1@test-hu009.com', 'Admin Org 1');
    const { org, activeConfig } = await setupTestOrg(adminUser, 'Dossier Transition Org');

    // Crear shell del expediente (estado inicial 'borrador')
    const dossier = await createDossierShell({
      organizationId: org.id,
      configurationVersionId: activeConfig.id,
    });
    expect(dossier.state).toBe('borrador');

    // Avanzar borrador -> enviada -> en_diligenciamiento
    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUser,
    });

    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'en_diligenciamiento',
      actorType: 'user',
      actorId: adminUser,
    });

    // Ejecutar transición válida: en_diligenciamiento -> documentos_recibidos
    const record = await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'documentos_recibidos',
      actorType: 'user',
      actorId: adminUser,
      reason: 'Todos los documentos fueron cargados por la contraparte',
    });

    expect(record.fromState).toBe('en_diligenciamiento');
    expect(record.toState).toBe('documentos_recibidos');
    expect(record.actorId).toBe(adminUser);
    expect(record.reason).toBe('Todos los documentos fueron cargados por la contraparte');

    // Verificar en base de datos
    const [dossierInDb] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}::uuid
    `;
    expect(dossierInDb.state).toBe('documentos_recibidos');

    // Aparece en la bitácora del expediente
    const history = await getDossierHistory(org.id, dossier.id);
    expect(history).toHaveLength(3);
    expect(history[2].toState).toBe('documentos_recibidos');
  }, 30000);

  it('Escenario: Una transición no declarada es rechazada', async () => {
    const adminUser = await createTestAuthUser('admin2@test-hu009.com', 'Admin Org 2');
    const { org, activeConfig } = await setupTestOrg(adminUser, 'Invalid Transition Org');

    const dossier = await createDossierShell({
      organizationId: org.id,
      configurationVersionId: activeConfig.id,
    });

    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUser,
    });

    // Intento inválido: enviada -> aprobada (salto no permitido)
    await expect(
      executeTransition({
        organizationId: org.id,
        dossierId: dossier.id,
        toState: 'aprobada',
        actorType: 'user',
        actorId: adminUser,
      })
    ).rejects.toThrow(/Transición no permitida|Invalid transition/);

    // El expediente permanece en 'enviada'
    const [dossierInDb] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}::uuid
    `;
    expect(dossierInDb.state).toBe('enviada');

    // La bitácora transversal o el historial conserva solo 1 transición
    const history = await getDossierHistory(org.id, dossier.id);
    expect(history).toHaveLength(1);
  }, 30000);

  it('Escenario: El estado no se puede cambiar por fuera de la máquina', async () => {
    const adminUser = await createTestAuthUser('admin3@test-hu009.com', 'Admin Org 3');
    const { org, activeConfig } = await setupTestOrg(adminUser, 'Direct Update Org');

    const dossier = await createDossierShell({
      organizationId: org.id,
      configurationVersionId: activeConfig.id,
    });

    // Intento directo de UPDATE de la columna state sin la bandera ni la máquina de estados
    await expect(
      adminSql`
        UPDATE public.dossiers
        SET state = 'aprobada'
        WHERE id = ${dossier.id}::uuid
      `
    ).rejects.toThrow(/Direct update of dossier state is forbidden/);

    // El estado sigue siendo 'borrador'
    const [dossierInDb] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}::uuid
    `;
    expect(dossierInDb.state).toBe('borrador');

    // No hay registro en transiciones
    const history = await getDossierHistory(org.id, dossier.id);
    expect(history).toHaveLength(0);
  }, 30000);

  it('Escenario: La historia del expediente es la lista de sus transiciones', async () => {
    const adminUser = await createTestAuthUser('admin4@test-hu009.com', 'Admin Org 4');
    const { org, activeConfig } = await setupTestOrg(adminUser, 'Dossier History Org');

    const dossier = await createDossierShell({
      organizationId: org.id,
      configurationVersionId: activeConfig.id,
    });

    // Secuencia de transiciones
    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: adminUser,
      reason: 'Enviada solicitud',
    });

    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'en_diligenciamiento',
      actorType: 'system',
      reason: 'Contraparte abrió el formulario',
    });

    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'documentos_recibidos',
      actorType: 'counterparty',
      reason: 'Carga de documentos finalizada',
    });

    const history = await getDossierHistory(org.id, dossier.id);
    expect(history).toHaveLength(3);

    // Secuencia continua sin huecos
    expect(history[0].fromState).toBe('borrador');
    expect(history[0].toState).toBe('enviada');
    expect(history[0].actorType).toBe('user');
    expect(history[0].actorId).toBe(adminUser);

    expect(history[1].fromState).toBe('enviada');
    expect(history[1].toState).toBe('en_diligenciamiento');
    expect(history[1].actorType).toBe('system');
    expect(history[1].actorId).toBeNull();

    expect(history[2].fromState).toBe('en_diligenciamiento');
    expect(history[2].toState).toBe('documentos_recibidos');
    expect(history[2].actorType).toBe('counterparty');
    expect(history[2].actorId).toBeNull();
  }, 30000);

  it('Escenario: Cada transición exige el permiso correspondiente', async () => {
    const adminUser = await createTestAuthUser('admin5@test-hu009.com', 'Admin Org 5');
    const analystUser = await createTestAuthUser('analyst5@test-hu009.com', 'Analyst Org 5');
    const { org, activeConfig } = await setupTestOrg(adminUser, 'Permission Transition Org');

    await grantMembership(adminUser, {
      organizationId: org.id,
      userId: analystUser,
      role: 'compliance_analyst', // No tiene dossier:approve en la configuración base
    });

    const dossier = await createDossierShell({
      organizationId: org.id,
      configurationVersionId: activeConfig.id,
    });

    // Avanzar hasta pendiente_de_decision
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'enviada', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_diligenciamiento', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'documentos_recibidos', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_revision', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'pendiente_de_decision', actorType: 'user', actorId: adminUser });

    // Intento de analista de aprobar (requiere dossier:approve)
    await expect(
      executeTransition({
        organizationId: org.id,
        dossierId: dossier.id,
        toState: 'aprobada',
        actorType: 'user',
        actorId: analystUser,
      })
    ).rejects.toThrow(/Acción no autorizada: falta el permiso 'dossier:approve'/);

    // El expediente conserva su estado 'pendiente_de_decision'
    const [dossierInDb] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}::uuid
    `;
    expect(dossierInDb.state).toBe('pendiente_de_decision');

    // Admin con dossier:approve sí puede aprobar
    await executeTransition({
      organizationId: org.id,
      dossierId: dossier.id,
      toState: 'aprobada',
      actorType: 'user',
      actorId: adminUser,
    });

    const [dossierApproved] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}::uuid
    `;
    expect(dossierApproved.state).toBe('aprobada');
  }, 30000);

  it('Escenario: Un estado final no admite salida', async () => {
    const adminUser = await createTestAuthUser('admin6@test-hu009.com', 'Admin Org 6');
    const { org, activeConfig } = await setupTestOrg(adminUser, 'Final State Org');

    const dossier = await createDossierShell({
      organizationId: org.id,
      configurationVersionId: activeConfig.id,
    });

    // Llevar hasta 'cerrada' (estado final)
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'enviada', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_diligenciamiento', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'documentos_recibidos', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'en_revision', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'pendiente_de_decision', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'aprobada', actorType: 'user', actorId: adminUser });
    await executeTransition({ organizationId: org.id, dossierId: dossier.id, toState: 'cerrada', actorType: 'user', actorId: adminUser });

    // Verificar que cerrada es final
    const transitionsFromClosed = await listValidTransitionsFrom('cerrada');
    expect(transitionsFromClosed).toHaveLength(0);

    // Intentar cualquier transición desde cerrada debe ser rechazada
    await expect(
      executeTransition({
        organizationId: org.id,
        dossierId: dossier.id,
        toState: 'en_revision',
        actorType: 'user',
        actorId: adminUser,
      })
    ).rejects.toThrow(/Transición no permitida|Cannot transition from a final state/);

    // El expediente conserva su estado 'cerrada'
    const [dossierInDb] = await adminSql<{ state: string }[]>`
      SELECT state FROM public.dossiers WHERE id = ${dossier.id}::uuid
    `;
    expect(dossierInDb.state).toBe('cerrada');
  }, 30000);

  it('Escenario: Aislamiento entre organizaciones sobre estados y transiciones', async () => {
    const userAlfa = await createTestAuthUser('user-alfa@test-hu009.com', 'User Alfa');
    const userBeta = await createTestAuthUser('user-beta@test-hu009.com', 'User Beta');

    const { org: orgAlfa, activeConfig: configAlfa } = await setupTestOrg(userAlfa, 'Alfa Dossiers Org');
    const { org: orgBeta } = await setupTestOrg(userBeta, 'Beta Dossiers Org');

    const dossierAlfa = await createDossierShell({
      organizationId: orgAlfa.id,
      configurationVersionId: configAlfa.id,
    });

    await executeTransition({
      organizationId: orgAlfa.id,
      dossierId: dossierAlfa.id,
      toState: 'enviada',
      actorType: 'user',
      actorId: userAlfa,
    });

    // 1. Consulta con contexto de usuario Alfa sólo ve su expediente e historia
    const historyAlfa = await withTenantContext(
      { userId: userAlfa, organizationId: orgAlfa.id },
      async (tx) => {
        return getDossierHistory(orgAlfa.id, dossierAlfa.id, tx);
      }
    );
    expect(historyAlfa).toHaveLength(1);

    // 2. Consulta con contexto de usuario Beta hacia expediente de Alfa devuelve vacío
    const betaReadingAlfa = await withTenantContext(
      { userId: userBeta, organizationId: orgBeta.id },
      async (tx) => {
        return getDossierHistory(orgAlfa.id, dossierAlfa.id, tx);
      }
    );
    expect(betaReadingAlfa).toHaveLength(0);

    // 3. Intento de ejecutar transición sobre expediente de Alfa con contexto de Beta es rechazado
    await expect(
      withTenantContext(
        { userId: userBeta, organizationId: orgBeta.id },
        async (tx) => {
          return executeTransition(
            {
              organizationId: orgAlfa.id,
              dossierId: dossierAlfa.id,
              toState: 'en_diligenciamiento',
              actorType: 'user',
              actorId: userBeta,
            },
            tx,
          );
        }
      )
    ).rejects.toThrow();
  }, 30000);
});