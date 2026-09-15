import { redirect } from 'next/navigation';
import { requireAuthenticatedUserId } from '@/server/auth/session';
import { listActiveMembershipsForUser } from '@/server/organizations/use-cases';
import { checkUserPermission } from '@/server/auth/access-control';
import {
  getActiveConfiguration,
  getDraftConfiguration,
} from '@/server/configuration/service';
import { getPrivacyNoticeForVersion } from '@/server/configuration/privacy-notice';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ShieldAlert, Settings } from 'lucide-react';
import { PrivacyNoticeEditor } from './privacy-notice-editor';

export default async function ConfiguracionPage({
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

  // 1. Check permission configuration:view
  const permCheck = await checkUserPermission(userId, organizationId, 'configuration:view');
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
                  No posee permisos para ver la configuración de esta organización.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>Permiso requerido: Ver configuración (configuration:view)</AlertTitle>
              <AlertDescription className="mt-1 text-xs">
                {permCheck.reason || 'Su rol actual no cuenta con autorización para acceder al módulo de configuración.'}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canAdministerCheck = await checkUserPermission(userId, organizationId, 'configuration:administer');
  const canPublishCheck = await checkUserPermission(userId, organizationId, 'configuration:publish');

  // 2. Fetch versions in parallel
  const [draftVersion, activeVersion] = await Promise.all([
    getDraftConfiguration(organizationId),
    getActiveConfiguration(organizationId),
  ]);

  if (!draftVersion && !activeVersion) {
    return (
      <div className="max-w-4xl mx-auto mt-6 space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-zinc-700 dark:text-zinc-300" />
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Configuración de la Organización
          </h1>
        </div>
        <Alert>
          <AlertTitle>Sin configuración inicial</AlertTitle>
          <AlertDescription>
            No se encontró ninguna versión de configuración registrada para esta organización.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Load notices for both versions (if they exist)
  const [draftNotice, activeNotice] = await Promise.all([
    draftVersion ? getPrivacyNoticeForVersion(organizationId, draftVersion.id) : Promise.resolve(null),
    activeVersion ? getPrivacyNoticeForVersion(organizationId, activeVersion.id) : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <div>
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 text-sm mb-1">
          <Settings className="w-4 h-4" />
          <span>Configuración de Organización</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Aviso de Privacidad
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Configure y publique el texto legal y las finalidades del tratamiento de datos personales para las contrapartes.
        </p>
      </div>

      {draftVersion && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300 mb-2">
              Borrador en edición (Versión {draftVersion.versionNumber})
            </h3>
            <PrivacyNoticeEditor
              organizationId={organizationId}
              slug={slug}
              isDraft={true}
              versionId={draftVersion.id}
              versionNumber={draftVersion.versionNumber}
              initialText={draftNotice?.text || ''}
              initialDataController={draftNotice?.dataController || currentMembership.organizationName || ''}
              initialDataProcessor={draftNotice?.dataProcessor || 'Plataforma JD Largo'}
              initialRightsChannels={draftNotice?.rightsChannels || ''}
              initialPurposes={draftNotice?.purposes || []}
              canAdminister={canAdministerCheck.granted}
              canPublish={canPublishCheck.granted}
              readOnly={false}
            />
          </div>

          {activeVersion && (
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 mt-6">
              <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
                Versión publicada actual (Versión {activeVersion.versionNumber})
              </h3>
              <PrivacyNoticeEditor
                organizationId={organizationId}
                slug={slug}
                isDraft={false}
                versionId={activeVersion.id}
                versionNumber={activeVersion.versionNumber}
                initialText={activeNotice?.text || ''}
                initialDataController={activeNotice?.dataController || currentMembership.organizationName || ''}
                initialDataProcessor={activeNotice?.dataProcessor || 'Plataforma JD Largo'}
                initialRightsChannels={activeNotice?.rightsChannels || ''}
                initialPurposes={activeNotice?.purposes || []}
                canAdminister={canAdministerCheck.granted}
                canPublish={canPublishCheck.granted}
                readOnly={true}
              />
            </div>
          )}
        </div>
      )}

      {!draftVersion && activeVersion && (
        <PrivacyNoticeEditor
          organizationId={organizationId}
          slug={slug}
          isDraft={false}
          versionId={activeVersion.id}
          versionNumber={activeVersion.versionNumber}
          initialText={activeNotice?.text || ''}
          initialDataController={activeNotice?.dataController || currentMembership.organizationName || ''}
          initialDataProcessor={activeNotice?.dataProcessor || 'Plataforma JD Largo'}
          initialRightsChannels={activeNotice?.rightsChannels || ''}
          initialPurposes={activeNotice?.purposes || []}
          canAdminister={canAdministerCheck.granted}
          canPublish={canPublishCheck.granted}
          readOnly={false}
        />
      )}
    </div>
  );
}
