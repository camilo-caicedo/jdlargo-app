import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, boolean, integer } from 'drizzle-orm/pg-core';
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
  slug: text('slug').notNull(),
  taxId: text('tax_id').unique(),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('organizations_slug_unique').on(t.slug),
]).enableRLS();

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

// audit_log — bitácora inmutable transversal (ADR-0007, HU-006)
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorType: text('actor_type', { enum: ['user', 'system', 'counterparty'] }).notNull().default('user'),
  actorDetails: jsonb('actor_details'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  requestOrigin: jsonb('request_origin'),
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  reason: text('reason'),
  source: text('source'),
  automatic: boolean('automatic').notNull().default(false),
  aiModel: jsonb('ai_model'),
  configurationVersionId: uuid('configuration_version_id').references(() => configurationVersions.id),
  eventHash: text('event_hash'),
  metadata: jsonb('metadata'),
  origin: jsonb('origin'),
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
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id),
  partyId: uuid('party_id').notNull().references(() => parties.id),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  field: text('field').notNull(),
  value: jsonb('value').notNull(),
  origin: text('origin', { enum: ['declared', 'extracted', 'verified', 'evaluated'] }).notNull(),
  producedBy: uuid('produced_by').references(() => users.id),
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

// counterparty_types — tipos de contraparte por versión de configuración (ADR-0004, HU-007)
export const counterpartyTypes = pgTable('counterparty_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  name: text('name').notNull(),
  nature: text('nature', { enum: ['natural_person', 'legal_entity'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('counterparty_types_org_ver_name_unique').on(t.organizationId, t.configurationVersionId, t.name),
]).enableRLS();

// requirements — matriz de requisitos por estándar y tipo de contraparte (ADR-0004, HU-007)
export const requirements = pgTable('requirements', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  counterpartyTypeId: uuid('counterparty_type_id').notNull().references(() => counterpartyTypes.id),
  standard: text('standard').notNull(),
  type: text('type', { enum: ['field', 'document_type'] }).notNull(),
  key: text('key').notNull(),
  mandatory: text('mandatory', { enum: ['always', 'conditional', 'optional'] }).notNull(),
  condition: jsonb('condition'),
  validation: jsonb('validation'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('requirements_org_ver_type_std_key_unique').on(
    t.organizationId,
    t.configurationVersionId,
    t.counterpartyTypeId,
    t.standard,
    t.type,
    t.key,
  ),
]).enableRLS();

// parties — el sujeto contraparte en la organización cliente (HU-008, §31, §37)
export const parties = pgTable('parties', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  identificationType: text('identification_type').notNull(),
  identificationNumber: text('identification_number').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('parties_org_id_type_num_unique').on(
    t.organizationId,
    t.identificationType,
    t.identificationNumber,
  ),
]).enableRLS();

// dossier_states — catálogo cerrado de estados de expedientes (HU-009, global del producto)
export const dossierStates = pgTable('dossier_states', {
  key: text('key').primaryKey(),
  isFinal: boolean('is_final').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

// valid_transitions — catálogo cerrado de transiciones de estado permitidas (HU-009, global del producto)
export const validTransitions = pgTable('valid_transitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  source: text('source').notNull().references(() => dossierStates.key),
  target: text('target').notNull().references(() => dossierStates.key),
  permission: text('permission').notNull(),
  requiresReason: boolean('requires_reason').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('valid_transitions_source_target_unique').on(t.source, t.target),
]).enableRLS();

// dossiers — envase del expediente (HU-009 envase mínimo, decorado en HU-008)
export const dossiers = pgTable('dossiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  code: text('code'),
  partyId: uuid('party_id').references(() => parties.id),
  counterpartyTypeId: uuid('counterparty_type_id').references(() => counterpartyTypes.id),
  standard: text('standard'),
  internalOwnerId: uuid('internal_owner_id').references(() => users.id),
  deadline: timestamp('deadline', { withTimezone: true }),
  state: text('state').notNull().default('borrador').references(() => dossierStates.key),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('dossiers_org_code_unique').on(t.organizationId, t.code),
]).enableRLS();

// dossier_transitions — bitácora de transiciones de expediente (HU-009)
export const dossierTransitions = pgTable('dossier_transitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id),
  fromState: text('from_state').notNull().references(() => dossierStates.key),
  toState: text('to_state').notNull().references(() => dossierStates.key),
  actorType: text('actor_type', { enum: ['user', 'system', 'counterparty'] }).notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  reason: text('reason'),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

// dossier_access_tokens — un enlace de acceso por expediente (HU-010)
export const dossierAccessTokens = pgTable('dossier_access_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id),
  tokenHash: text('token_hash').notNull(),          // sha256 del valor crudo — nunca se guarda el valor
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  state: text('state', { enum: ['active', 'expired', 'revoked', 'replaced'] }).notNull().default('active'),
  requiresSecondFactor: boolean('requires_second_factor').notNull().default(false),
  recipientEmail: text('recipient_email').notNull(),
  issuedBy: uuid('issued_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedBy: uuid('revoked_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('dossier_access_tokens_hash_unique').on(t.tokenHash),
  uniqueIndex('dossier_access_tokens_dossier_active_unique').on(t.dossierId).where(sql`state = 'active'`),
]).enableRLS();

// dossier_access_uses — cada intento de uso del enlace, otorgado o no (HU-010)
export const dossierAccessUses = pgTable('dossier_access_uses', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id),
  accessTokenId: uuid('access_token_id').references(() => dossierAccessTokens.id), // null si el token ni siquiera existía
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text('ip_address').notNull(),
  userAgent: text('user_agent').notNull(),
  result: text('result', { enum: ['granted', 'denied'] }).notNull(),
  denialReason: text('denial_reason'),
}).enableRLS();

// dossier_access_otp_codes — códigos de un solo uso (HU-010)
export const dossierAccessOtpCodes = pgTable('dossier_access_otp_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id),
  accessTokenId: uuid('access_token_id').notNull().references(() => dossierAccessTokens.id),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

// invitations — invitaciones de nuevos miembros a la organización (HU-056)
export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  email: text('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  state: text('state', { enum: ['pending', 'accepted', 'expired', 'revoked', 'replaced'] }).notNull().default('pending'),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('invitations_token_hash_unique').on(t.tokenHash),
  uniqueIndex('invitations_org_email_pending_unique').on(t.organizationId, t.email).where(sql`state = 'pending'`),
]).enableRLS();

// privacy_notices — aviso de privacidad, contenido de una versión de configuración (HU-011)
export const privacyNotices = pgTable('privacy_notices', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  configurationVersionId: uuid('configuration_version_id').notNull().references(() => configurationVersions.id),
  text: text('text').notNull(),
  purposes: jsonb('purposes').notNull(), // PrivacyNoticePurpose[]
  dataController: text('data_controller').notNull(),
  dataProcessor: text('data_processor').notNull(),
  rightsChannels: text('rights_channels').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('privacy_notices_org_version_unique').on(t.organizationId, t.configurationVersionId),
]).enableRLS();

// consents — evidencia inmutable de aceptación/no aceptación del aviso (HU-011)
export const consents = pgTable('consents', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id),
  privacyNoticeId: uuid('privacy_notice_id').notNull().references(() => privacyNotices.id),
  privacyNoticeTextSnapshot: text('privacy_notice_text_snapshot').notNull(), // copia literal, sobrevive a re-publicaciones
  result: text('result', { enum: ['accepted', 'not_accepted'] }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  channel: text('channel').notNull().default('portal'),
  ipAddress: text('ip_address').notNull(),
}, (t) => [
  uniqueIndex('consents_dossier_unique').on(t.dossierId),
]).enableRLS();

