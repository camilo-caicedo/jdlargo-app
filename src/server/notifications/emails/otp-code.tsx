import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Section,
  Hr,
} from '@react-email/components';

export interface OtpCodeEmailProps {
  code: string;
  dossierCode: string;
}

export function OtpCodeEmail({ code, dossierCode }: OtpCodeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', backgroundColor: '#f9fafb', padding: '24px' }}>
        <Container style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px', maxWidth: '500px' }}>
          <Heading style={{ fontSize: '20px', color: '#111827', marginBottom: '16px' }}>
            Código de verificación
          </Heading>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            Use el siguiente código para acceder al expediente <strong>{dossierCode}</strong>:
          </Text>
          <Section style={{ textAlign: 'center', margin: '24px 0', backgroundColor: '#f3f4f6', borderRadius: '6px', padding: '16px' }}>
            <Text style={{ fontSize: '28px', fontWeight: 'bold', letterSpacing: '4px', color: '#111827', margin: 0 }}>
              {code}
            </Text>
          </Section>
          <Text style={{ fontSize: '12px', color: '#6b7280', lineHeight: '18px' }}>
            Este código vence en 15 minutos y solo puede ser usado una vez.
          </Text>
          <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />
          <Text style={{ fontSize: '12px', color: '#9ca3af' }}>
            Si usted no solicitó este código, ignore este mensaje.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default OtpCodeEmail;
