import { z } from 'zod';

export const roleSchema = z.string().min(1, 'El rol no puede estar vacío');

function defaultSlugify(name: string): string {
  const base = name
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  return base ? `${base}-${randomSuffix}` : `org-${randomSuffix}`;
}

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'El nombre de la organización es obligatorio'),
  slug: z.string()
    .min(2, 'El identificador debe tener al menos 2 caracteres')
    .max(50, 'El identificador no puede superar 50 caracteres')
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Usa solo minúsculas, números y guiones (ej: mi-empresa)')
    .optional(),
  taxId: z.string().nullable().optional(),
  origin: z.record(z.string(), z.unknown()).nullable().optional(),
}).transform((data) => ({
  ...data,
  slug: data.slug || defaultSlugify(data.name),
}));

export const grantMembershipSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: roleSchema,
});

export const revokeMembershipSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;
export type GrantMembershipInput = z.infer<typeof grantMembershipSchema>;
export type RevokeMembershipInput = z.infer<typeof revokeMembershipSchema>;