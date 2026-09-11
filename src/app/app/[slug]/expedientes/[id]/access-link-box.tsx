'use client';

import * as React from 'react';
import { useActionState, useState } from 'react';
import { issueNewAccessLinkAction, revokeAccessLinkAction } from '../actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  KeyRound, 
  Copy, 
  Check, 
  ExternalLink, 
  RefreshCw, 
  AlertCircle,
  Loader2,
  Ban
} from 'lucide-react';

interface AccessLinkBoxProps {
  organizationId: string;
  dossierId: string;
  slug: string;
  activeLink: {
    id: string;
    recipientEmail: string;
    expiresAt: Date;
    state: string;
    requiresSecondFactor: boolean;
    isExpired: boolean;
  } | null;
  newlyCreatedRawToken?: string;
  canEdit: boolean;
}

export function AccessLinkBox({
  organizationId,
  dossierId,
  slug,
  activeLink,
  newlyCreatedRawToken,
  canEdit,
}: AccessLinkBoxProps) {
  const [copied, setCopied] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const actionWithParams = issueNewAccessLinkAction.bind(null, organizationId, dossierId, slug);
  const [renewState, renewFormAction, isPending] = useActionState(actionWithParams, null);

  // If a raw token is provided (either freshly created or just renewed), compute full public portal URL
  const activeRawToken = renewState?.rawToken || newlyCreatedRawToken;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const portalUrl = activeRawToken ? `${origin}/portal/access/${activeRawToken}` : '';

  const handleCopy = () => {
    if (portalUrl) {
      navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-200/70 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Enlace de acceso a la debida diligencia
          </h2>
        </div>

        {activeLink && !activeLink.isExpired && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 text-[11px] font-medium border border-emerald-200/50 dark:border-emerald-800/40">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Enlace activo (expira el {new Date(activeLink.expiresAt).toLocaleDateString()})
          </span>
        )}
      </div>

      {renewState?.error && (
        <Alert variant="destructive">
          <AlertDescription>{renewState.error}</AlertDescription>
        </Alert>
      )}

      {revokeError && (
        <Alert variant="destructive">
          <AlertDescription>{revokeError}</AlertDescription>
        </Alert>
      )}

      {activeRawToken ? (
        <div className="space-y-3 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-emerald-300 dark:border-emerald-800/70 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              Enlace generado y listo para compartir:
            </span>
            <span className="text-[11px] text-zinc-400">
              Copiar ahora (el token raw no se volverá a mostrar por seguridad)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={portalUrl}
              className="font-mono text-xs bg-zinc-50 dark:bg-zinc-800/70 border-emerald-200 dark:border-emerald-900/60"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="shrink-0 gap-1.5 text-xs font-medium border-emerald-300 dark:border-emerald-800"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copiar
                </>
              )}
            </Button>
            <a href={portalUrl} target="_blank" rel="noreferrer">
              <Button type="button" size="sm" variant="ghost" className="shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
          </div>
        </div>
      ) : activeLink ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          <div className="space-y-1 text-xs">
            <div className="text-zinc-600 dark:text-zinc-400">
              Destinatario: <strong className="text-zinc-800 dark:text-zinc-200">{activeLink.recipientEmail}</strong>
            </div>
            <div className="text-zinc-500 text-[11px]">
              Vigente hasta: {new Date(activeLink.expiresAt).toLocaleString()}
              {activeLink.requiresSecondFactor && ' • Requiere OTP de segundo factor'}
            </div>
            {activeLink.isExpired && (
              <div className="text-red-600 dark:text-red-400 font-medium text-[11px] flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                El enlace anterior ha caducado.
              </div>
            )}
          </div>

          {canEdit && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRenewing((prev) => !prev)}
                className="text-xs font-medium gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {activeLink.isExpired ? 'Emitir nuevo enlace' : 'Reemplazar enlace'}
              </Button>

              {!activeLink.isExpired && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isRevoking}
                  onClick={async () => {
                    const confirmed = window.confirm(
                      '¿Está seguro de que desea revocar el enlace de acceso? La contraparte ya no podrá acceder con este enlace.',
                    );
                    if (!confirmed) return;
                    setIsRevoking(true);
                    setRevokeError(null);
                    try {
                      const res = await revokeAccessLinkAction(organizationId, dossierId);
                      if (!res.success) {
                        setRevokeError(res.error || 'Error al revocar el enlace');
                      }
                    } catch (err: unknown) {
                      setRevokeError(err instanceof Error ? err.message : 'Error inesperado');
                    } finally {
                      setIsRevoking(false);
                    }
                  }}
                  className="text-xs font-medium gap-1.5"
                >
                  {isRevoking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Ban className="w-3.5 h-3.5" />
                  )}
                  Revocar enlace
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs text-zinc-500">
            Aún no se ha emitido un enlace de acceso para que la contraparte diligencie su información.
          </div>
          {canEdit && (
            <Button
              type="button"
              size="sm"
              onClick={() => setIsRenewing(true)}
              className="text-xs font-medium gap-1.5 shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Generar enlace de acceso
            </Button>
          )}
        </div>
      )}

      {/* Renew Form Modal / Drawer Inline */}
      {isRenewing && canEdit && (
        <form action={renewFormAction} className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Generar y enviar nuevo enlace de acceso
            </h4>
            <button
              type="button"
              onClick={() => setIsRenewing(false)}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              Cerrar
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recipientEmail" className="text-xs">Correo del destinatario</Label>
            <Input
              id="recipientEmail"
              name="recipientEmail"
              type="email"
              required
              defaultValue={activeLink?.recipientEmail || ''}
              placeholder="contacto@contraparte.com"
              disabled={isPending}
              className="text-xs"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              id="requiresSecondFactorRenew"
              name="requiresSecondFactor"
              type="checkbox"
              disabled={isPending}
              className="rounded border-zinc-300 dark:border-zinc-700 text-emerald-600 h-4 w-4"
            />
            <Label htmlFor="requiresSecondFactorRenew" className="text-xs font-normal text-zinc-600 dark:text-zinc-400 cursor-pointer">
              Exigir segundo factor de autenticación (código OTP).
            </Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsRenewing(false)}
              disabled={isPending}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="text-xs font-medium inline-flex items-center gap-1.5"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Emitiendo...
                </>
              ) : (
                'Emitir y enviar enlace'
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
