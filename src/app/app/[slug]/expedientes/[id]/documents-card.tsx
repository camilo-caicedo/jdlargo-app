'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FileText,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  downloadDocumentAction,
  markDocumentValidAction,
  rejectDocumentAction,
} from '../actions';

export interface DocumentRowDTO {
  id: string;
  documentType: string;
  version: number;
  format: string;
  state: string;
  size: number;
  uploadedByType: string;
  rejectionReason?: string | null;
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

interface DocumentsCardProps {
  organizationId: string;
  dossierId: string;
  dossierState: string;
  canReviewDocuments: boolean;
  documents: DocumentRowDTO[];
}

export function DocumentsCard({
  organizationId,
  dossierId,
  dossierState,
  canReviewDocuments,
  documents,
}: DocumentsCardProps) {
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [downloadIntegrityStatus, setDownloadIntegrityStatus] = React.useState<Record<string, boolean>>({});
  const [actionInProgressId, setActionInProgressId] = React.useState<string | null>(null);
  const [rejectingDocId, setRejectingDocId] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState<string>('');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const isReviewable = dossierState === 'en_revision' && canReviewDocuments;

  const handleDownload = async (docId: string) => {
    setDownloadingId(docId);
    try {
      const res = await downloadDocumentAction(organizationId, dossierId, docId);
      if (res.success && res.url) {
        if (res.integrityMatches !== undefined) {
          setDownloadIntegrityStatus((prev) => ({ ...prev, [docId]: res.integrityMatches! }));
        }
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        alert(res.error || 'Error al obtener enlace de descarga');
      }
    } catch {
      alert('Error de conexión al descargar el documento');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleMarkValid = async (docId: string) => {
    setActionInProgressId(docId);
    setErrorMessage(null);
    try {
      const res = await markDocumentValidAction(organizationId, dossierId, docId);
      if (!res.success) {
        setErrorMessage(res.error || 'Error al marcar documento como válido');
      }
    } catch {
      setErrorMessage('Error de conexión al marcar documento');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleReject = async (docId: string) => {
    if (!rejectReason.trim()) {
      alert('Debe indicar un motivo explícito para el rechazo');
      return;
    }

    setActionInProgressId(docId);
    setErrorMessage(null);
    try {
      const res = await rejectDocumentAction(organizationId, dossierId, docId, rejectReason.trim());
      if (!res.success) {
        setErrorMessage(res.error || 'Error al rechazar documento');
      } else {
        setRejectingDocId(null);
        setRejectReason('');
      }
    } catch {
      setErrorMessage('Error de conexión al rechazar documento');
    } finally {
      setActionInProgressId(null);
    }
  };

  const renderStateBadge = (state: string) => {
    switch (state) {
      case 'valid':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            Válido
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            <XCircle className="w-3 h-3" />
            Rechazado
          </span>
        );
      case 'received':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            <Clock className="w-3 h-3" />
            Recibido
          </span>
        );
    }
  };

  return (
    <Card className="shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-zinc-500" />
            Documentos cargados
          </CardTitle>
          <span className="text-xs text-zinc-400 font-mono">
            {documents.length} {documents.length === 1 ? 'archivo' : 'archivos'}
          </span>
        </div>
        <CardDescription className="text-xs">
          Evidencia documental recibida con huella digital SHA-256 verificada.
        </CardDescription>
        {errorMessage && (
          <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 pt-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {errorMessage}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {documents.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400 italic">
            No se han cargado documentos para este expediente todavía.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
            {documents.map((doc) => {
              const isLoading = actionInProgressId === doc.id;
              const isRejecting = rejectingDocId === doc.id;

              return (
                <li key={doc.id} className="p-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200 capitalize">
                          {doc.documentType.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                          v{doc.version}
                        </span>
                        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                          {doc.format}
                        </span>
                        {renderStateBadge(doc.state)}
                      </div>

                      <div className="text-[11px] text-zinc-400 flex items-center gap-2 flex-wrap">
                        <span>{(doc.size / 1024).toFixed(1)} KB</span>
                        <span>•</span>
                        <span>
                          Cargado por: {doc.uploadedByType === 'counterparty' ? 'Contraparte' : 'Usuario interno'}
                        </span>
                        <span>•</span>
                        <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                        {doc.reviewedAt && (
                          <>
                            <span>•</span>
                            <span className="text-zinc-500 font-mono">
                              Revisado {new Date(doc.reviewedAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>

                      {downloadIntegrityStatus[doc.id] !== undefined && (
                        <div className="pt-0.5">
                          {downloadIntegrityStatus[doc.id] ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Huella verificada ✓
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 font-medium bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded border border-rose-200/60 dark:border-rose-800/40">
                              <AlertCircle className="w-3.5 h-3.5" />
                              ⚠ La huella no coincide con la registrada — documento marcado para revisión
                            </span>
                          )}
                        </div>
                      )}

                      {doc.state === 'rejected' && doc.rejectionReason && (
                        <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 p-2 rounded-md border border-rose-100 dark:border-rose-900/50">
                          <strong>Motivo de rechazo:</strong> {doc.rejectionReason}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(doc.id)}
                        disabled={downloadingId === doc.id || isLoading}
                        className="h-8 text-xs gap-1.5"
                      >
                        {downloadingId === doc.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        Descargar
                      </Button>

                      {isReviewable && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={doc.state === 'valid' || isLoading}
                            onClick={() => handleMarkValid(doc.id)}
                            className="h-8 text-xs gap-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                          >
                            {isLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                            Válido
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            disabled={doc.state === 'rejected' || isLoading}
                            onClick={() => {
                              if (isRejecting) {
                                setRejectingDocId(null);
                                setRejectReason('');
                              } else {
                                setRejectingDocId(doc.id);
                                setRejectReason(doc.rejectionReason || '');
                              }
                            }}
                            className="h-8 text-xs gap-1 text-rose-700 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/50"
                          >
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            {isRejecting ? 'Cancelar' : 'Rechazar'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {isRejecting && (
                    <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-md border border-zinc-200 dark:border-zinc-800 space-y-2">
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Indique el motivo por el cual rechaza este documento:
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Ej: Documento borroso, vencido o no corresponde al titular"
                          className="h-8 text-xs"
                          disabled={isLoading}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isLoading || !rejectReason.trim()}
                          onClick={() => handleReject(doc.id)}
                          className="h-8 text-xs shrink-0 gap-1"
                        >
                          {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                          Confirmar rechazo
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
