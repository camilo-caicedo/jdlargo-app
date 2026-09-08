import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ShieldCheck, ShieldAlert, Clock, Info } from 'lucide-react';
import type { ConsentRecord } from '@/server/consent/consent';

interface ConsentCardProps {
  consent: ConsentRecord | null;
}

export function ConsentCard({ consent }: ConsentCardProps) {
  if (!consent) {
    return (
      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-500" />
            Evidencia del consentimiento
          </CardTitle>
          <CardDescription className="text-xs">
            Aviso de privacidad y tratamiento de datos personales.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="p-3 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300">
            Pendiente de resolución por la contraparte.
          </div>
          <p className="text-[11px] text-zinc-500">
            La contraparte debe aceptar o rechazar el aviso de privacidad al acceder a su enlace antes de suministrar cualquier información o documento.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isAccepted = consent.result === 'accepted';

  return (
    <Card className="shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            {isAccepted ? (
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
            )}
            Evidencia del consentimiento
          </CardTitle>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
              isAccepted
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
            }`}
          >
            {isAccepted ? 'Autorizado' : 'No autorizado'}
          </span>
        </div>
        <CardDescription className="text-xs">
          Registro inmutable de la decisión de la contraparte.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-xs">
        <div className="space-y-1.5 bg-zinc-50 dark:bg-zinc-800/60 p-3 rounded-lg text-[11px]">
          <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400">
            <span>Fecha y hora:</span>
            <span className="font-mono text-zinc-900 dark:text-zinc-100">
              {new Date(consent.occurredAt).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400">
            <span>Canal:</span>
            <span className="capitalize font-mono text-zinc-900 dark:text-zinc-100">{consent.channel}</span>
          </div>
          <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400">
            <span>Dirección IP:</span>
            <span className="font-mono text-zinc-900 dark:text-zinc-100">{consent.ipAddress}</span>
          </div>
        </div>

        {/* Text snapshot disclosure */}
        <details className="text-[11px] group cursor-pointer">
          <summary className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 font-medium inline-flex items-center gap-1 select-none">
            <Info className="w-3.5 h-3.5" />
            Ver texto exacto del aviso aceptado/rechazado
          </summary>
          <div className="mt-2 p-3 rounded bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 whitespace-pre-line text-[11px] max-h-40 overflow-y-auto font-sans leading-relaxed border border-zinc-200 dark:border-zinc-800">
            {consent.privacyNoticeTextSnapshot}
          </div>
        </details>

        {!isAccepted && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            Al no haberse otorgado el consentimiento, el expediente transita y se congela en estado de rechazo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
