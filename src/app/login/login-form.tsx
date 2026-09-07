'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { signIn } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(signIn, null);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5 text-left">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="nombre@empresa.com"
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5 text-left">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          disabled={isPending}
        />
      </div>

      <Button
        type="submit"
        className="w-full font-medium mt-2"
        disabled={isPending}
      >
        {isPending ? 'Iniciando sesión...' : 'Iniciar sesión'}
      </Button>
    </form>
  );
}