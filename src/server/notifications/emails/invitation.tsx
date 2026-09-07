import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
  Heading,
} from '@react-email/components';

export interface InvitationEmailProps {
  organizationName: string;
  invitationUrl: string;
  roleName: string;
}

export function InvitationEmail({
  organizationName,
  invitationUrl,
  roleName,
}: InvitationEmailProps) {
  return (
    <Html lang="es">
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={title}>JD Largo</Heading>
            <Text style={subtitle}>Plataforma de Debida Diligencia</Text>
          </Section>

          <Section style={content}>
            <Text style={greeting}>Invitación de equipo</Text>
            <Text style={paragraph}>
              Ha sido invitado a unirse a la organización{' '}
              <strong>{organizationName}</strong> en el rol de{' '}
              <strong>{roleName}</strong>.
            </Text>

            <Section style={buttonContainer}>
              <Button style={button} href={invitationUrl}>
                Aceptar invitación y configurar acceso
              </Button>
            </Section>

            <Text style={footnote}>
              Este enlace es personal, seguro y tiene una vigencia de 7 días. Si usted
              no esperaba esta invitación, puede ignorar este mensaje.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              © {new Date().getFullYear()} JD Largo. Todos los derechos reservados.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f4f4f5',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
};

const container = {
  margin: '0 auto',
  padding: '40px 20px',
  maxWidth: '560px',
};

const header = {
  marginBottom: '24px',
};

const title = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#09090b',
  margin: '0',
};

const subtitle = {
  fontSize: '14px',
  color: '#71717a',
  margin: '4px 0 0',
};

const content = {
  backgroundColor: '#ffffff',
  padding: '32px',
  borderRadius: '12px',
  border: '1px solid #e4e4e7',
};

const greeting = {
  fontSize: '18px',
  fontWeight: '600',
  color: '#09090b',
  margin: '0 0 16px',
};

const paragraph = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#27272a',
  margin: '0 0 24px',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '24px 0',
};

const button = {
  backgroundColor: '#3730a3', // deep indigo
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
  display: 'inline-block',
};

const footnote = {
  fontSize: '12px',
  lineHeight: '18px',
  color: '#71717a',
  margin: '16px 0 0',
};

const hr = {
  borderColor: '#e4e4e7',
  margin: '24px 0',
};

const footer = {
  textAlign: 'center' as const,
};

const footerText = {
  fontSize: '12px',
  color: '#a1a1aa',
  margin: '0',
};