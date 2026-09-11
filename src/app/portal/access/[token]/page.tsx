import { headers, cookies } from 'next/headers';
import {
  resolveAccessToken,
  requestOtpCode,
  ensureEntryTransition,
} from '@/server/privileged/portal-access';
import { verifyPortalSession } from '@/server/auth/portal-session';
import { getConsentForDossier } from '@/server/consent/consent';
import { getPrivacyNoticeForVersion } from '@/server/configuration/privacy-notice';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { OtpForm } from './otp-form';
import { PrivacyNoticeForm } from './privacy-notice-form';
import { DeclarationForm } from './declaration-form';
import { DocumentUploadSection } from './document-upload-section';
import { getDeclarationForm } from '@/server/dossiers/declaration';
import { getLatestDocumentsForDossier } from '@/server/documents/document';
import { CheckCircle, Clock } from 'lucide-react';

export default async function PortalAccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headerStore = await headers();
  const cookieStore = await cookies();

  const ipAddress =
    headerStore.get('x-forwarded-for')?.split(',')[0].trim() ||
    headerStore.get('x-real-ip') ||
    '127.0.0.1';
  const userAgent = headerStore.get('user-agent') || 'Unknown';

  const result = await resolveAccessToken(token, { ipAddress, userAgent });

  // 1. If access is denied: show descriptive error with owner contact details
  if (result.outcome === 'denied') {
    let title = 'Acceso denegado';
    let message = 'El enlace de acceso proporcionado no es válido o no existe.';

    if (result.denialReason === 'expired') {
      title = 'Enlace de acceso expirado';
      message = 'La fecha límite de validez para este enlace ha concluido.';
    } else if (result.denialReason === 'revoked') {
      title = 'Enlace de acceso revocado';
      message = 'Este enlace de acceso fue revocado por el responsable del expediente.';
    } else if (result.denialReason === 'replaced') {
      title = 'Enlace de acceso reemplazado';
      message = 'Se ha generado un nuevo enlace de acceso para este expediente. El enlace anterior ha quedado sin efecto.';
    }

    return (
      <Card className="w-full shadow-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-red-600 dark:text-red-400">{title}</CardTitle>
          <CardDescription className="mt-2">{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="default">
            <AlertTitle>¿Necesita acceso?</AlertTitle>
            <AlertDescription className="mt-1">
              {result.ownerContact ? (
                <span>
                  Por favor comuníquese con el responsable interno:{' '}
                  <strong>{result.ownerContact.name}</strong> (
                  <a
                    href={`mailto:${result.ownerContact.email}`}
                    className="underline text-zinc-900 dark:text-zinc-100"
                  >
                    {result.ownerContact.email}
                  </a>
                  ) para solicitar un nuevo enlace.
                </span>
              ) : (
                <span>
                  Por favor contacte a la organización que le solicitó la debida diligencia para
                  recibir un nuevo enlace de acceso.
                </span>
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // 2. Granted access: check if second factor (OTP) is required and whether it's already verified in cookie
  if (result.requiresSecondFactor && result.accessTokenId) {
    const sessionCookie = cookieStore.get('portal_session')?.value;
    const sessionData = sessionCookie ? verifyPortalSession(sessionCookie) : null;

    const isVerified = sessionData && sessionData.accessTokenId === result.accessTokenId;

    if (!isVerified) {
      // Trigger sending OTP code if needed
      await requestOtpCode(result.accessTokenId).catch((err) => {
        console.warn('[PortalAccessPage] Error requesting OTP code:', err);
      });

      return (
        <Card className="w-full shadow-sm">
          <CardHeader className="text-center">
            <CardTitle>Verificación de seguridad</CardTitle>
            <CardDescription className="mt-2">
              Se requiere un factor de autenticación adicional para acceder a este expediente.
              Hemos enviado un código a su correo electrónico.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <OtpForm accessTokenId={result.accessTokenId} />
          </CardContent>
        </Card>
      );
    }
  }

  // 3. Granted and (if needed) verified: trigger entry transition to 'en_diligenciamiento'
  if (result.dossierId && result.organizationId) {
    await ensureEntryTransition(result.dossierId, result.organizationId);

    // 4. Privacy Notice Gate (HU-011)
    const consent = await getConsentForDossier(result.organizationId, result.dossierId);

    if (consent) {
      if (consent.result === 'not_accepted') {
        return (
          <Card className="w-full shadow-sm max-w-xl mx-auto">
            <CardHeader className="text-center">
              <CardTitle className="text-red-600 dark:text-red-400">
                Expediente finalizado
              </CardTitle>
              <CardDescription className="mt-2">
                Usted ha manifestado que no autoriza el tratamiento de datos personales para este expediente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                El proceso de debida diligencia se encuentra cerrado por decisión de la contraparte.
                Si considera que esto es un error o desea autorizar el tratamiento, comuníquese con la organización solicitante.
              </p>
              <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-500 font-mono">
                Registrado el {new Date(consent.occurredAt).toLocaleString()} desde la IP {consent.ipAddress}
              </div>
            </CardContent>
          </Card>
        );
      }
      // If result === 'accepted', proceed to show the HU-012 placeholder
    } else {
      // No consent recorded yet: load privacy notice for this dossier's configuration version
      if (!result.configurationVersionId) {
        return (
          <Alert variant="destructive">
            <AlertTitle>Configuración incompleta</AlertTitle>
            <AlertDescription>
              El expediente no tiene una versión de configuración asociada.
            </AlertDescription>
          </Alert>
        );
      }

      const notice = await getPrivacyNoticeForVersion(
        result.organizationId,
        result.configurationVersionId,
      );

      if (!notice) {
        return (
          <Card className="w-full shadow-sm max-w-xl mx-auto">
            <CardHeader className="text-center">
              <CardTitle className="text-amber-600 dark:text-amber-400">
                Aviso de privacidad pendiente
              </CardTitle>
              <CardDescription className="mt-2">
                La organización aún no ha configurado el aviso de privacidad para este estándar de debida diligencia.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center text-sm text-zinc-600 dark:text-zinc-400">
              Por favor comuníquese con el responsable del expediente para que la entidad publique el aviso correspondiente.
            </CardContent>
          </Card>
        );
      }

      return (
        <PrivacyNoticeForm
          token={token}
          dossierId={result.dossierId}
          organizationId={result.organizationId}
          privacyNoticeId={notice.id}
          text={notice.text}
          purposes={notice.purposes}
          dataController={notice.dataController}
          dataProcessor={notice.dataProcessor}
          rightsChannels={notice.rightsChannels}
        />
      );
    }
  }

  if (result.dossierState === 'en_diligenciamiento') {
    if (!result.organizationId || !result.dossierId) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Expediente no identificado</AlertTitle>
          <AlertDescription>
            No fue posible identificar la organización o expediente correspondiente a este enlace.
          </AlertDescription>
        </Alert>
      );
    }

    const formData = await getDeclarationForm(result.organizationId, result.dossierId);
    const latestDocs = await getLatestDocumentsForDossier(result.organizationId, result.dossierId);

    const initialDocsDTO = latestDocs.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      version: d.version,
      format: d.format,
      state: d.state,
      createdAt: d.createdAt.toISOString(),
    }));

    return (
      <div className="w-full space-y-6">
        <DeclarationForm
          token={token}
          dossierId={result.dossierId}
          organizationId={result.organizationId}
          fieldRequirements={formData.fieldRequirements}
          documentRequirements={formData.documentRequirements}
          values={formData.values}
        />
        <DocumentUploadSection
          token={token}
          dossierId={result.dossierId}
          organizationId={result.organizationId}
          documentRequirements={formData.documentRequirements}
          initialDocuments={initialDocsDTO}
        />
      </div>
    );
  }

  // Cualquier estado posterior (documentos_recibidos en adelante): tarjeta de solo lectura
  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="text-center">
        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-2">
          <CheckCircle className="w-5 h-5" />
        </div>
        <CardTitle className="text-emerald-700 dark:text-emerald-400">
          Información enviada
        </CardTitle>
        <CardDescription className="mt-2">
          Su declaración de datos ha sido completada y recibida satisfactoriamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          El expediente se encuentra actualmente en estado{' '}
          <strong className="text-zinc-900 dark:text-zinc-100 font-semibold uppercase text-xs">
            {result.dossierState || 'en revisión'}
          </strong>
          . El equipo de cumplimiento está procesando la información.
        </p>
        <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 flex items-center justify-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          <span>No se requieren acciones adicionales de su parte en este momento.</span>
        </div>
      </CardContent>
    </Card>
  );
}

