'use client';

import { useActionState } from 'react';
import { acceptAsNewUserAction, type InvitationActionResult } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface SetupAccountFormProps {
  token: string;
  email: string;
  organizationName: string;
}

export function SetupAccountForm({ token, email, organizationName }: SetupAccountFormProps) {
  const actionWithToken = acceptAsNewUserAction.bind(null, token);
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

      <input type="hidden" name="email" value={email} />

      <div className="space-y-1.5">
        <Label htmlFor="email-display">Correo electrónico</Label>
        <Input
          id="email-display"
          type="email"
          value={email}
          disabled
          className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
        />
        <p className="text-[11px] text-zinc-500">
          La invitación fue emitida específicamente para este correo.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fullName">Nombre completo</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          placeholder="Ej. Juan Pérez"
          required
          autoComplete="name"
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Crear contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Mínimo 8 caracteres"
          required
          minLength={8}
          autoComplete="new-password"
          disabled={isPending}
        />
      </div>

      <Button type="submit" className="w-full mt-2" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Configurando cuenta...
          </>
        ) : (
          `Aceptar invitación y unirse a ${organizationName}`
        )}
      </Button>
    </form>
  );
}
