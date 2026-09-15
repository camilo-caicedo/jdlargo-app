'use client';

import * as React from 'react';
import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  ShieldCheck,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Lock,
  Loader2,
  FileEdit,
  Send,
} from 'lucide-react';
import type { PrivacyNoticePurpose } from '@/server/configuration/privacy-notice';
import {
  savePrivacyNoticeAction,
  createDraftForEditingAction,
  publishDraftAction,
} from './actions';

interface PrivacyNoticeEditorProps {
  organizationId: string;
  slug: string;
  isDraft: boolean;
  versionId: string;
  versionNumber: string;
  initialText: string;
  initialDataController: string;
  initialDataProcessor: string;
  initialRightsChannels: string;
  initialPurposes: PrivacyNoticePurpose[];
  canAdminister: boolean;
  canPublish: boolean;
  readOnly?: boolean;
}

export function PrivacyNoticeEditor({
  organizationId,
  slug,
  isDraft,
  versionId,
  versionNumber,
  initialText,
  initialDataController,
  initialDataProcessor,
  initialRightsChannels,
  initialPurposes,
  canAdminister,
  canPublish,
  readOnly = false,
}: PrivacyNoticeEditorProps) {
  // Form values
  const [text, setText] = useState(initialText);
  const [dataController, setDataController] = useState(initialDataController);
  const [dataProcessor, setDataProcessor] = useState(initialDataProcessor);
  const [rightsChannels, setRightsChannels] = useState(initialRightsChannels);
  const [purposes, setPurposes] = useState<PrivacyNoticePurpose[]>(
    initialPurposes.length > 0
      ? initialPurposes
      : [
          {
            key: 'laft_screening',
            description: 'Prevención y control del riesgo de LA/FT/FPADM y consulta en listas vinculantes y restrictivas.',
            requiresAuthorization: true,
          },
        ],
  );

  // States
  const [publishReason, setPublishReason] = useState('');
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreatingDraft, startCreateDraftTransition] = useTransition();

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Purpose handling
  const handleAddPurpose = () => {
    if (readOnly) return;
    setPurposes((prev) => [
      ...prev,
      {
        key: `finalidad_${prev.length + 1}`,
        description: '',
        requiresAuthorization: true,
      },
    ]);
  };

  const handleRemovePurpose = (index: number) => {
    if (readOnly) return;
    setPurposes((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePurposeChange = (index: number, field: keyof PrivacyNoticePurpose, value: unknown) => {
    setPurposes((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  // Save handler
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('text', text);
    formData.append('dataController', dataController);
    formData.append('dataProcessor', dataProcessor);
    formData.append('rightsChannels', rightsChannels);
    formData.append('purposes', JSON.stringify(purposes));

    try {
      const res = await savePrivacyNoticeAction(organizationId, versionId, slug, null, formData);
      if (res.error) {
        setMessage({ type: 'error', text: res.error });
      } else {
        setMessage({ type: 'success', text: 'Aviso de privacidad guardado correctamente en la versión borrador.' });
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error inesperado al guardar' });
    } finally {
      setIsSaving(false);
    }
  };

  // Create Draft handler (when published)
  const handleCreateDraft = () => {
    setMessage(null);
    startCreateDraftTransition(async () => {
      const res = await createDraftForEditingAction(organizationId, slug);
      if (!res.success) {
        setMessage({ type: 'error', text: res.error || 'Error al crear borrador' });
      }
    });
  };

  // Publish handler
  const handlePublish = async () => {
    if (!publishReason.trim()) {
      setMessage({ type: 'error', text: 'Debe ingresar un motivo explícito para la publicación.' });
      return;
    }

    setIsPublishing(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('reason', publishReason.trim());

    try {
      const res = await publishDraftAction(organizationId, versionId, slug, null, formData);
      if (res.error) {
        setMessage({ type: 'error', text: res.error });
      } else {
        setShowPublishDialog(false);
        setMessage({ type: 'success', text: 'La versión de configuración ha sido publicada exitosamente.' });
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error inesperado al publicar' });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert message */}
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200' : ''}>
          {message.type === 'success' ? <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <AlertTriangle className="h-4 w-4" />}
          <AlertTitle>{message.type === 'success' ? 'Operación exitosa' : 'Atención'}</AlertTitle>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      {/* Version Status Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg ${isDraft ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'}`}>
            {isDraft ? <FileEdit className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                Versión {versionNumber}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${
                isDraft
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
              }`}>
                {isDraft ? 'Borrador editable' : 'Publicada (Solo Lectura)'}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {isDraft
                ? 'Las modificaciones en borrador no afectan a los expedientes ya iniciados hasta que sea publicada.'
                : 'Esta versión es inmutable para asegurar la validez jurídica de los consentimientos otorgados.'}
            </p>
          </div>
        </div>

        {/* Action Button: Edit or Publish */}
        <div className="flex items-center gap-2">
          {!isDraft ? (
            canAdminister && !readOnly && (
              <Button
                type="button"
                onClick={handleCreateDraft}
                disabled={isCreatingDraft}
                variant="default"
                className="gap-2"
              >
                {isCreatingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileEdit className="w-4 h-4" />}
                Editar (crea nueva versión)
              </Button>
            )
          ) : (
            canPublish && !readOnly && (
              <Button
                type="button"
                onClick={() => setShowPublishDialog(true)}
                disabled={isSaving || isPublishing}
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                <Send className="w-4 h-4" />
                Publicar versión
              </Button>
            )
          )}
        </div>
      </div>

      {/* Main Privacy Notice Form */}
      <form onSubmit={handleSave}>
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 mb-1">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Aviso de Privacidad y Tratamiento de Datos</span>
            </div>
            <CardTitle>Contenido del Aviso de Privacidad</CardTitle>
            <CardDescription>
              Este aviso será presentado obligatoriamente a toda contraparte antes de acceder al formulario de debida diligencia.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Texto del aviso */}
            <div className="space-y-2">
              <Label htmlFor="text" className="font-medium text-sm">
                Texto del aviso de privacidad <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="text"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={!isDraft || !canAdminister || readOnly || isSaving}
                placeholder="Escriba el texto legal del aviso de privacidad para el tratamiento de datos personales..."
                className="text-sm font-sans"
                required
              />
            </div>

            {/* Responsable, Encargado, Canales */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dataController" className="font-medium text-sm">
                  Responsable del tratamiento <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="dataController"
                  value={dataController}
                  onChange={(e) => setDataController(e.target.value)}
                  disabled={!isDraft || !canAdminister || readOnly || isSaving}
                  placeholder="Ej: Alfa Ficticia S.A.S."
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dataProcessor" className="font-medium text-sm">
                  Encargado del tratamiento <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="dataProcessor"
                  value={dataProcessor}
                  onChange={(e) => setDataProcessor(e.target.value)}
                  disabled={!isDraft || !canAdminister || readOnly || isSaving}
                  placeholder="Ej: Plataforma JD Largo"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rightsChannels" className="font-medium text-sm">
                  Canales de atención / Habeas Data <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="rightsChannels"
                  value={rightsChannels}
                  onChange={(e) => setRightsChannels(e.target.value)}
                  disabled={!isDraft || !canAdminister || readOnly || isSaving}
                  placeholder="Ej: privacidad@miempresa.com"
                  required
                />
              </div>
            </div>

            {/* Finalidades del Tratamiento */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b pb-2">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Finalidades del Tratamiento
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Especifique cada propósito para el cual se solicitarán y procesarán los datos de la contraparte.
                  </p>
                </div>
                {isDraft && canAdminister && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddPurpose}
                    className="gap-1.5 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Agregar finalidad
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {purposes.map((p, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg border bg-zinc-50/60 dark:bg-zinc-900/40 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="w-full sm:w-1/3 space-y-1">
                        <Label className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          Identificador (Clave)
                        </Label>
                        <Input
                          value={p.key}
                          onChange={(e) => handlePurposeChange(idx, 'key', e.target.value)}
                          disabled={!isDraft || !canAdminister || readOnly || isSaving}
                          placeholder="ej: laft_screening"
                          className="h-8 text-xs font-mono"
                          required
                        />
                      </div>

                      <div className="w-full sm:w-1/2 space-y-1">
                        <Label className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                          ¿Requiere Autorización Expresa?
                        </Label>
                        <div className="flex items-center gap-2 pt-0.5">
                          <Button
                            type="button"
                            size="sm"
                            variant={p.requiresAuthorization ? 'default' : 'outline'}
                            className={`h-7 px-3 text-xs font-medium ${
                              p.requiresAuthorization
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : ''
                            }`}
                            disabled={!isDraft || !canAdminister || readOnly || isSaving}
                            onClick={() => handlePurposeChange(idx, 'requiresAuthorization', true)}
                          >
                            Sí
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={!p.requiresAuthorization ? 'default' : 'outline'}
                            className={`h-7 px-3 text-xs font-medium ${
                              !p.requiresAuthorization
                                ? 'bg-zinc-700 hover:bg-zinc-800 text-white'
                                : ''
                            }`}
                            disabled={!isDraft || !canAdminister || readOnly || isSaving}
                            onClick={() => handlePurposeChange(idx, 'requiresAuthorization', false)}
                          >
                            No
                          </Button>
                        </div>
                      </div>

                      {isDraft && canAdminister && purposes.length > 1 && (
                        <div className="sm:ml-auto flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemovePurpose(idx)}
                            className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                        Descripción de la finalidad
                      </Label>
                      <Input
                        value={p.description}
                        onChange={(e) => handlePurposeChange(idx, 'description', e.target.value)}
                        disabled={!isDraft || !canAdminister || readOnly || isSaving}
                        placeholder="Descripción clara de cómo y por qué se utiliza la información..."
                        className="h-8 text-xs"
                        required
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>

          {isDraft && canAdminister && (
            <CardFooter className="flex justify-end border-t pt-4">
              <Button type="submit" disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar cambios en borrador
              </Button>
            </CardFooter>
          )}
        </Card>
      </form>

      {/* Modal / Dialog for publishing */}
      {showPublishDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-xl animate-in fade-in zoom-in-95">
            <CardHeader>
              <CardTitle className="text-lg">Publicar versión de configuración</CardTitle>
              <CardDescription>
                Al publicar, la versión {versionNumber} entrará en vigencia inmediatamente. Se reemplazará la versión anterior y este aviso pasará a ser inmutable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="publishReason" className="text-sm font-medium">
                  Motivo de la publicación <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="publishReason"
                  rows={3}
                  value={publishReason}
                  onChange={(e) => setPublishReason(e.target.value)}
                  placeholder="Ej: Actualización anual del aviso de privacidad y finalidades conforme a la circular..."
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPublishDialog(false)}
                disabled={isPublishing}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing || !publishReason.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {isPublishing && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar y Publicar
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
