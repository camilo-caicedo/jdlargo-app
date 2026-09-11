'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { RequirementDetail } from '@/lib/requirement-evaluation';
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  DOSSIER_DOCUMENTS_BUCKET,
} from '@/lib/document-upload-constants';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  requestDocumentUploadUrlAction,
  confirmDocumentUploadAction,
  getPortalDocumentDownloadUrlAction,
} from './document-actions';
import {
  FileText,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Calendar,
  Building,
} from 'lucide-react';

export interface DocumentSummaryDTO {
  id: string;
  documentType: string;
  version: number;
  format: string;
  state: string;
  createdAt: string;
}

interface DocumentUploadSectionProps {
  token: string;
  dossierId: string;
  organizationId: string;
  documentRequirements: RequirementDetail[];
  initialDocuments: DocumentSummaryDTO[];
}

export function DocumentUploadSection({
  token,
  dossierId,
  organizationId,
  documentRequirements,
  initialDocuments,
}: DocumentUploadSectionProps) {
  const [documents, setDocuments] = React.useState<DocumentSummaryDTO[]>(initialDocuments);

  // Per-requirement upload states
  const [uploadState, setUploadState] = React.useState<
    Record<
      string,
      {
        status: 'idle' | 'requesting' | 'uploading' | 'confirming' | 'success' | 'error';
        error?: string;
        fileName?: string;
      }
    >
  >({});

  // Optional metadata inputs per requirement: issuer, issuedAt, expiresAt
  const [metadata, setMetadata] = React.useState<
    Record<string, { declaredIssuer?: string; issuedAt?: string; expiresAt?: string }>
  >({});

  const [downloadingDocId, setDownloadingDocId] = React.useState<string | null>(null);

  if (documentRequirements.length === 0) {
    return null;
  }

  const handleMetadataChange = (
    key: string,
    field: 'declaredIssuer' | 'issuedAt' | 'expiresAt',
    value: string,
  ) => {
    setMetadata((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value || undefined,
      },
    }));
  };

  const handleFileSelect = async (reqKey: string, file: File) => {
    // 1. Client-side fast check
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadState((prev) => ({
        ...prev,
        [reqKey]: {
          status: 'error',
          error: `El archivo excede el tamaño máximo permitido de ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB`,
        },
      }));
      return;
    }

    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setUploadState((prev) => ({
        ...prev,
        [reqKey]: {
          status: 'error',
          error: 'Formato de archivo no admitido. Formatos permitidos: PDF, JPG, PNG',
        },
      }));
      return;
    }

    // 2. Request upload URL
    setUploadState((prev) => ({
      ...prev,
      [reqKey]: { status: 'requesting', fileName: file.name },
    }));

    try {
      const reqRes = await requestDocumentUploadUrlAction(
        token,
        dossierId,
        organizationId,
        reqKey,
        file.name,
        file.size,
        file.type,
      );

      if (!reqRes.success || !reqRes.signedUrl || !reqRes.uploadToken || !reqRes.storagePath) {
        setUploadState((prev) => ({
          ...prev,
          [reqKey]: {
            status: 'error',
            error: reqRes.error || 'Error al obtener autorización de subida',
          },
        }));
        return;
      }

      // 3. Direct upload to Supabase Storage
      setUploadState((prev) => ({
        ...prev,
        [reqKey]: { status: 'uploading', fileName: file.name },
      }));

      const browserClient = getSupabaseBrowserClient();
      const { error: uploadError } = await browserClient.storage
        .from(DOSSIER_DOCUMENTS_BUCKET)
        .uploadToSignedUrl(reqRes.storagePath, reqRes.uploadToken, file);

      if (uploadError) {
        setUploadState((prev) => ({
          ...prev,
          [reqKey]: {
            status: 'error',
            error: `Error al subir a almacenamiento: ${uploadError.message}`,
          },
        }));
        return;
      }

      // 4. Confirm upload with server (validates magic bytes & calculates hash)
      setUploadState((prev) => ({
        ...prev,
        [reqKey]: { status: 'confirming', fileName: file.name },
      }));

      const reqMeta = metadata[reqKey] || {};
      const confirmRes = await confirmDocumentUploadAction(
        token,
        dossierId,
        organizationId,
        reqKey,
        reqRes.storagePath,
        reqMeta.declaredIssuer,
        reqMeta.issuedAt,
        reqMeta.expiresAt,
      );

      if (!confirmRes.success) {
        setUploadState((prev) => ({
          ...prev,
          [reqKey]: {
            status: 'error',
            error: confirmRes.error || 'Error al validar y confirmar el documento',
          },
        }));
        return;
      }

      setUploadState((prev) => ({
        ...prev,
        [reqKey]: { status: 'success', fileName: file.name },
      }));

      // Update local state representation
      setDocuments((prev) => {
        const existing = prev.filter((d) => d.documentType !== reqKey);
        return [
          ...existing,
          {
            id: 'just-uploaded',
            documentType: reqKey,
            version: 1,
            format: file.type.includes('pdf') ? 'pdf' : file.type.includes('png') ? 'png' : 'jpg',
            state: 'received',
            createdAt: new Date().toISOString(),
          },
        ];
      });
    } catch (err) {
      setUploadState((prev) => ({
        ...prev,
        [reqKey]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Error inesperado de red',
        },
      }));
    }
  };

  const handleDownload = async (docId: string) => {
    setDownloadingDocId(docId);
    try {
      const res = await getPortalDocumentDownloadUrlAction(token, dossierId, organizationId, docId);
      if (res.success && res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        alert(res.error || 'Error al generar enlace de descarga');
      }
    } catch {
      alert('Error de conexión al solicitar el archivo');
    } finally {
      setDownloadingDocId(null);
    }
  };

  return (
    <Card className="w-full shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          <CardTitle className="text-lg">Documentos requeridos</CardTitle>
        </div>
        <CardDescription>
          Cargue los soportes documentales exigidos para el proceso de debida diligencia. Formatos admitidos: PDF, JPG, PNG (máx. 20 MB por archivo).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {documentRequirements.map((req) => {
          const isMandatory = req.mandatory === 'always' || req.mandatory === 'conditional';
          const deliveredDoc = documents.find((d) => d.documentType === req.key);
          const state = uploadState[req.key] || { status: 'idle' };
          const isLoading =
            state.status === 'requesting' ||
            state.status === 'uploading' ||
            state.status === 'confirming';

          return (
            <div
              key={req.key}
              className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-4 bg-zinc-50/30 dark:bg-zinc-900/30"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm capitalize">
                      {req.key.replace(/_/g, ' ')}
                    </span>
                    {isMandatory ? (
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        Obligatorio
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        Opcional
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">Estándar: {req.standard}</span>
                </div>

                <div>
                  {deliveredDoc ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Ya entregado (v{deliveredDoc.version})
                      </span>
                      {deliveredDoc.id !== 'just-uploaded' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(deliveredDoc.id)}
                          disabled={downloadingDocId === deliveredDoc.id}
                          className="h-7 text-xs gap-1"
                        >
                          {downloadingDocId === deliveredDoc.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          Descargar
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <Clock className="w-3.5 h-3.5" />
                      Pendiente
                    </span>
                  )}
                </div>
              </div>

              {/* Optional metadata inputs: emisor, fecha expedición, fecha vencimiento */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                    <Building className="w-3 h-3" />
                    Emisor (opcional)
                  </Label>
                  <Input
                    type="text"
                    placeholder="Ej. DIAN, Cámara de Comercio"
                    className="h-8 text-xs"
                    disabled={isLoading}
                    value={metadata[req.key]?.declaredIssuer || ''}
                    onChange={(e) => handleMetadataChange(req.key, 'declaredIssuer', e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                    <Calendar className="w-3 h-3" />
                    Fecha expedición (opcional)
                  </Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    disabled={isLoading}
                    value={metadata[req.key]?.issuedAt || ''}
                    onChange={(e) => handleMetadataChange(req.key, 'issuedAt', e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
                    <Calendar className="w-3 h-3" />
                    Fecha vencimiento (opcional)
                  </Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    disabled={isLoading}
                    value={metadata[req.key]?.expiresAt || ''}
                    onChange={(e) => handleMetadataChange(req.key, 'expiresAt', e.target.value)}
                  />
                </div>
              </div>

              {/* Upload Input & Progress */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      disabled={isLoading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleFileSelect(req.key, file);
                        }
                        // Reset target so same file can be chosen again if needed
                        e.target.value = '';
                      }}
                    />
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors">
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {deliveredDoc ? 'Reemplazar archivo' : 'Seleccionar archivo'}
                      </span>
                    </div>
                  </label>
                  <span className="text-[11px] text-zinc-500">PDF, JPG, PNG (máx. 20 MB)</span>
                </div>

                {isLoading && (
                  <div className="flex items-center gap-1.5 text-xs text-sky-600 dark:text-sky-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {state.status === 'requesting' && 'Solicitando subida...'}
                      {state.status === 'uploading' && 'Subiendo archivo...'}
                      {state.status === 'confirming' && 'Verificando formato e integridad...'}
                    </span>
                  </div>
                )}
              </div>

              {state.status === 'error' && state.error && (
                <Alert variant="destructive" className="py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <AlertDescription>{state.error}</AlertDescription>
                  </div>
                </Alert>
              )}

              {state.status === 'success' && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Archivo {state.fileName ? `"${state.fileName}"` : ''} cargado y verificado correctamente.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
