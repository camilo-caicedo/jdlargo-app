import { eq, and, sql } from 'drizzle-orm';
import { db, DrizzleClient, DatabaseTransaction } from '../db/client';
import { dossiers, parties, memberships } from '../db/schema';
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
        field: 'declared_name',
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