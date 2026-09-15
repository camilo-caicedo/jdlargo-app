'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { ShieldCheck, XCircle, CheckCircle2, Loader2, Info } from 'lucide-react';
import { submitConsentAction } from './consent-actions';
import type { PrivacyNoticePurpose } from '@/server/configuration/privacy-notice';

interface PrivacyNoticeFormProps {
  token: string;
  dossierId: string;
  organizationId: string;
  privacyNoticeId: string;
  text: string;
  purposes: PrivacyNoticePurpose[];
  dataController: string;
  dataProcessor: string;
  rightsChannels: string;
}

export function PrivacyNoticeForm({
  token,
  dossierId,
  organizationId,
  privacyNoticeId,
  text,
  purposes,
  dataController,
  dataProcessor,
  rightsChannels,
}: PrivacyNoticeFormProps) {
  const [isPending, startTransition] = useTransition();

  const handleDecision = (decision: 'accepted' | 'not_accepted') => {
    startTransition(async () => {
      const res = await submitConsentAction(
        token,
        dossierId,
        organizationId,
        privacyNoticeId,
        decision,
      );
      if (!res.success) {
        toast.error(res.error || 'Ocurrió un error al procesar su respuesta.');
      }
    });
  };

  return (
    <Card className="w-full max-w-4xl mx-auto shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 mb-1">
          <ShieldCheck className="w-5 h-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">Aviso de Privacidad y Tratamiento de Datos</span>
        </div>
        <CardTitle className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          Autorización para el tratamiento de datos personales
        </CardTitle>
        <CardDescription>
          Por favor lea atentamente las finalidades del tratamiento antes de continuar con el diligenciamiento de su debida diligencia.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Text statement */}
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-line leading-relaxed max-h-60 overflow-y-auto">
          {text}
        </div>

        {/* Purposes breakdown */}
        {purposes && purposes.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
              Finalidades del tratamiento declaradas:
            </h4>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-xs">
              {purposes.map((p) => (
                <div key={p.key} className="p-3 flex items-start justify-between gap-3 bg-white dark:bg-zinc-950">
                  <div className="space-y-0.5">
                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{p.key}</span>
                    <p className="text-zinc-600 dark:text-zinc-400">{p.description}</p>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium ${
                      p.requiresAuthorization
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {p.requiresAuthorization ? 'Requiere autorización' : 'Base jurídica legal'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Responsible entities and rights channels */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60">
          <div>
            <span className="text-zinc-400 font-medium">Responsable del tratamiento:</span>
            <div className="font-semibold text-zinc-800 dark:text-zinc-200">{dataController}</div>
          </div>
          <div>
            <span className="text-zinc-400 font-medium">Encargado de la plataforma:</span>
            <div className="font-semibold text-zinc-800 dark:text-zinc-200">{dataProcessor}</div>
          </div>
          <div className="sm:col-span-2 pt-1">
            <span className="text-zinc-400 font-medium">Canales para ejercicio de derechos (Habeas Data):</span>
            <div className="font-medium text-zinc-800 dark:text-zinc-200">{rightsChannels}</div>
          </div>
        </div>

        <div className="text-[11px] text-zinc-500 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-zinc-400" />
          <span>
            Su decisión quedará registrada de forma inmutable con fecha, hora, dirección IP y copia exacta de este texto como constancia legal de debida diligencia.
          </span>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => handleDecision('not_accepted')}
          className="w-full sm:w-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 border-red-200 dark:border-red-900 inline-flex items-center gap-2"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          No autorizo el tratamiento
        </Button>

        <Button
          type="button"
          disabled={isPending}
          onClick={() => handleDecision('accepted')}
          className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-2"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          Autorizo y continuar
        </Button>
      </CardFooter>
    </Card>
  );
}
