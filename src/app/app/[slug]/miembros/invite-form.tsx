'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { inviteMemberAction, type MemberActionState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast';
import { Loader2, MailPlus, Copy, Check } from 'lucide-react';

interface RoleOption {
  code: string;
  name: string;
}

interface InviteMemberFormProps {
  organizationId: string;
  roles: RoleOption[];
}

export function InviteMemberForm({ organizationId, roles }: InviteMemberFormProps) {
  const actionWithOrg = inviteMemberAction.bind(null, organizationId);
  const [state, formAction, isPending] = useActionState<MemberActionState | null, FormData>(
    actionWithOrg,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state?.error) {
      toast.error(state.error);
    }
  }, [state?.error]);

  useEffect(() => {
    if (state?.success && state.message) {
      toast.success(state.message);
      formRef.current?.reset();
    }
  }, [state?.success, state?.message]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const invitationUrl = state?.rawToken ? `${origin}/invitaciones/${state.rawToken}` : '';

  const handleCopy = async () => {
    if (!invitationUrl) return;
    await navigator.clipboard.writeText(invitationUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state?.success && state.rawToken && (
        <div className="space-y-3 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-emerald-300 dark:border-emerald-800/70 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              Invitación creada — copie el enlace y envíelo manualmente si el correo no llega:
            </span>
            <span className="text-[11px] text-zinc-400">
              Copiar ahora (el token raw no se volverá a mostrar por seguridad)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={invitationUrl}
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
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo electrónico de la persona</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="colaborador@empresa.com"
            required
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="role">Rol en la organización</Label>
          <select
            id="role"
            name="role"
            required
            disabled={isPending}
            defaultValue=""
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900"
          >
            <option value="" disabled>Seleccione un rol...</option>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Enviando invitación...
            </>
          ) : (
            <>
              <MailPlus className="mr-2 h-4 w-4" />
              Enviar invitación
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
