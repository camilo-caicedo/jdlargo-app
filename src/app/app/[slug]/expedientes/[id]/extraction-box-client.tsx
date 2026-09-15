'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { runExtractionForPendingDocumentsAction } from '../actions';
import { useRouter } from 'next/navigation';

interface ExtractionBoxClientProps {
  organizationId: string;
  slug: string;
  dossierId: string;
  pendingCount: number;
  documentTypes: string[];
}

export function ExtractionBoxClient({
  organizationId,
  slug,
  dossierId,
  pendingCount,
  documentTypes,
}: ExtractionBoxClientProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleExtraction = async () => {
    setIsPending(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await runExtractionForPendingDocumentsAction(
        organizationId,
        dossierId,
        slug,
      );

      if (result.success) {
        setSuccessMessage(result.summary || 'Extracción completada');
        router.refresh();
      } else {
        setErrorMessage(result.error || 'Error al ejecutar extracción');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {pendingCount} documento(s) listo(s) para leer con IA
        </p>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          ({documentTypes.join(', ')})
        </span>
      </div>

      <Button
        onClick={handleExtraction}
        disabled={isPending}
        className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-700 dark:hover:bg-purple-600"
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Extrayendo...
          </>
        ) : (
          'Extraer datos con IA'
        )}
      </Button>

      {successMessage && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          ✓ {successMessage}
        </p>
      )}

      {errorMessage && (
        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {errorMessage}
        </p>
      )}
    </div>
  );
}
