'use client';

import * as React from 'react';
import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle2,
  Clock,
  Archive,
  ArrowRightLeft,
  Plus,
  Loader2,
  FileCheck2,
  Eye,
  FileSignature,
} from 'lucide-react';
import {
  createDraftAction,
  publishDraftAction,
  updateSignatureLevelAction,
  compareVersionsAction,
  getVersionDetailAction,
} from './actions';
import type { ConfigurationRoleDetail, VersionDiffResult, CounterpartyTypeWithRequirements } from '@/server/configuration/service';

interface VersionItem {
  id: string;
  versionNumber: string;
  status: 'draft' | 'published' | 'replaced';
  standard: string | null;
  effectiveFrom: Date;
  publishedAt: Date | null;
  reason?: string | null;
}

interface VersionesClientProps {
  organizationId: string;
  slug: string;
  versions: VersionItem[];
  draftVersionId: string | null;
  draftSignatureLevel: 1 | 2;
  canAdminister: boolean;
  canPublish: boolean;
}

export function VersionesClient({
  organizationId,
  slug,
  versions,
  draftVersionId,
  draftSignatureLevel,
  canAdminister,
  canPublish,
}: VersionesClientProps) {
  const [isPending, startTransition] = useTransition();
  const [publishReason, setPublishReason] = useState('');
  const [signatureLevel, setSignatureLevel] = useState<1 | 2>(draftSignatureLevel);
  const [signatureLevelSaved, setSignatureLevelSaved] = useState(false);
  const [selectedVersionDetail, setSelectedVersionDetail] = useState<{
    id: string;
    versionNumber: string;
    status: string;
    signatureLevelRequired: number;
    roles: ConfigurationRoleDetail[];
    counterpartyTypes: CounterpartyTypeWithRequirements[];
    privacyNotice: { text: string; purposes: unknown } | null;
  } | null>(null);

  const [compareV1, setCompareV1] = useState('');
  const [compareV2, setCompareV2] = useState('');
  const [diffResult, setDiffResult] = useState<VersionDiffResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCreateDraft = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const res = await createDraftAction(organizationId, slug);
      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setSuccessMsg('Borrador de configuración creado exitosamente.');
      }
    });
  };

  const handleUpdateSignatureLevel = () => {
    if (!draftVersionId) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSignatureLevelSaved(false);

    startTransition(async () => {
      const res = await updateSignatureLevelAction(organizationId, draftVersionId, slug, signatureLevel);
      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setSignatureLevelSaved(true);
      }
    });
  };

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftVersionId) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const formData = new FormData();
    formData.set('reason', publishReason);

    startTransition(async () => {
      const res = await publishDraftAction(organizationId, draftVersionId, slug, null, formData);
      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setSuccessMsg('Versión publicada exitosamente. Ahora rige en la organización.');
        setPublishReason('');
      }
    });
  };

  const handleViewDetail = (versionId: string) => {
    startTransition(async () => {
      const res = await getVersionDetailAction(organizationId, versionId);
      if (res.detail) {
        setSelectedVersionDetail(res.detail);
      }
    });
  };

  const handleCompare = () => {
    if (!compareV1 || !compareV2) return;
    setErrorMsg(null);
    startTransition(async () => {
      const res = await compareVersionsAction(organizationId, compareV1, compareV2);
      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setDiffResult(res.diff ?? null);
      }
    });
  };

  const getStatusBadge = (status: VersionItem['status']) => {
    switch (status) {
      case 'published':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3" /> Publicada (Vigente)
          </span>
        );
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800">
            <Clock className="w-3 h-3" /> Borrador
          </span>
        );
      case 'replaced':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            <Archive className="w-3 h-3" /> Reemplazada
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {successMsg && (
        <Alert className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100">
          <FileCheck2 className="w-4 h-4 text-emerald-600" />
          <AlertTitle>Operación completada</AlertTitle>
          <AlertDescription>{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Draft banner or Create Draft button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {draftVersionId ? 'Hay un borrador en curso' : 'Versión activa actualmente'}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {draftVersionId
              ? 'Las modificaciones a roles, requisitos y avisos se aplican sobre este borrador hasta su publicación.'
              : 'Para realizar cambios a la normativa o roles, cree una nueva versión en borrador.'}
          </p>
        </div>

        {!draftVersionId && canAdminister && (
          <Button onClick={handleCreateDraft} disabled={isPending} size="sm" className="gap-1.5 shrink-0">
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Crear borrador de configuración
          </Button>
        )}
      </div>

      {/* Signature level selector for the current draft */}
      {draftVersionId && canAdminister && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-zinc-500" />
              <CardTitle className="text-sm font-semibold">Nivel de firma exigido</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Nivel 1: evidencia de aceptación (huella del contenido, IP, fecha). Nivel 2: lo
              anterior más un código de verificación por correo antes de firmar. Aplica a los
              expedientes que se abran bajo esta versión una vez publicada.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex gap-2">
              {([1, 2] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    setSignatureLevel(level);
                    setSignatureLevelSaved(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    signatureLevel === level
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  Nivel {level}
                </button>
              ))}
            </div>
            <Button
              onClick={handleUpdateSignatureLevel}
              disabled={isPending || signatureLevel === draftSignatureLevel}
              size="sm"
              variant="outline"
              className="gap-1.5"
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Guardar en el borrador
            </Button>
            {signatureLevelSaved && signatureLevel === draftSignatureLevel && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">Guardado</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Publish draft form if draft exists */}
      {draftVersionId && canPublish && (
        <Card className="border-amber-200/80 dark:border-amber-900/50 bg-amber-50/20 dark:bg-amber-950/10">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Publicar borrador de configuración
            </CardTitle>
            <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400">
              Al publicar, la versión actual pasará a estado reemplazada y este borrador entrará en vigor inmediatamente. Se exige motivo explícito.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handlePublish}>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="publishReason" className="text-xs">Motivo de la publicación *</Label>
                <Input
                  id="publishReason"
                  placeholder="Ej: Actualización anual matriz de riesgos SAGRILAFT 2026"
                  value={publishReason}
                  onChange={(e) => setPublishReason(e.target.value)}
                  className="mt-1 text-xs"
                  required
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={isPending || !publishReason.trim()} size="sm" className="gap-1.5">
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Publicar versión
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Versions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Historial de versiones</CardTitle>
          <CardDescription className="text-xs">Todas las versiones registradas para la organización.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50 text-zinc-500 font-medium">
                <tr>
                  <th className="py-3 px-4">Versión</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4">Estándar</th>
                  <th className="py-3 px-4">Vigencia desde</th>
                  <th className="py-3 px-4">Motivo de publicación</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {versions.map((ver) => (
                  <tr key={ver.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                    <td className="py-3 px-4 font-semibold text-zinc-900 dark:text-zinc-100">
                      v{ver.versionNumber}
                    </td>
                    <td className="py-3 px-4">{getStatusBadge(ver.status)}</td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">{ver.standard || 'SARLAFT'}</td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">
                      {new Date(ver.effectiveFrom).toLocaleDateString('es-CO', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 max-w-xs">
                      {ver.reason ? (
                        <span className="line-clamp-2 text-xs">{ver.reason}</span>
                      ) : (
                        <span className="text-zinc-400 italic">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewDetail(ver.id)}
                        className="text-xs h-7 px-2 gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Ver detalle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Selected Version Detail Drawer/Modal simulation */}
      {selectedVersionDetail && (
        <Card className="border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">
                Detalle de v{selectedVersionDetail.versionNumber}
              </CardTitle>
              <CardDescription className="text-xs">
                Configuración completa: roles, tipos de contraparte, requisitos y aviso de privacidad.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedVersionDetail(null)} className="text-xs">
              Cerrar
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Signature Level Section */}
            <div className="flex items-center gap-2 text-xs">
              <FileSignature className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-zinc-500 dark:text-zinc-400">Nivel de firma exigido:</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                Nivel {selectedVersionDetail.signatureLevelRequired}
              </span>
            </div>

            {/* Roles Section */}
            {selectedVersionDetail.roles.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Roles y Permisos</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {selectedVersionDetail.roles.map((r) => (
                    <div key={r.code} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">{r.name}</div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">{r.code}</div>
                      <div className="mt-2 text-[11px] text-zinc-500">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{r.permissions.length}</span> permisos asignados
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Counterparty Types Section */}
            {selectedVersionDetail.counterpartyTypes.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Tipos de Contraparte</h4>
                <div className="space-y-2">
                  {selectedVersionDetail.counterpartyTypes.map((t) => (
                    <div key={t.id} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{t.name}</div>
                        <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                          {t.nature === 'natural_person' ? 'Persona Natural' : 'Persona Jurídica'}
                        </span>
                      </div>
                      {t.requirements.length > 0 && (
                        <ul className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-2 space-y-1">
                          {t.requirements.map((req) => (
                            <li key={req.id} className="flex items-center gap-1">
                              <code className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[10px]">{req.key}</code>
                              <span className="text-[10px]">
                                {req.mandatory === 'always' ? '◆' : '○'} {req.blocking ? '[bloq]' : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Privacy Notice Section */}
            {selectedVersionDetail.privacyNotice && (
              <div>
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Aviso de Privacidad</h4>
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-4">
                    {selectedVersionDetail.privacyNotice.text}
                  </p>
                  {Array.isArray(selectedVersionDetail.privacyNotice.purposes) && selectedVersionDetail.privacyNotice.purposes.length > 0 && (
                    <div className="mt-2 text-[11px] text-zinc-500">
                      {selectedVersionDetail.privacyNotice.purposes.length} finalidades definidas
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Compare Versions Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-zinc-500" />
            <CardTitle className="text-sm font-semibold">Comparar dos versiones</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Visualice qué roles o permisos cambiaron entre dos versiones publicadas o borrador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="w-full sm:w-1/2">
              <Label className="text-xs">Versión inicial (número)</Label>
              <Input
                placeholder="Ej: 1"
                value={compareV1}
                onChange={(e) => setCompareV1(e.target.value)}
                className="mt-1 text-xs"
              />
            </div>
            <div className="w-full sm:w-1/2">
              <Label className="text-xs">Versión comparada (número)</Label>
              <Input
                placeholder="Ej: 2"
                value={compareV2}
                onChange={(e) => setCompareV2(e.target.value)}
                className="mt-1 text-xs"
              />
            </div>
          </div>
          <Button
            onClick={handleCompare}
            disabled={isPending || !compareV1.trim() || !compareV2.trim()}
            size="sm"
            variant="outline"
            className="text-xs gap-1.5"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
            Comparar versiones
          </Button>

          {diffResult && (
            <div className="mt-4 p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 text-xs space-y-3">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                Diferencias entre v{diffResult.previousVersionNumber} y v{diffResult.newVersionNumber}:
              </div>

              {/* Roles Section */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="font-medium text-emerald-600">Roles agregados:</span>{' '}
                  {diffResult.rolesAdded.length ? diffResult.rolesAdded.join(', ') : 'Ninguno'}
                </div>
                <div>
                  <span className="font-medium text-rose-600">Roles eliminados:</span>{' '}
                  {diffResult.rolesRemoved.length ? diffResult.rolesRemoved.join(', ') : 'Ninguno'}
                </div>
              </div>
              <div>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Permisos cambiados:</span>
                {diffResult.permissionsChanged.length === 0 ? (
                  <p className="text-zinc-400 mt-1">Sin cambios en permisos de roles existentes.</p>
                ) : (
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    {diffResult.permissionsChanged.map((pc) => (
                      <li key={pc.roleCode}>
                        <strong>{pc.roleCode}:</strong>{' '}
                        {pc.added.length > 0 && <span className="text-emerald-600">+{pc.added.join(', ')} </span>}
                        {pc.removed.length > 0 && <span className="text-rose-600">-{pc.removed.join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Counterparty Types Section */}
              <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Tipos de Contraparte:</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                  <div>
                    <span className="text-emerald-600">Agregados:</span>{' '}
                    {diffResult.counterpartyTypesAdded.length ? diffResult.counterpartyTypesAdded.join(', ') : 'Ninguno'}
                  </div>
                  <div>
                    <span className="text-rose-600">Eliminados:</span>{' '}
                    {diffResult.counterpartyTypesRemoved.length ? diffResult.counterpartyTypesRemoved.join(', ') : 'Ninguno'}
                  </div>
                </div>
              </div>

              {/* Requirements Section */}
              {diffResult.requirementsChanged.length > 0 && (
                <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">Requisitos cambiados:</span>
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    {diffResult.requirementsChanged.map((rc) => (
                      <li key={rc.counterpartyTypeName}>
                        <strong>{rc.counterpartyTypeName}:</strong>{' '}
                        {rc.added.length > 0 && <span className="text-emerald-600">+{rc.added.join(', ')} </span>}
                        {rc.removed.length > 0 && <span className="text-rose-600">-{rc.removed.join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Privacy Notice Section */}
              <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Aviso de Privacidad:</span>{' '}
                {diffResult.privacyNoticeChanged ? (
                  <span className="text-amber-600">Cambió desde la versión anterior</span>
                ) : (
                  <span className="text-zinc-500">Sin cambios</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
