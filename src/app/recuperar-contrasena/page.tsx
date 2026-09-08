import { redirect } from 'next/navigation';
import { getAuthenticatedUserId, resolvePostLoginDestination } from '@/server/auth/session';
import { RequestResetForm } from './request-form';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default async function RequestResetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await getAuthenticatedUserId();

  if (userId) {
    const destination = await resolvePostLoginDestination(userId);
    if (destination.kind === 'single_org') {
      redirect(`/app/${destination.organizationId}`);
    }
    if (destination.kind === 'select_org') {
      redirect('/login/organizacion');
    }
  }

  const { error } = await searchParams;

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
      <main className="w-full max-w-[420px]">
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-4">
            <CardTitle>Recuperar contraseña</CardTitle>
            <CardDescription className="mt-1">
              Ingresa tu correo para recibir un enlace de restablecimiento
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {error === 'session_expired' || error === 'invalid_token' || error === 'missing_token'
                    ? 'El enlace de recuperación es inválido o ha expirado. Por favor solicita uno nuevo.'
                    : 'Ocurrió un error con el enlace. Por favor intenta de nuevo.'}
                </AlertDescription>
              </Alert>
            )}
            <RequestResetForm />
          </CardContent>
        </Card>
      </main>
      <footer className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Sistema de Administración y Gestión del Riesgo Integral
      </footer>
    </div>
  );
}