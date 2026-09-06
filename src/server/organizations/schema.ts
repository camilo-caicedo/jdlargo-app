import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'compliance_analyst', 'auditor']);

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'El nombre de la organización es obligatorio'),
  taxId: z.string().nullable().optional(),
  origin: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const grantMembershipSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: roleSchema,
});

export const revokeMembershipSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type GrantMembershipInput = z.infer<typeof grantMembershipSchema>;
export type RevokeMembershipInput = z.infer<typeof revokeMembershipSchema>;