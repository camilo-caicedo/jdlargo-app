import { resolveInvitation } from '@/server/privileged/invitation-acceptance';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { SetupAccountForm } from './setup-account-form';
import { LoginToAcceptForm } from './login-to-accept-form';

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await resolveInvitation(token);

  if (result.outcome === 'invalid') {
    let title = 'Invitación no disponible';
    let message = 'El enlace de invitación proporcionado no es válido o ya no existe.';
    let help = 'Solicite al Administrador u Oficial de Cumplimiento de su organización que le envíe una nueva invitación.';

    if (result.reason === 'expired') {
      title = 'Invitación expirada';
      message = 'El plazo de 7 días para aceptar esta invitación ha vencido.';
    } else if (result.reason === 'revoked') {
      title = 'Invitación revocada';
      message = 'Esta invitación fue cancelada por un administrador de la organización.';
    } else if (result.reason === 'replaced') {
      title = 'Invitación reemplazada';
      message = 'Se generó una invitación más reciente para su correo. Por favor verifique el correo más reciente recibido.';
    } else if (result.reason === 'accepted') {
      title = 'Invitación ya aceptada';
      message = 'Esta invitación ya fue utilizada previamente para vincular su cuenta.';
      help = 'Puede iniciar sesión directamente con su correo y contraseña.';
    }

    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 flex flex-col items-center justify-center p-4 sm:p-6">
        <header className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-500 inline-block" />
            JD Largo
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Plataforma de Prevención de Riesgos LA/FT/FPADM
          </p>
        </header>
        <main className="w-full max-w-[440px]">
          <Card className="shadow-sm">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-red-600 dark:text-red-400">{title}</CardTitle>
              <CardDescription className="mt-2 text-zinc-600 dark:text-zinc-400">
                {message}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertTitle>¿Qué puede hacer?</AlertTitle>
                <AlertDescription className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {help}
                </AlertDescription>
              </Alert>
              {result.reason === 'accepted' && (
                <div className="mt-6 text-center">
                  <a
                    href="/login"
                    className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Ir al inicio de sesión
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const orgName = result.organizationName || 'Organización';
  const email = result.email || '';
  const accountExists = !!result.accountExists;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <header className="mb-6 text-center">
        <div className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-500 inline-block" />
          JD Largo
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Plataforma de Prevención de Riesgos LA/FT/FPADM
        </p>
      </header>
      <main className="w-full max-w-[440px]">
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-4">
            <CardTitle>Únase a {orgName}</CardTitle>
            <CardDescription className="mt-1">
              Ha sido invitado a formar parte del equipo en la plataforma de prevención y debida diligencia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {accountExists ? (
              <LoginToAcceptForm
                token={token}
                email={email}
                organizationName={orgName}
              />
            ) : (
              <SetupAccountForm
                token={token}
                email={email}
                organizationName={orgName}
              />
            )}
          </CardContent>
        </Card>
      </main>
      <footer className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Sistema de Administración y Gestión del Riesgo Integral
      </footer>
    </div>
  );
}
