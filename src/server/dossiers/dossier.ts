import { eq, and, sql, desc } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { dossiers, parties, memberships, counterpartyTypes, users, assertions, configurationVersions } from '../db/schema';
import { enforceUserPermission } from '../auth/access-control';
import { logAuditEvent } from '../audit/service';
import { getActiveConfiguration } from '../configuration/service';
import {
  listCounterpartyTypes,
  getRequirementsForType,
  type RequirementDetail,
} from '../configuration/requirement-matrix';
import { createDossierShell } from './state-machine';
import { registerAssertion } from '../assertions/service';

export interface CreateDossierRequestInput {
  organizationId: string;
  requestedBy: string;
  counterpartyTypeName: string;
  party: {
    identificationType: string;
    identificationNumber: string;
    declaredName: string;
  };
  internalOwnerId: string;
  deadline?: Date;
}

export interface DossierDetail {
  id: string;
  code: string;
  organizationId: string;
  partyId: string;
  counterpartyTypeId: string;
  standard: string;
  configurationVersionId: string;
  internalOwnerId: string;
  deadline: Date | null;
  state: string;
  createdAt: Date;
}

/**
 * Creates a new dossier request: validates permissions, active config, counterparty type,
 * internal owner membership and deadline; finds or creates the party; creates the dossier shell
 * in 'borrador'; decorates the dossier; registers declared name assertion; and logs audit trail.
 */
export async function createDossierRequest(
  input: CreateDossierRequestInput,
  txClient?: DrizzleClient,
): Promise<DossierDetail> {
  const client = txClient || db;

  // 1. Active configuration version lookup (must be published)
  const activeVersion = await getActiveConfiguration(input.organizationId, client);
  if (!activeVersion) {
    throw new Error('No hay configuración vigente publicada para la organización');
  }

  // 2. Enforce permission BEFORE starting business transaction so denials get audited
  await enforceUserPermission(
    {
      userId: input.requestedBy,
      organizationId: input.organizationId,
    },
    'dossier:create',
    {
      counterpartyTypeName: input.counterpartyTypeName,
      partyIdentificationType: input.party.identificationType,
      partyIdentificationNumber: input.party.identificationNumber,
    },
    txClient,
  );

  // 3. Counterparty type validation in active configuration version
  const types = await listCounterpartyTypes(input.organizationId, activeVersion.id, client);
  const matchedType = types.find(
    (t) => t.name.toLowerCase() === input.counterpartyTypeName.toLowerCase(),
  );

  if (!matchedType) {
    throw new Error(
      `El tipo de contraparte '${input.counterpartyTypeName}' no existe en la versión de configuración vigente`,
    );
  }

  // 4. Verify internal owner is active member of the organization
  const [ownerMember] = await client
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.userId, input.internalOwnerId),
        eq(memberships.status, 'active'),
      ),
    )
    .limit(1);

  if (!ownerMember) {
    throw new Error(
      'El responsable interno debe ser un miembro activo de la organización',
    );
  }

  // 5. Verify deadline is in the future if provided
  if (input.deadline && input.deadline.getTime() <= Date.now()) {
    throw new Error('La fecha límite debe ser una fecha futura');
  }

  // 6. Execute atomic creation within a database transaction
  const execute = async (tx: DatabaseTransaction): Promise<DossierDetail> => {
    // 6a. Find-or-create party by (organizationId, identificationType, identificationNumber)
    const [existingParty] = await tx
      .select()
      .from(parties)
      .where(
        and(
          eq(parties.organizationId, input.organizationId),
          eq(parties.identificationType, input.party.identificationType),
          eq(parties.identificationNumber, input.party.identificationNumber),
        ),
      )
      .limit(1);

    let partyId = existingParty?.id;

    if (!partyId) {
      const [newParty] = await tx
        .insert(parties)
        .values({
          organizationId: input.organizationId,
          identificationType: input.party.identificationType,
          identificationNumber: input.party.identificationNumber,
        })
        .returning();
      partyId = newParty.id;
    }

    // 6b. Generate correlative code for this organization
    const countResult = await tx
      .select({ count: sql<string>`count(*)` })
      .from(dossiers)
      .where(eq(dossiers.organizationId, input.organizationId));

    const nextIndex = Number(countResult[0]?.count || 0) + 1;
    const formattedCode = `EXP-${String(nextIndex).padStart(6, '0')}`;

    // 6c. Create minimal dossier shell in 'borrador'
    const shell = await createDossierShell(
      {
        organizationId: input.organizationId,
        configurationVersionId: activeVersion.id,
      },
      tx,
    );

    // 6d. Decorate dossier with business attributes (without modifying state)
    const standardToUse = activeVersion.standard || 'SARLAFT';

    const [updatedDossier] = await tx
      .update(dossiers)
      .set({
        code: formattedCode,
        partyId,
        counterpartyTypeId: matchedType.id,
        standard: standardToUse,
        internalOwnerId: input.internalOwnerId,
        deadline: input.deadline || null,
      })
      .where(
        and(
          eq(dossiers.id, shell.id),
          eq(dossiers.organizationId, input.organizationId),
        ),
      )
      .returning();

    // 6e. Register declared name assertion with origin 'declared'
    await registerAssertion(
      {
        organizationId: input.organizationId,
        dossierId: shell.id,
        partyId,
        configurationVersionId: activeVersion.id,
        field: 'party.declared_name',
        value: input.party.declaredName,
        origin: 'declared',
        producedBy: input.requestedBy,
      },
      tx,
    );

    // 6f. Log audit event
    await logAuditEvent(
      {
        organizationId: input.organizationId,
        action: 'dossier.created',
        entity: 'dossier',
        entityId: shell.id,
        actorType: 'user',
        actorUserId: input.requestedBy,
        configurationVersionId: activeVersion.id,
        metadata: {
          code: formattedCode,
          party_id: partyId,
          counterparty_type_id: matchedType.id,
          counterparty_type_name: input.counterpartyTypeName,
          standard: standardToUse,
        },
        origin: { actor: 'user', action: 'createDossierRequest' },
      },
      tx,
    );

    return {
      id: updatedDossier.id,
      code: updatedDossier.code!,
      organizationId: updatedDossier.organizationId,
      partyId: updatedDossier.partyId!,
      counterpartyTypeId: updatedDossier.counterpartyTypeId!,
      standard: updatedDossier.standard!,
      configurationVersionId: updatedDossier.configurationVersionId,
      internalOwnerId: updatedDossier.internalOwnerId!,
      deadline: updatedDossier.deadline,
      state: updatedDossier.state,
      createdAt: updatedDossier.createdAt,
    };
  };

  if (txClient) {
    return execute(txClient as DatabaseTransaction);
  }
  return db.transaction(execute);
}

export interface UpdateDossierAdministrativeDataInput {
  organizationId: string;
  dossierId: string;
  updatedBy: string;
  internalOwnerId?: string;
  deadline?: Date | null;
}

/**
 * Updates administrative data of a dossier (internalOwnerId, deadline).
 * Enforces 'dossier:edit' permission, verifies dossier exists and is not 'cerrada',
 * validates active membership if owner is changed, and logs an audit trail event.
 */
export async function updateDossierAdministrativeData(
  input: UpdateDossierAdministrativeDataInput,
  txClient?: DrizzleClient,
): Promise<DossierDetail> {
  const client = txClient || db;

  // 1. Enforce permission BEFORE modifying so rejections get audited
  await enforceUserPermission(
    {
      userId: input.updatedBy,
      organizationId: input.organizationId,
    },
    'dossier:edit',
    {
      dossierId: input.dossierId,
      internalOwnerId: input.internalOwnerId,
      deadline: input.deadline ? input.deadline.toISOString() : input.deadline,
    },
    txClient,
  );

  // 2. Fetch existing dossier
  const [existingDossier] = await client
    .select()
    .from(dossiers)
    .where(
      and(
        eq(dossiers.organizationId, input.organizationId),
        eq(dossiers.id, input.dossierId),
      ),
    )
    .limit(1);

  if (!existingDossier) {
    throw new Error('Expediente no encontrado');
  }

  // 3. Dossier in 'cerrada' cannot be modified
  if (existingDossier.state === 'cerrada') {
    throw new Error('Un expediente cerrado no se puede editar');
  }

  // 4. Validate internalOwnerId if provided
  if (input.internalOwnerId !== undefined) {
    const [ownerMember] = await client
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, input.internalOwnerId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);

    if (!ownerMember) {
      throw new Error(
        'El responsable interno debe ser un miembro activo de la organización',
      );
    }
  }

  const execute = async (tx: DatabaseTransaction): Promise<DossierDetail> => {
    const updates: Partial<{
      internalOwnerId: string;
      deadline: Date | null;
    }> = {};

    const previousValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    if (
      input.internalOwnerId !== undefined &&
      input.internalOwnerId !== existingDossier.internalOwnerId
    ) {
      updates.internalOwnerId = input.internalOwnerId;
      previousValue.internalOwnerId = existingDossier.internalOwnerId;
      newValue.internalOwnerId = input.internalOwnerId;
    }

    if (input.deadline !== undefined) {
      const oldTime = existingDossier.deadline ? existingDossier.deadline.getTime() : null;
      const newTime = input.deadline ? input.deadline.getTime() : null;
      if (oldTime !== newTime) {
        updates.deadline = input.deadline;
        previousValue.deadline = existingDossier.deadline
          ? existingDossier.deadline.toISOString()
          : null;
        newValue.deadline = input.deadline ? input.deadline.toISOString() : null;
      }
    }

    let updated = existingDossier;

    if (Object.keys(updates).length > 0) {
      const [result] = await tx
        .update(dossiers)
        .set(updates)
        .where(
          and(
            eq(dossiers.id, existingDossier.id),
            eq(dossiers.organizationId, input.organizationId),
          ),
        )
        .returning();

      updated = result;

      await logAuditEvent(
        {
          organizationId: input.organizationId,
          action: 'dossier.updated',
          entity: 'dossier',
          entityId: existingDossier.id,
          actorType: 'user',
          actorUserId: input.updatedBy,
          configurationVersionId: existingDossier.configurationVersionId,
          previousValue,
          newValue,
          origin: { actor: 'user', action: 'updateDossierAdministrativeData' },
        },
        tx,
      );
    }

    return {
      id: updated.id,
      code: updated.code!,
      organizationId: updated.organizationId,
      partyId: updated.partyId!,
      counterpartyTypeId: updated.counterpartyTypeId!,
      standard: updated.standard!,
      configurationVersionId: updated.configurationVersionId,
      internalOwnerId: updated.internalOwnerId!,
      deadline: updated.deadline,
      state: updated.state,
      createdAt: updated.createdAt,
    };
  };

  if (txClient) {
    return execute(txClient as DatabaseTransaction);
  }
  return db.transaction(execute);
}

/**
 * Derives pending requirements for a dossier based on the configuration version and counterparty
 * type frozen when the dossier was opened.
 */
export async function getDossierPendingRequirements(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<RequirementDetail[]> {
  const client = txClient || db;

  const [dossier] = await client
    .select()
    .from(dossiers)
    .where(
      and(
        eq(dossiers.organizationId, organizationId),
        eq(dossiers.id, dossierId),
      ),
    )
    .limit(1);

  if (!dossier) {
    throw new Error('Expediente no encontrado');
  }

  if (!dossier.counterpartyTypeId) {
    throw new Error('El expediente no tiene tipo de contraparte asignado');
  }

  return getRequirementsForType(
    organizationId,
    dossier.configurationVersionId,
    dossier.counterpartyTypeId,
    client,
  );
}

export interface DossierListItem {
  id: string;
  code: string;
  partyId: string;
  partyIdentificationType: string;
  partyIdentificationNumber: string;
  partyDeclaredName: string;
  counterpartyTypeName: string;
  standard: string;
  configurationVersionNumber?: string;
  internalOwnerId?: string | null;
  internalOwnerName: string | null;
  state: string;
  deadline: Date | null;
  createdAt: Date;
}

/**
 * Lists all dossiers for an organization with joined party, counterparty type, and owner information.
 */
export async function listDossiersForOrganization(
  organizationId: string,
  txClient?: DrizzleClient,
): Promise<DossierListItem[]> {
  const client = txClient || db;

  const rows = await client
    .select({
      id: dossiers.id,
      code: dossiers.code,
      partyId: dossiers.partyId,
      partyIdentificationType: parties.identificationType,
      partyIdentificationNumber: parties.identificationNumber,
      counterpartyTypeName: counterpartyTypes.name,
      standard: dossiers.standard,
      internalOwnerId: dossiers.internalOwnerId,
      internalOwnerName: users.name,
      state: dossiers.state,
      deadline: dossiers.deadline,
      createdAt: dossiers.createdAt,
    })
    .from(dossiers)
    .leftJoin(parties, eq(dossiers.partyId, parties.id))
    .leftJoin(counterpartyTypes, eq(dossiers.counterpartyTypeId, counterpartyTypes.id))
    .leftJoin(users, eq(dossiers.internalOwnerId, users.id))
    .where(eq(dossiers.organizationId, organizationId))
    .orderBy(desc(dossiers.createdAt));

  // Also query declared name assertion for each party/dossier
  const dossierIds = rows.map((r) => r.id);
  const declaredNamesMap = new Map<string, string>();

  if (dossierIds.length > 0) {
    const nameAssertions = await client
      .select({
        dossierId: assertions.dossierId,
        declaredName: assertions.value,
      })
      .from(assertions)
      .where(
        and(
          eq(assertions.organizationId, organizationId),
          eq(assertions.field, 'party.declared_name'),
        ),
      );

    for (const a of nameAssertions) {
      if (a.dossierId) {
        declaredNamesMap.set(a.dossierId, String(a.declaredName));
      }
    }
  }

  return rows.map((r) => ({
    id: r.id,
    code: r.code || 'SIN-CODIGO',
    partyId: r.partyId || '',
    partyIdentificationType: r.partyIdentificationType || '',
    partyIdentificationNumber: r.partyIdentificationNumber || '',
    partyDeclaredName: declaredNamesMap.get(r.id) || 'Contraparte',
    counterpartyTypeName: r.counterpartyTypeName || 'Sin tipo',
    standard: r.standard || 'SARLAFT',
    internalOwnerName: r.internalOwnerName,
    state: r.state,
    deadline: r.deadline,
    createdAt: r.createdAt,
  }));
}

/**
 * Returns full detail of a single dossier by ID with party, owner, and counterparty type.
 */
export async function getDossierById(
  organizationId: string,
  dossierId: string,
  txClient?: DrizzleClient,
): Promise<DossierListItem & { configurationVersionId: string } | null> {
  const client = txClient || db;

  const [row] = await client
    .select({
      id: dossiers.id,
      code: dossiers.code,
      partyId: dossiers.partyId,
      partyIdentificationType: parties.identificationType,
      partyIdentificationNumber: parties.identificationNumber,
      counterpartyTypeName: counterpartyTypes.name,
      standard: dossiers.standard,
      internalOwnerId: dossiers.internalOwnerId,
      internalOwnerName: users.name,
      state: dossiers.state,
      deadline: dossiers.deadline,
      configurationVersionId: dossiers.configurationVersionId,
      configurationVersionNumber: configurationVersions.versionNumber,
      createdAt: dossiers.createdAt,
    })
    .from(dossiers)
    .leftJoin(parties, eq(dossiers.partyId, parties.id))
    .leftJoin(counterpartyTypes, eq(dossiers.counterpartyTypeId, counterpartyTypes.id))
    .leftJoin(users, eq(dossiers.internalOwnerId, users.id))
    .leftJoin(configurationVersions, eq(dossiers.configurationVersionId, configurationVersions.id))
    .where(
      and(
        eq(dossiers.organizationId, organizationId),
        eq(dossiers.id, dossierId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const [nameAssertion] = await client
    .select({
      value: assertions.value,
    })
    .from(assertions)
    .where(
      and(
        eq(assertions.organizationId, organizationId),
        eq(assertions.dossierId, dossierId),
        eq(assertions.field, 'party.declared_name'),
      ),
    )
    .limit(1);

  return {
    id: row.id,
    code: row.code || 'SIN-CODIGO',
    partyId: row.partyId || '',
    partyIdentificationType: row.partyIdentificationType || '',
    partyIdentificationNumber: row.partyIdentificationNumber || '',
    partyDeclaredName: nameAssertion?.value ? String(nameAssertion.value) : 'Contraparte',
    counterpartyTypeName: row.counterpartyTypeName || 'Sin tipo',
    standard: row.standard || 'SARLAFT',
    configurationVersionNumber: row.configurationVersionNumber || undefined,
    internalOwnerId: row.internalOwnerId,
    internalOwnerName: row.internalOwnerName,
    state: row.state,
    deadline: row.deadline,
    configurationVersionId: row.configurationVersionId,
    createdAt: row.createdAt,
  };
}