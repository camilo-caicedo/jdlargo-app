'use client';

import * as React from 'react';
import { useState, useActionState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { signIn } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(signIn, null);
  const [showPassword, setShowPassword] = useState(false);

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
          defaultValue={state?.defaultEmail}
          placeholder="nombre@empresa.com"
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5 text-left">
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            defaultValue={state?.defaultPassword}
            placeholder="••••••••"
            disabled={isPending}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            disabled={isPending}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        className="w-full font-medium mt-2"
        disabled={isPending}
      >
        {isPending ? 'Iniciando sesión...' : 'Iniciar sesión'}
      </Button>

      <div className="text-center pt-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          ¿No tienes cuenta?{' '}
          <Link
            href="/registro"
            className="font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
          >
            Regístrate
          </Link>
        </p>
      </div>
    </form>
  );
}