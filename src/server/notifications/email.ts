// TEMPORAL: jdlargo.com todavía no está verificado en Resend (https://resend.com/domains).
// Mientras tanto, los remitentes usan el dominio de pruebas resend.dev (auto-verificado).
// Revertir a @jdlargo.com en las 6 llamadas de abajo una vez el dominio real quede verificado.
import { Resend } from 'resend';
import { AccessLinkEmail } from './emails/access-link';
import { OtpCodeEmail } from './emails/otp-code';
import { InvitationEmail } from './emails/invitation';
import { DossierRejectedEmail } from './emails/dossier-rejected';
import { DossierExpirationReminderEmail } from './emails/dossier-expiration-reminder';
import { DossierExpirationEscalationEmail } from './emails/dossier-expiration-escalation';

const resendApiKey = process.env.RESEND_API_KEY;

export const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Allow spying/intercepting sent emails in unit tests
export const mockSentEmails: Array<{
  type: 'access_link' | 'otp' | 'invitation' | 'dossier_rejected' | 'expiration_reminder' | 'expiration_escalation';
  to: string;
  payload: Record<string, unknown>;
}> = [];

export interface SendAccessLinkEmailInput {
  to: string;
  dossierCode: string;
  accessUrl: string;
  organizationName: string;
}

export async function sendAccessLinkEmail(input: SendAccessLinkEmailInput): Promise<void> {
  if (process.env.NODE_ENV === 'test' || !resend) {
    mockSentEmails.push({
      type: 'access_link',
      to: input.to,
      payload: input as unknown as Record<string, unknown>,
    });
    return;
  }

  try {
    await resend.emails.send({
      from: 'JD Largo <notificaciones@resend.dev>',
      to: input.to,
      subject: `Acceso a su expediente de debida diligencia (${input.dossierCode})`,
      react: AccessLinkEmail({
        dossierCode: input.dossierCode,
        accessUrl: input.accessUrl,
        organizationName: input.organizationName,
      }),
    });
  } catch (error) {
    console.error('[sendAccessLinkEmail] Error sending email via Resend:', error instanceof Error ? error.message : error);
    // Best-effort: do not fail business operation if email provider is down
  }
}

export interface SendOtpEmailInput {
  to: string;
  code: string;
  dossierCode: string;
}

export async function sendOtpEmail(input: SendOtpEmailInput): Promise<void> {
  if (process.env.NODE_ENV === 'test' || !resend) {
    mockSentEmails.push({
      type: 'otp',
      to: input.to,
      payload: input as unknown as Record<string, unknown>,
    });
    return;
  }

  try {
    await resend.emails.send({
      from: 'JD Largo <seguridad@resend.dev>',
      to: input.to,
      subject: `Código de verificación para expediente ${input.dossierCode}`,
      react: OtpCodeEmail({
        code: input.code,
        dossierCode: input.dossierCode,
      }),
    });
  } catch (error) {
    console.error('[sendOtpEmail] Error sending OTP email via Resend:', error instanceof Error ? error.message : error);
  }
}

export interface SendInvitationEmailInput {
  to: string;
  organizationName: string;
  invitationUrl: string;
  roleName: string;
}

export async function sendInvitationEmail(input: SendInvitationEmailInput): Promise<void> {
  if (process.env.NODE_ENV === 'test' || !resend) {
    mockSentEmails.push({
      type: 'invitation',
      to: input.to,
      payload: input as unknown as Record<string, unknown>,
    });
    return;
  }

  try {
    await resend.emails.send({
      from: 'JD Largo <invitaciones@resend.dev>',
      to: input.to,
      subject: `Invitación para unirse a ${input.organizationName} en JD Largo`,
      react: InvitationEmail({
        organizationName: input.organizationName,
        invitationUrl: input.invitationUrl,
        roleName: input.roleName,
      }),
    });
  } catch (error) {
    console.error('[sendInvitationEmail] Error sending invitation email via Resend:', error instanceof Error ? error.message : error);
  }
}

export interface SendDossierRejectedEmailInput {
  to: string;
  ownerName?: string;
  dossierCode: string;
  partyDeclaredName: string;
  organizationName: string;
  rejectionReason: string;
}

export async function sendDossierRejectedEmail(input: SendDossierRejectedEmailInput): Promise<void> {
  if (process.env.NODE_ENV === 'test' || !resend) {
    mockSentEmails.push({
      type: 'dossier_rejected',
      to: input.to,
      payload: input as unknown as Record<string, unknown>,
    });
    return;
  }

  try {
    await resend.emails.send({
      from: 'JD Largo <notificaciones@resend.dev>',
      to: input.to,
      subject: `Expediente rechazado por la contraparte (${input.dossierCode})`,
      react: DossierRejectedEmail({
        ownerName: input.ownerName,
        dossierCode: input.dossierCode,
        partyDeclaredName: input.partyDeclaredName,
        organizationName: input.organizationName,
        rejectionReason: input.rejectionReason,
      }),
    });
  } catch (error) {
    console.error('[sendDossierRejectedEmail] Error sending dossier rejected email via Resend:', error instanceof Error ? error.message : error);
  }
}

export interface SendDossierExpirationReminderEmailInput {
  to: string;
  ownerName?: string;
  dossierCode: string;
  partyDeclaredName: string;
  organizationName: string;
  dossierUrl?: string;
}

export async function sendDossierExpirationReminderEmail(
  input: SendDossierExpirationReminderEmailInput,
): Promise<void> {
  if (process.env.NODE_ENV === 'test' || !resend) {
    mockSentEmails.push({
      type: 'expiration_reminder',
      to: input.to,
      payload: input as unknown as Record<string, unknown>,
    });
    return;
  }

  try {
    await resend.emails.send({
      from: 'JD Largo <notificaciones@resend.dev>',
      to: input.to,
      subject: `Enlace de acceso vencido (${input.dossierCode})`,
      react: DossierExpirationReminderEmail({
        ownerName: input.ownerName,
        dossierCode: input.dossierCode,
        partyDeclaredName: input.partyDeclaredName,
        organizationName: input.organizationName,
        dossierUrl: input.dossierUrl,
      }),
    });
  } catch (error) {
    console.error('[sendDossierExpirationReminderEmail] Error sending email via Resend:', error instanceof Error ? error.message : error);
  }
}

export interface SendDossierExpirationEscalationEmailInput {
  to: string;
  recipientName?: string;
  dossierCode: string;
  partyDeclaredName: string;
  organizationName: string;
  internalOwnerName?: string;
  dossierUrl?: string;
  reminderCount?: number;
}

export async function sendDossierExpirationEscalationEmail(
  input: SendDossierExpirationEscalationEmailInput,
): Promise<void> {
  if (process.env.NODE_ENV === 'test' || !resend) {
    mockSentEmails.push({
      type: 'expiration_escalation',
      to: input.to,
      payload: input as unknown as Record<string, unknown>,
    });
    return;
  }

  try {
    await resend.emails.send({
      from: 'JD Largo <notificaciones@resend.dev>',
      to: input.to,
      subject: `Aviso de escalación: Expediente sin reactivar (${input.dossierCode})`,
      react: DossierExpirationEscalationEmail({
        recipientName: input.recipientName,
        dossierCode: input.dossierCode,
        partyDeclaredName: input.partyDeclaredName,
        organizationName: input.organizationName,
        internalOwnerName: input.internalOwnerName,
        dossierUrl: input.dossierUrl,
        reminderCount: input.reminderCount,
      }),
    });
  } catch (error) {
    console.error('[sendDossierExpirationEscalationEmail] Error sending email via Resend:', error instanceof Error ? error.message : error);
  }
}


