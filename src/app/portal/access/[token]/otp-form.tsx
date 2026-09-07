'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { verifyPortalOtp } from './actions';

interface OtpFormProps {
  accessTokenId: string;
}

interface FormValues {
  code: string;
}

export function OtpForm({ accessTokenId }: OtpFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      code: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    setIsSubmitting(true);

    try {
      const res = await verifyPortalOtp(accessTokenId, values.code);
      if (!res.success) {
        setServerError(res.error || 'Código incorrecto');
        setIsSubmitting(false);
        return;
      }

      // Success: reload the server component to proceed into the dossier view
      router.refresh();
    } catch {
      setServerError('Ocurrió un error al verificar el código. Intente de nuevo.');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <label
          htmlFor="code"
          className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block text-center"
        >
          Código de 6 dígitos
        </label>
        <Input
          id="code"
          type="text"
          maxLength={6}
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={isSubmitting}
          className="text-center tracking-widest text-lg font-mono font-bold uppercase"
          {...register('code', {
            required: 'El código es obligatorio',
            pattern: {
              value: /^[0-9]{6}$/,
              message: 'Debe contener 6 dígitos numéricos',
            },
          })}
        />
        {errors.code && (
          <p className="text-xs text-red-500 text-center">{errors.code.message}</p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full font-medium"
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Verificando...' : 'Verificar código'}
      </Button>
    </form>
  );
}
