'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCheck, RotateCcw, Loader2, AlertCircle, X } from 'lucide-react';
import { requestCorrectionsAction, completeReviewAction } from '../actions';

interface ReviewActionsBoxProps {
  organizationId: string;
  dossierId: string;
  canReview: boolean;
}

export function ReviewActionsBox({
  organizationId,
  dossierId,
  canReview,
}: ReviewActionsBoxProps) {
  const [isCorrectionsOpen, setIsCorrectionsOpen] = React.useState(false);
  const [correctionsReason, setCorrectionsReason] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  if (!canReview) {
    return null;
  }

  const handleRequestCorrections = async () => {
    if (!correctionsReason.trim()) {
      alert('Debe indicar un motivo para solicitar correcciones');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await requestCorrectionsAction(
        organizationId,
        dossierId,
        correctionsReason.trim(),
      );
      if (res.success) {
        setIsCorrectionsOpen(false);
        setCorrectionsReason('');
      } else {
        setErrorMessage(res.error || 'Error al solicitar correcciones');
      }
    } catch {
      setErrorMessage('Error de conexión al solicitar correcciones');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteReview = async () => {
    if (!confirm('¿Confirma que todos los requisitos y documentos han sido revisados y validados?')) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await completeReviewAction(organizationId, dossierId);
      if (!res.success) {
        setErrorMessage(res.error || 'No se puede dar por revisado el expediente');
      }
    } catch {
      setErrorMessage('Error de conexión al dar por revisado el expediente');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCorrectionsOpen(true)}
          disabled={isLoading}
          className="text-xs gap-1 text-amber-700 hover:text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Solicitar correcciones
        </Button>

        <Button
          size="sm"
          onClick={handleCompleteReview}
          disabled={isLoading}
          className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCheck className="w-3.5 h-3.5" />
          )}
          Dar por revisado
        </Button>
      </div>

      {errorMessage && (
        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {errorMessage}
        </p>
      )}

      {/* Modal for requesting corrections */}
      {isCorrectionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className="relative w-full max-w-md rounded-xl bg-white dark:bg-zinc-900 p-6 shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-4 animate-in fade-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Solicitar correcciones a la contraparte
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                  El expediente volverá al estado de diligenciamiento y la contraparte podrá ingresar con su enlace para corregir o reenviar los datos y documentos observados.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !isLoading && setIsCorrectionsOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                disabled={isLoading}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 py-2">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Motivo u observaciones de la corrección *
              </label>
              <Input
                value={correctionsReason}
                onChange={(e) => setCorrectionsReason(e.target.value)}
                placeholder="Ej: El RUT no es legible y se requiere adjuntar certificación bancaria actualizada"
                className="text-xs"
                disabled={isLoading}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCorrectionsOpen(false)}
                disabled={isLoading}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleRequestCorrections}
                disabled={isLoading || !correctionsReason.trim()}
                className="text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Enviar solicitud
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
