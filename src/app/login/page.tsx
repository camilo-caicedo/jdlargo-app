import { redirect } from 'next/navigation';
import { getAuthenticatedUserId, resolvePostLoginDestination } from '@/server/auth/session';
import { LoginForm } from './login-form';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default async function LoginPage() {
  const userId = await getAuthenticatedUserId();

  if (userId) {
    const destination = await resolvePostLoginDestination(userId);
    if (destination.kind === 'single_org') {
      redirect(`/app/${destination.slug}`);
    }
    if (destination.kind === 'select_org') {
      redirect('/login/organizacion');
    }
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
      <main className="w-full max-w-[400px]">
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-4">
            <CardTitle>Iniciar sesión</CardTitle>
            <CardDescription className="mt-1">
              Ingrese con sus credenciales institucionales
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </main>
      <footer className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Sistema de Administración y Gestión del Riesgo Integral
      </footer>
    </div>
  );
}