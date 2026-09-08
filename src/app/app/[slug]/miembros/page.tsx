import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import { getActiveConfiguration } from '@/server/configuration/service';
import { listPendingInvitations } from '@/server/organizations/invitations';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert, Users } from 'lucide-react';
import { InviteMemberForm } from './invite-form';
import { PendingInvitationsList } from './pending-list';

export default async function MiembrosPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const userId = await requireAuthenticatedUserId();

  const memberships = await listActiveMembershipsForUser(userId);
  const currentMembership = memberships.find((m) => m.slug === slug || m.organizationId === slug);

  if (!currentMembership) {
    redirect('/login/organizacion');
  }

  const organizationId = currentMembership.organizationId;

  // 1. Check permission memberships:manage
  const permCheck = await checkUserPermission(userId, organizationId, 'memberships:manage');

  if (!permCheck.granted) {
    return (
      <div className="max-w-3xl mx-auto mt-6">
        <Card className="border-red-200 dark:border-red-900/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
              <div>
                <CardTitle className="text-red-700 dark:text-red-300">Acceso no autorizado</CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  No posee permisos suficientes para gestionar miembros en esta organización.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso requerido: Gestionar miembros (memberships:manage)</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                {permCheck.reason || 'Su rol actual no cuenta con autorización para emitir o revocar invitaciones.'}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2. Load active configuration roles and pending invitations
  const activeConfig = await getActiveConfiguration(organizationId);
  const roles = (activeConfig?.roles || []).map((r) => ({
    code: r.code,
    name: r.name,
  }));

  const pendingInvitations = await listPendingInvitations(userId, organizationId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-500" />
            Gestión de Miembros
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Invite colaboradores y gestione los accesos del equipo a la plataforma.
          </p>
        </div>
      </div>

      {/* Invite Member Card */}
      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle className="text-base">Invitar nuevo miembro</CardTitle>
          <CardDescription className="text-xs">
            Se enviará un correo con un enlace seguro vigente por 7 días para unirse a la organización.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteMemberForm organizationId={organizationId} roles={roles} />
        </CardContent>
      </Card>

      {/* Pending Invitations Card */}
      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle className="text-base">Invitaciones pendientes</CardTitle>
          <CardDescription className="text-xs">
            Invitaciones enviadas que aún no han sido aceptadas por los destinatarios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PendingInvitationsList
            organizationId={organizationId}
            invitations={pendingInvitations}
          />
        </CardContent>
      </Card>
    </div>
  );
}
