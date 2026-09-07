'use client';

import { useActionState, useEffect, useRef } from 'react';
import { inviteMemberAction, type MemberActionState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, MailPlus } from 'lucide-react';

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

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state?.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state?.success && state.message && (
        <Alert className="border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
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
