'use client';

import { useState } from 'react';
import { AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { requestSignatureOtpAction, signDossierAction } from './signature-actions';

interface SignatureSectionProps {
  token: string;
  dossierId: string;
  organizationId: string;
  accessTokenId: string;
  levelRequired: 1 | 2;
}

export function SignatureSection({
  token,
  dossierId,
  organizationId,
  accessTokenId,
  levelRequired,
}: SignatureSectionProps) {
  const [stage, setStage] = useState<'initial' | 'otp_requested' | 'signing' | 'success' | 'error'>('initial');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestOtp = async () => {
    setIsLoading(true);
    setError(null);

    const result = await requestSignatureOtpAction(token, accessTokenId, dossierId, organizationId);
    if (result.error) {
      setError(result.error);
      setStage('error');
    } else {
      setStage('otp_requested');
    }
    setIsLoading(false);
  };

  const handleSign = async () => {
    setIsLoading(true);
    setError(null);

    const result = await signDossierAction(
      token,
      dossierId,
      organizationId,
      accessTokenId,
      levelRequired === 2 ? otpCode : undefined,
    );

    if (result.error) {
      setError(result.error);
      setStage('error');
    } else {
      setStage('success');
    }
    setIsLoading(false);
  };

  const isOtpComplete = otpCode.length === 6;

  if (stage === 'success') {
    return (
      <Card className="w-full shadow-sm bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-emerald-900 dark:text-emerald-100">
                Expediente firmado correctamente
              </p>
              <p className="text-sm text-emerald-800 dark:text-emerald-200 mt-1">
                El expediente ha sido firmado y está pendiente de revisión. Será procesado según la política de su organización.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Revisar y Firmar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {levelRequired === 1 ? (
          // Level 1: Simple button
          <Button
            onClick={handleSign}
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Firmando...
              </>
            ) : (
              'Firmar Expediente'
            )}
          </Button>
        ) : (
          // Level 2: OTP flow
          <>
            {stage === 'initial' && (
              <Button
                onClick={handleRequestOtp}
                disabled={isLoading}
                className="w-full"
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enviando código...
                  </>
                ) : (
                  'Enviar Código de Verificación'
                )}
              </Button>
            )}

            {stage === 'otp_requested' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Código de 6 dígitos
                  </label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    placeholder="000000"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setOtpCode(val);
                    }}
                    className="text-center text-lg tracking-widest"
                  />
                </div>
                <Button
                  onClick={handleSign}
                  disabled={isLoading || !isOtpComplete}
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Firmando...
                    </>
                  ) : (
                    'Firmar Expediente'
                  )}
                </Button>
              </div>
            )}

            {stage === 'error' && (
              <Button
                onClick={() => {
                  setError(null);
                  setStage('initial');
                  setOtpCode('');
                }}
                variant="outline"
                className="w-full"
                size="lg"
              >
                Reintentar
              </Button>
            )}
          </>
        )}

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Al firmar, confirma que la información declarada es correcta y completa.
        </p>
      </CardContent>
    </Card>
  );
}
