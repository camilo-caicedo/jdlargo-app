import { headers, cookies } from 'next/headers';
import {
  resolveAccessToken,
  requestOtpCode,
  ensureEntryTransition,
} from '@/server/privileged/portal-access';
import { verifyPortalSession } from '@/server/auth/portal-session';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { OtpForm } from './otp-form';

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
  }

  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-emerald-700 dark:text-emerald-400">
          Acceso concedido
        </CardTitle>
        <CardDescription className="mt-2">
          Ha ingresado correctamente al expediente de debida diligencia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Su acceso ha quedado registrado para fines de trazabilidad y auditoría.
        </p>
        <div className="p-4 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-500">
          El formulario de diligenciamiento estará disponible en la siguiente fase (HU-012).
        </div>
      </CardContent>
    </Card>
  );
}
