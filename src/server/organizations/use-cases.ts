import { withUserContext } from '../db/client';
import { organizationsRepository } from './repository';
import {
  createOrganizationSchema,
  grantMembershipSchema,
  revokeMembershipSchema,
  type CreateOrganizationInput,
  type GrantMembershipInput,
  type RevokeMembershipInput,
} from './schema';
import type { Organization, Membership } from './types';

export class DomainError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Acceso denegado o no autorizado') {
    super(message, 'FORBIDDEN');
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 'NOT_FOUND');
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

interface DatabaseErrorLike {
  code?: string;
  message?: string;
  cause?: {
    code?: string;
    message?: string;
  };
}

export async function createOrganizationWithAdmin(
  callerUserId: string,
  input: CreateOrganizationInput,
): Promise<Organization> {
  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message || 'Datos inválidos');
  }

  return withUserContext(callerUserId, async (tx) => {
    try {
      return await organizationsRepository.createOrganizationWithAdmin(tx, parsed.data);
    } catch (err: unknown) {
      const dbErr = err as DatabaseErrorLike;
      const errorCode = dbErr?.code || dbErr?.cause?.code;
      const errorMessage = dbErr?.message || dbErr?.cause?.message || '';

      if (errorCode === '23505') {
        throw new DomainError('Ya existe una organización con ese identificador (slug)', 'DUPLICATE_ORG_SLUG');
      }
      if (errorCode === '42501' || errorMessage.includes('permission denied')) {
        throw new ForbiddenError('No tienes permisos para crear la organización');
      }
      throw err;
    }
  });
}

export async function grantMembership(
  callerUserId: string,
  input: GrantMembershipInput,
): Promise<Membership> {
  const parsed = grantMembershipSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message || 'Datos inválidos');
  }

  return withUserContext(callerUserId, async (tx) => {
    const callerMembership = await organizationsRepository.findMembership(
      tx,
      parsed.data.organizationId,
      callerUserId,
    );

    if (!callerMembership || callerMembership.role !== 'admin') {
      throw new ForbiddenError('Solo un administrador activo puede otorgar membresías');
    }

    try {
      const created = await organizationsRepository.grantMembership(tx, parsed.data);
      if (!created) {
        throw new DomainError('No se pudo otorgar la membresía', 'MEMBERSHIP_FAILED');
      }
      return created;
    } catch (err: unknown) {
      const dbErr = err as DatabaseErrorLike;
      if (dbErr?.code === '42501' || dbErr?.message?.includes('permission denied')) {
        throw new ForbiddenError('Permiso denegado por política de seguridad');
      }
      if (dbErr?.code === '23505') {
        throw new DomainError('El usuario ya cuenta con membresía activa en esta organización', 'DUPLICATE_MEMBERSHIP');
      }
      throw err;
    }
  });
}

export async function listMembers(
  callerUserId: string,
  organizationId: string,
) {
  return withUserContext(callerUserId, async (tx) => {
    const callerMembership = await organizationsRepository.findMembership(
      tx,
      organizationId,
      callerUserId,
    );

    if (!callerMembership) {
      throw new ForbiddenError('No tienes acceso a los miembros de esta organización');
    }

    try {
      return await organizationsRepository.listMembers(tx, organizationId);
    } catch (err: unknown) {
      const dbErr = err as DatabaseErrorLike;
      if (dbErr?.code === '42501' || dbErr?.message?.includes('permission denied')) {
        throw new ForbiddenError('Permiso denegado por política de seguridad');
      }
      throw err;
    }
  });
}

export async function revokeMembership(
  callerUserId: string,
  input: RevokeMembershipInput,
): Promise<Membership> {
  const parsed = revokeMembershipSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message || 'Datos inválidos');
  }

  return withUserContext(callerUserId, async (tx) => {
    const callerMembership = await organizationsRepository.findMembership(
      tx,
      parsed.data.organizationId,
      callerUserId,
    );

    if (!callerMembership || callerMembership.role !== 'admin') {
      throw new ForbiddenError('Solo un administrador activo puede revocar membresías');
    }

    try {
      const revoked = await organizationsRepository.revokeMembership(
        tx,
        parsed.data.organizationId,
        parsed.data.membershipId,
      );

      if (!revoked) {
        throw new NotFoundError('Membresía activa no encontrada');
      }

      return revoked;
    } catch (err: unknown) {
      const dbErr = err as DatabaseErrorLike;
      if (dbErr?.message?.includes('last active administrator')) {
        throw new DomainError('No es posible revocar al último administrador de la organización', 'CANNOT_REMOVE_LAST_ADMIN');
      }
      if (dbErr?.code === '42501' || dbErr?.message?.includes('permission denied')) {
        throw new ForbiddenError('Permiso denegado por política de seguridad');
      }
      throw err;
    }
  });
}

export interface ActiveMembershipSummary {
  organizationId: string;
  organizationName: string;
}

/**
 * Lists active organizations for the authenticated user using withUserContext.
 * Doesn't require an active tenant selection yet.
 */
export async function listActiveMembershipsForUser(
  userId: string,
): Promise<ActiveMembershipSummary[]> {
  return withUserContext(userId, async (tx) => {
    return organizationsRepository.listActiveMembershipsForUser(tx, userId);
  });
}