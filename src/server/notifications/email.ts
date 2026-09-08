import { Resend } from 'resend';
import { AccessLinkEmail } from './emails/access-link';
import { OtpCodeEmail } from './emails/otp-code';
import { InvitationEmail } from './emails/invitation';
import { DossierRejectedEmail } from './emails/dossier-rejected';

const resendApiKey = process.env.RESEND_API_KEY;

export const resend = resendApiKey ? new Resend(resendApiKey) : null;

// Allow spying/intercepting sent emails in unit tests
export const mockSentEmails: Array<{
  type: 'access_link' | 'otp' | 'invitation' | 'dossier_rejected';
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
      from: 'JD Largo <notificaciones@jdlargo.com>',
      to: input.to,
      subject: `Acceso a su expediente de debida diligencia (${input.dossierCode})`,
      react: AccessLinkEmail({
        dossierCode: input.dossierCode,
        accessUrl: input.accessUrl,
        organizationName: input.organizationName,
      }),
    });
  } catch (error) {
    console.error('[sendAccessLinkEmail] Error sending email via Resend:', error);
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
      from: 'JD Largo <seguridad@jdlargo.com>',
      to: input.to,
      subject: `Código de verificación para expediente ${input.dossierCode}`,
      react: OtpCodeEmail({
        code: input.code,
        dossierCode: input.dossierCode,
      }),
    });
  } catch (error) {
    console.error('[sendOtpEmail] Error sending OTP email via Resend:', error);
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
      from: 'JD Largo <invitaciones@jdlargo.com>',
      to: input.to,
      subject: `Invitación para unirse a ${input.organizationName} en JD Largo`,
      react: InvitationEmail({
        organizationName: input.organizationName,
        invitationUrl: input.invitationUrl,
        roleName: input.roleName,
      }),
    });
  } catch (error) {
    console.error('[sendInvitationEmail] Error sending invitation email via Resend:', error);
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
      from: 'JD Largo <notificaciones@jdlargo.com>',
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
    console.error('[sendDossierRejectedEmail] Error sending dossier rejected email via Resend:', error);
  }
}

