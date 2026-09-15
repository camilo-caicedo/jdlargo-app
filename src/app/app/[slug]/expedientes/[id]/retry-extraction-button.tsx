'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
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

  const handleRetry = async () => {
    setIsPending(true);

    try {
      const result = await retryDocumentExtractionAction(
        organizationId,
        dossierId,
        documentId,
        slug,
      );

      if (result.success) {
        toast.success(result.summary || 'Nueva lectura completada');
        router.refresh();
      } else {
        toast.error(result.error || 'Error al reintentar extracción');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de conexión');
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
    </div>
  );
}
