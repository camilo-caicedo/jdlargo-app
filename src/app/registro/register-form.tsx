'use client';

import * as React from 'react';
import { useState, useActionState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, MailCheck, ArrowRight, ArrowLeft } from 'lucide-react';
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

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD') // Quitar tildes y diacríticos
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // Caracteres no alfanuméricos por guion
    .replace(/^-+|-+$/g, '') // Quitar guiones al inicio y fin
    .slice(0, 50);
}

export function RegisterForm({ initialError }: RegisterFormProps) {
  const [state, formAction, isPending] = useActionState(registerAccount, initialState);
  const [step, setStep] = useState<'account' | 'organization'>('account');
  const [showPassword, setShowPassword] = useState(false);

  // Form field state to guarantee persistent values across wizard navigation
  const [fullName, setFullName] = useState(state.defaultValues?.fullName || '');
  const [email, setEmail] = useState(state.defaultValues?.email || '');
  const [password, setPassword] = useState(state.defaultValues?.password || '');
  const [orgName, setOrgName] = useState(state.defaultValues?.orgName || '');
  const [slug, setSlug] = useState(state.defaultValues?.slug || '');
  const [slugEditedManually, setSlugEditedManually] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // If an error returns from the server, ensure we stay on the organization step where the submit was triggered
  const [prevStatus, setPrevStatus] = useState(state.status);
  if (state.status !== prevStatus) {
    setPrevStatus(state.status);
    if (state.status === 'error') {
      setStep('organization');
      if (state.defaultValues?.slug) {
        setSlugEditedManually(true);
      }
    }
  }

  const handleOrgNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setOrgName(newName);
    if (!slugEditedManually) {
      setSlug(slugify(newName));
    }
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
    setSlugEditedManually(true);
  };

  const handleContinue = (e: React.MouseEvent) => {
    e.preventDefault();
    setStep1Error(null);

    if (!fullName.trim() || fullName.trim().length < 2) {
      setStep1Error('El nombre completo debe tener al menos 2 caracteres.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setStep1Error('Ingrese un correo institucional válido.');
      return;
    }
    if (!password || password.length < 8) {
      setStep1Error('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setStep('organization');
  };

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
      {/* Hidden inputs to guarantee all fields are sent in the FormData regardless of active step */}
      <input type="hidden" name="fullName" value={fullName} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="password" value={password} />
      <input type="hidden" name="orgName" value={orgName} />
      <input type="hidden" name="slug" value={slug} />

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

      {step1Error && (
        <Alert variant="destructive">
          <AlertDescription>{step1Error}</AlertDescription>
        </Alert>
      )}

      {/* Indicator of steps */}
      <div className="flex items-center justify-between pb-1 border-b border-zinc-100 dark:border-zinc-800 text-xs font-medium text-zinc-500">
        <span className={step === 'account' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
          1. Tu cuenta
        </span>
        <span className="text-zinc-300 dark:text-zinc-700">→</span>
        <span className={step === 'organization' ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : ''}>
          2. Tu organización
        </span>
      </div>

      {/* STEP 1: Tu cuenta */}
      {step === 'account' && (
        <div className="space-y-4 pt-1">
          <div className="space-y-1.5 text-left">
            <Label htmlFor="fullName">Nombre completo</Label>
            <Input
              id="fullName"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="María Gómez"
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5 text-left">
            <Label htmlFor="email">Correo institucional</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@empresa.com"
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5 text-left">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

          <Button
            type="button"
            onClick={handleContinue}
            className="w-full font-medium mt-2 inline-flex items-center justify-center gap-2"
            disabled={isPending}
          >
            <span>Continuar</span>
            <ArrowRight className="h-4 w-4" />
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
        </div>
      )}

      {/* STEP 2: Tu organización */}
      {step === 'organization' && (
        <div className="space-y-4 pt-1">
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 p-3 border border-zinc-200/80 dark:border-zinc-800 text-left">
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Vas a crear el espacio de trabajo de tu empresa en la plataforma. Cada organización tiene sus propios expedientes, contrapartes y configuración — más adelante podrás invitar a los miembros de tu equipo.
            </p>
          </div>

          <div className="space-y-1.5 text-left">
            <Label htmlFor="orgName">Nombre de tu empresa u organización</Label>
            <Input
              id="orgName"
              type="text"
              required
              value={orgName}
              onChange={handleOrgNameChange}
              placeholder="Transportes del Norte S.A.S."
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5 text-left">
            <Label htmlFor="slug">Identificador único (slug)</Label>
            <Input
              id="slug"
              type="text"
              required
              value={slug}
              onChange={handleSlugChange}
              placeholder="transportes-del-norte"
              disabled={isPending}
            />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Se usará en las direcciones web de tu organización. Usa solo minúsculas, números y guiones.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('account')}
              disabled={isPending}
              className="shrink-0 font-medium inline-flex items-center justify-center gap-1.5 px-3"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Volver</span>
            </Button>
            <Button
              type="submit"
              className="flex-1 font-medium truncate"
              disabled={isPending}
            >
              {isPending ? 'Creando cuenta...' : 'Crear cuenta y organización'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
