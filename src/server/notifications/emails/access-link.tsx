import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Link,
  Section,
  Button,
  Hr,
} from '@react-email/components';

export interface AccessLinkEmailProps {
  dossierCode: string;
  accessUrl: string;
  organizationName: string;
}

export function AccessLinkEmail({
  dossierCode,
  accessUrl,
  organizationName,
}: AccessLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', backgroundColor: '#f9fafb', padding: '24px' }}>
        <Container style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px', maxWidth: '500px' }}>
          <Heading style={{ fontSize: '20px', color: '#111827', marginBottom: '16px' }}>
            Solicitud de vinculación: {dossierCode}
          </Heading>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            <strong>{organizationName}</strong> le ha invitado a completar su información de debida diligencia en la plataforma JD Largo.
          </Text>
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button
              href={accessUrl}
              style={{
                backgroundColor: '#0f172a',
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Acceder al expediente
            </Button>
          </Section>
          <Text style={{ fontSize: '12px', color: '#6b7280', lineHeight: '18px' }}>
            Si el botón no funciona, copie y pegue el siguiente enlace en su navegador:
            <br />
            <Link href={accessUrl} style={{ color: '#2563eb' }}>{accessUrl}</Link>
          </Text>
          <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />
          <Text style={{ fontSize: '12px', color: '#9ca3af' }}>
            Este enlace es personal e intransferible. No lo comparta con terceros.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default AccessLinkEmail;
