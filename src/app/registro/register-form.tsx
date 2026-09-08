'use client';

import * as React from 'react';
import { useState, useActionState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { registerAccount, type RegisterState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

const initialState: RegisterState = {
  status: 'idle',
};

interface RegisterFormProps {
  initialError?: string | null;
}

export function RegisterForm({ initialError }: RegisterFormProps) {
  const [state, formAction, isPending] = useActionState(registerAccount, initialState);
  const [showPassword, setShowPassword] = useState(false);

  // If registration was requested and confirmation email sent
  if (state.status === 'check_email') {
    return (
      <div className="text-center py-4 space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 mb-1">
          <MailCheck className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Revisa tu correo electrónico
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Hemos enviado un enlace de confirmación a:
          </p>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {state.email}
          </p>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xs mx-auto">
          Por seguridad y cumplimiento regulatorio, haz clic en el enlace del correo para verificar tu cuenta y acceder a tu nueva organización.
        </p>
        <div className="pt-2">
          <Link
            href="/login"
            className="inline-flex items-center justify-center text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
          >
            Volver a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {initialError === 'missing_token' && (
        <Alert variant="destructive">
          <AlertDescription>
            El enlace de confirmación está incompleto o no contiene el token necesario.
          </AlertDescription>
        </Alert>
      )}

      {initialError === 'invalid_token' && (
        <Alert variant="destructive">
          <AlertDescription>
            El enlace de confirmación es inválido o ha expirado. Por favor intenta registrarte o iniciar sesión nuevamente.
          </AlertDescription>
        </Alert>
      )}

      {state.status === 'error' && state.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error}
            {state.error.includes('registrada') && (
              <span className="block mt-1">
                <Link href="/login" className="underline font-semibold hover:text-red-800 dark:hover:text-red-300">
                  Iniciar sesión aquí
                </Link>
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5 text-left">
        <Label htmlFor="fullName">Nombre completo</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          defaultValue={state.defaultValues?.fullName}
          placeholder="María Gómez"
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5 text-left">
        <Label htmlFor="email">Correo institucional</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.defaultValues?.email}
          placeholder="maria@empresa.com"
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
            autoComplete="new-password"
            required
            minLength={8}
            defaultValue={state.defaultValues?.password}
            placeholder="Mínimo 8 caracteres"
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

      <div className="space-y-1.5 text-left">
        <Label htmlFor="orgName">Nombre de tu empresa u organización</Label>
        <Input
          id="orgName"
          name="orgName"
          type="text"
          required
          defaultValue={state.defaultValues?.orgName}
          placeholder="Transportes del Norte S.A.S."
          disabled={isPending}
        />
      </div>

      <Button
        type="submit"
        className="w-full font-medium mt-2"
        disabled={isPending}
      >
        {isPending ? 'Creando cuenta...' : 'Crear cuenta y organización'}
      </Button>

      <div className="text-center pt-2">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          ¿Ya tienes una cuenta?{' '}
          <Link
            href="/login"
            className="font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 hover:underline"
          >
            Inicia sesión
          </Link>
        </p>
      </div>
    </form>
  );
}
