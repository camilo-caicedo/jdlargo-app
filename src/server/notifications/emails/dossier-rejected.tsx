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

export interface DossierRejectedEmailProps {
  ownerName?: string;
  dossierCode: string;
  partyDeclaredName: string;
  organizationName: string;
  rejectionReason: string;
}

export function DossierRejectedEmail({
  ownerName,
  dossierCode,
  partyDeclaredName,
  organizationName,
  rejectionReason,
}: DossierRejectedEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', backgroundColor: '#f9fafb', padding: '24px' }}>
        <Container style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px', maxWidth: '500px' }}>
          <Heading style={{ fontSize: '18px', color: '#dc2626', marginBottom: '16px' }}>
            Expediente rechazado por la contraparte ({dossierCode})
          </Heading>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            Hola {ownerName || 'Responsable'},
          </Text>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            Le informamos que la contraparte <strong>{partyDeclaredName}</strong> en <strong>{organizationName}</strong> no ha aceptado el aviso de privacidad y autorización de datos personales.
          </Text>
          <Section style={{ backgroundColor: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '6px', padding: '12px', margin: '16px 0' }}>
            <Text style={{ fontSize: '13px', color: '#991b1b', margin: 0 }}>
              <strong>Estado del expediente:</strong> Rechazada por contraparte
            </Text>
            <Text style={{ fontSize: '12px', color: '#7f1d1d', margin: '6px 0 0 0' }}>
              Motivo: {rejectionReason}
            </Text>
          </Section>
          <Text style={{ fontSize: '13px', color: '#6b7280', lineHeight: '20px' }}>
            El expediente ha quedado congelado y no se solicitará ninguna información ni documentación adicional a la contraparte.
          </Text>
          <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />
          <Text style={{ fontSize: '12px', color: '#9ca3af' }}>
            Notificación automática del sistema de debida diligencia de {organizationName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default DossierRejectedEmail;

