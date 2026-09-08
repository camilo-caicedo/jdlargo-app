'use client';

import * as React from 'react';
import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordReset, type RequestResetState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

const initialState: RequestResetState = {
  status: 'idle',
};

export function RequestResetForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  return (
    <div className="space-y-4">
      {state.status === 'sent' ? (
        <div className="space-y-4">
          <Alert className="bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200">
            <AlertDescription>
              Si el correo está registrado en la plataforma, te enviamos un enlace para restablecer tu contraseña. Por favor revisa tu bandeja de entrada (y la carpeta de spam).
            </AlertDescription>
          </Alert>

          <p className="text-xs text-muted-foreground text-center">
            El enlace es válido por tiempo limitado. Si no lo recibes, verifica que el correo ingresado sea el correcto o intenta de nuevo más tarde.
          </p>

          <div className="pt-2 text-center">
            <Link
              href="/login"
              className="text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
            >
              Volver a iniciar sesión
            </Link>
          </div>
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          {state.status === 'error' && state.error && (
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

          <Button
            type="submit"
            className="w-full font-medium mt-2"
            disabled={isPending}
          >
            {isPending ? 'Enviando enlace...' : 'Enviar enlace de recuperación'}
          </Button>

          <div className="text-center pt-2">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              ¿Recordaste tu contraseña?{' '}
              <Link
                href="/login"
                className="font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
              >
                Volver a iniciar sesión
              </Link>
            </p>
          </div>
        </form>
      )}
    </div>
  );
}