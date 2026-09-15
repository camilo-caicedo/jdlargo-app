'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
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

  const handleExtraction = async () => {
    setIsPending(true);

    try {
      const result = await runExtractionForPendingDocumentsAction(
        organizationId,
        dossierId,
        slug,
      );

      if (result.success) {
        toast.success(result.summary || 'Extracción completada');
        router.refresh();
      } else {
        toast.error(result.error || 'Error al ejecutar extracción');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de conexión');
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
    </div>
  );
}
