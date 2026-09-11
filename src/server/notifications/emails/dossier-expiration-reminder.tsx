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
  Button,
} from '@react-email/components';

export interface DossierExpirationReminderEmailProps {
  ownerName?: string;
  dossierCode: string;
  partyDeclaredName: string;
  organizationName: string;
  dossierUrl?: string;
}

export function DossierExpirationReminderEmail({
  ownerName,
  dossierCode,
  partyDeclaredName,
  organizationName,
  dossierUrl,
}: DossierExpirationReminderEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', backgroundColor: '#f9fafb', padding: '24px' }}>
        <Container style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px', maxWidth: '500px' }}>
          <Heading style={{ fontSize: '18px', color: '#d97706', marginBottom: '16px' }}>
            Enlace de acceso vencido ({dossierCode})
          </Heading>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            Hola {ownerName || 'Responsable'},
          </Text>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            Le informamos que el enlace de acceso enviado a la contraparte <strong>{partyDeclaredName}</strong> ha caducado sin que se completara el diligenciamiento.
          </Text>
          <Section style={{ backgroundColor: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '6px', padding: '12px', margin: '16px 0' }}>
            <Text style={{ fontSize: '13px', color: '#b45309', margin: 0 }}>
              <strong>Estado actual:</strong> Expirado / Pendiente de reactivación
            </Text>
            <Text style={{ fontSize: '12px', color: '#92400e', margin: '6px 0 0 0' }}>
              Para que la contraparte pueda continuar, ingrese al expediente y emita un nuevo enlace de acceso.
            </Text>
          </Section>
          {dossierUrl && (
            <Section style={{ textAlign: 'center', margin: '20px 0' }}>
              <Button
                href={dossierUrl}
                style={{
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Ir al expediente
              </Button>
            </Section>
          )}
          <Text style={{ fontSize: '13px', color: '#6b7280', lineHeight: '20px' }}>
            La información y documentos que la contraparte ya haya cargado permanecen intactos.
          </Text>
          <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />
          <Text style={{ fontSize: '12px', color: '#9ca3af' }}>
            Recordatorio automático del sistema de debida diligencia de {organizationName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default DossierExpirationReminderEmail;
