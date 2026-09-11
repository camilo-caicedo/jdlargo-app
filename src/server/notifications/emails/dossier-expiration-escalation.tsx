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

export interface DossierExpirationEscalationEmailProps {
  recipientName?: string;
  dossierCode: string;
  partyDeclaredName: string;
  organizationName: string;
  internalOwnerName?: string;
  dossierUrl?: string;
  reminderCount?: number;
}

export function DossierExpirationEscalationEmail({
  recipientName,
  dossierCode,
  partyDeclaredName,
  organizationName,
  internalOwnerName,
  dossierUrl,
  reminderCount = 3,
}: DossierExpirationEscalationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', backgroundColor: '#f9fafb', padding: '24px' }}>
        <Container style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px', maxWidth: '500px' }}>
          <Heading style={{ fontSize: '18px', color: '#b91c1c', marginBottom: '16px' }}>
            Aviso de escalación: Expediente sin reactivar ({dossierCode})
          </Heading>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            Estimado/a {recipientName || 'Oficial de Cumplimiento'},
          </Text>
          <Text style={{ fontSize: '14px', color: '#4b5563', lineHeight: '22px' }}>
            Se ha escalado este aviso debido a que el expediente de la contraparte <strong>{partyDeclaredName}</strong> en <strong>{organizationName}</strong> permanece en estado <strong>Expirado / Pendiente</strong> tras enviarse {reminderCount} recordatorios al responsable interno ({internalOwnerName || 'No asignado'}) sin registrarse emisión de un nuevo enlace.
          </Text>
          <Section style={{ backgroundColor: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '6px', padding: '12px', margin: '16px 0' }}>
            <Text style={{ fontSize: '13px', color: '#991b1b', margin: 0 }}>
              <strong>Acción requerida:</strong> Revisar situación con el responsable o evaluar la continuidad del proceso de vinculación.
            </Text>
          </Section>
          {dossierUrl && (
            <Section style={{ textAlign: 'center', margin: '20px 0' }}>
              <Button
                href={dossierUrl}
                style={{
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Revisar expediente
              </Button>
            </Section>
          )}
          <Text style={{ fontSize: '13px', color: '#6b7280', lineHeight: '20px' }}>
            El expediente permanecerá en este estado y no se enviarán más avisos automáticos hasta que se reactive o cierre.
          </Text>
          <Hr style={{ borderColor: '#e5e7eb', margin: '20px 0' }} />
          <Text style={{ fontSize: '12px', color: '#9ca3af' }}>
            Aviso de escalación automático de debida diligencia de {organizationName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default DossierExpirationEscalationEmail;
