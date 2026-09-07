import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId, resolvePostLoginDestination } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { selectOrganization } from './actions';

export default async function SelectOrganizationPage() {
  const userId = await requireAuthenticatedUserId();
  const destination = await resolvePostLoginDestination(userId);

  if (destination.kind === 'single_org') {
    redirect(`/app/${destination.organizationId}`);
  }

  if (destination.kind === 'no_access') {
    redirect('/login');
  }

  const memberships = await listActiveMembershipsForUser(userId);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <header className="mb-6 text-center">
        <div className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-500 inline-block" />
          JD Largo
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Selección de Organización Cliente
        </p>
      </header>
      <main className="w-full max-w-[440px]">
        <Card className="shadow-sm">
          <CardHeader className="text-center pb-4">
            <CardTitle>Seleccione una organización</CardTitle>
            <CardDescription className="mt-1">
              Tiene acceso a múltiples organizaciones. Elija con cuál desea trabajar en esta sesión:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {memberships.map((m) => (
              <form key={m.organizationId} action={selectOrganization}>
                <input type="hidden" name="organizationId" value={m.organizationId} />
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full h-auto py-3 px-4 justify-between text-left hover:border-emerald-600 dark:hover:border-emerald-500 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20"
                >
                  <span className="font-medium text-sm">{m.organizationName}</span>
                  <span className="text-xs text-zinc-400">Ingresar &rarr;</span>
                </Button>
              </form>
            ))}
          </CardContent>
        </Card>
      </main>
      <footer className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Puede cambiar de organización en cualquier momento
      </footer>
    </div>
  );
}