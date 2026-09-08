import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default async function AppOrganizationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="max-w-4xl mx-auto mt-6">
      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle>Espacio de trabajo</CardTitle>
          <CardDescription>
            Sesión iniciada correctamente en la organización.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Identificador activo: <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-semibold text-emerald-600 dark:text-emerald-400">{slug}</code>
          </p>
          <p className="text-xs text-zinc-500 mt-4">
            Los módulos de gestión de expedientes y debida diligencia estarán disponibles próximamente (HU-008 / HU-009 shell).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}