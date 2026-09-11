'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Download, Loader2 } from 'lucide-react';
import { downloadDocumentAction } from '../actions';

export interface DocumentRowDTO {
  id: string;
  documentType: string;
  version: number;
  format: string;
  state: string;
  size: number;
  uploadedByType: string;
  createdAt: string;
}

interface DocumentsCardProps {
  organizationId: string;
  dossierId: string;
  documents: DocumentRowDTO[];
}

export function DocumentsCard({
  organizationId,
  dossierId,
  documents,
}: DocumentsCardProps) {
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  const handleDownload = async (docId: string) => {
    setDownloadingId(docId);
    try {
      const res = await downloadDocumentAction(organizationId, dossierId, docId);
      if (res.success && res.url) {
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
      </CardHeader>
      <CardContent className="p-0">
        {documents.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400 italic">
            No se han cargado documentos para este expediente todavía.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
            {documents.map((doc) => (
              <li key={doc.id} className="p-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200 capitalize">
                      {doc.documentType.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      v{doc.version}
                    </span>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                      {doc.format}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                    <span>{(doc.size / 1024).toFixed(1)} KB</span>
                    <span>•</span>
                    <span>Cargado por: {doc.uploadedByType === 'counterparty' ? 'Contraparte' : 'Usuario interno'}</span>
                    <span>•</span>
                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(doc.id)}
                    disabled={downloadingId === doc.id}
                    className="h-8 text-xs gap-1.5"
                  >
                    {downloadingId === doc.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    Descargar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
