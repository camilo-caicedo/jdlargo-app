/**
 * Closed permission catalog (ADR-0004, PA-024, HU-003).
 *
 * The application code knows the SHAPE and closed list of available permissions,
 * but NEVER hardcodes which role possesses which permission.
 * Role-permission mappings are dynamic configuration data stored in the database.
 */

export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'review',
  'approve',
  'export',
  'configure',
  'administer',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_MODULES = [
  'dossier',
  'document',
  'alert',
  'risk_methodology',
  'audit',
  'configuration',
  'memberships',
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export type PermissionKey =
  | 'dossier:create'
  | 'dossier:view'
  | 'dossier:edit'
  | 'dossier:review'
  | 'dossier:approve'
  | 'dossier:export'
  | 'document:upload'
  | 'document:view'
  | 'document:review'
  | 'alert:view'
  | 'alert:resolve'
  | 'risk_methodology:view'
  | 'risk_methodology:edit'
  | 'audit:view'
  | 'configuration:view'
  | 'configuration:publish'
  | 'configuration:administer'
  | 'memberships:manage';

export const ALL_PERMISSIONS: readonly PermissionKey[] = [
  'dossier:create',
  'dossier:view',
  'dossier:edit',
  'dossier:review',
  'dossier:approve',
  'dossier:export',
  'document:upload',
  'document:view',
  'document:review',
  'alert:view',
  'alert:resolve',
  'risk_methodology:view',
  'risk_methodology:edit',
  'audit:view',
  'configuration:view',
  'configuration:publish',
  'configuration:administer',
  'memberships:manage',
] as const;

export function isValidPermission(key: string): key is PermissionKey {
  return (ALL_PERMISSIONS as readonly string[]).includes(key);
}
