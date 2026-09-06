import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// users — perfil, vive por encima de las organizaciones
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // = auth.users.id, poblado por trigger, no por la app
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

// organizations
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  taxId: text('tax_id').unique(),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

// memberships
export const memberships = pgTable('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull(),
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('memberships_active_unique').on(t.organizationId, t.userId).where(sql`status = 'active'`),
]).enableRLS();

// audit_log — mínima, HU-006 la extiende
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  action: text('action').notNull(),
  metadata: jsonb('metadata'),
  origin: jsonb('origin'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

// configuration_versions — contenedor inmutable de versiones de configuración (ADR-0004, HU-004)
export const configurationVersions = pgTable('configuration_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  versionNumber: text('version_number').notNull(), // string or integer represented as text/num
  status: text('status', { enum: ['draft', 'published', 'replaced'] }).notNull().default('draft'),
  standard: text('standard').default('SARLAFT'),
  referenceRegulation: text('reference_regulation'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).defaultNow().notNull(),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('config_versions_org_num_unique').on(t.organizationId, t.versionNumber),
]).enableRLS();

// roles — configuración de roles de la organización por versión (ADR-0004, HU-003)
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('roles_org_version_code_unique').on(t.organizationId, t.configurationVersionId, t.code),
]).enableRLS();

// role_permissions — asignación de permisos por rol en cada versión (ADR-0004, HU-003)
export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  permissionKey: text('permission_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('role_permissions_unique').on(t.roleId, t.permissionKey),
]).enableRLS();

// assertions — afirmaciones con procedencia inmutables (ADR-0005, HU-005)
export const assertions = pgTable('assertions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  dossierId: uuid('dossier_id').notNull(),
  partyId: uuid('party_id').notNull(),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  field: text('field').notNull(),
  value: jsonb('value').notNull(),
  origin: text('origin', { enum: ['declared', 'extracted', 'verified', 'evaluated'] }).notNull(),
  producedBy: uuid('produced_by').notNull().references(() => users.id),
  producedAt: timestamp('produced_at', { withTimezone: true }).defaultNow().notNull(),
  evidenceId: text('evidence_id'),
  confidence: text('confidence'),
  aiModelMetadata: jsonb('ai_model_metadata'),
  status: text('status', { enum: ['active', 'discarded'] }).notNull().default('active'),
  resolutionNote: text('resolution_note'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();


