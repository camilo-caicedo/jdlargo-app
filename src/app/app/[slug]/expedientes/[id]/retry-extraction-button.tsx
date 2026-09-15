'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { retryDocumentExtractionAction } from '../actions';
import { useRouter } from 'next/navigation';

interface RetryExtractionButtonProps {
  organizationId: string;
  dossierId: string;
  documentId: string;
  slug: string;
}

export function RetryExtractionButton({
  organizationId,
  dossierId,
  documentId,
  slug,
}: RetryExtractionButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleRetry = async () => {
    setIsPending(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await retryDocumentExtractionAction(
        organizationId,
        dossierId,
        documentId,
        slug,
      );

      if (result.success) {
        setSuccessMessage(result.summary || 'Nueva lectura completada');
        router.refresh();
      } else {
        setErrorMessage(result.error || 'Error al reintentar extracción');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        onClick={handleRetry}
        disabled={isPending}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        {isPending ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Reintentando...
          </>
        ) : (
          'Reintentar extracción'
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
