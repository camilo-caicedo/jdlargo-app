'use client';

import { useActionState } from 'react';
import { acceptForExistingUserAction, type InvitationActionResult } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface LoginToAcceptFormProps {
  token: string;
  email: string;
  organizationName: string;
}

export function LoginToAcceptForm({ token, email, organizationName }: LoginToAcceptFormProps) {
  const actionWithToken = acceptForExistingUserAction.bind(null, token);
  const [state, formAction, isPending] = useActionState<InvitationActionResult | null, FormData>(
    actionWithToken,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email-display">Correo electrónico</Label>
        <Input
          id="email-display"
          type="email"
          value={email}
          disabled
          className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
        />
        <input type="hidden" name="email" value={email} />
        <p className="text-[11px] text-zinc-500">
          Ya existe una cuenta con este correo. Ingrese su contraseña para vincular la membresía.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Su contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Contraseña actual"
          required
          autoComplete="current-password"
          disabled={isPending}
        />
      </div>

      <Button type="submit" className="w-full mt-2" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Iniciando sesión y aceptando...
          </>
        ) : (
          `Iniciar sesión y unirse a ${organizationName}`
        )}
      </Button>
    </form>
  );
}
