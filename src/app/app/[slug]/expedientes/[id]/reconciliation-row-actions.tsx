'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Pencil, GitCompare, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  confirmExtractedFieldAction,
  discardExtractedFieldAction,
  correctExtractedFieldAction,
  resolveDiscrepancyAction,
} from './reconciliation-actions';

export interface ConflictingAssertion {
  id: string;
  value: unknown;
  origin: string;
  producedAt: string;
}

interface ReconciliationRowActionsProps {
  organizationId: string;
  slug: string;
  dossierId: string;
  field: string;
  extractedAssertionId: string | null;
  extractedValue: unknown;
  evidenceId: string | null;
  partyId: string;
  configurationVersionId: string;
  discrepancyAssertions: ConflictingAssertion[] | null;
}

export function ReconciliationRowActions({
  organizationId,
  slug,
  dossierId,
  field,
  extractedAssertionId,
  extractedValue,
  evidenceId,
  partyId,
  configurationVersionId,
  discrepancyAssertions,
}: ReconciliationRowActionsProps) {
  const router = useRouter();
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [discardPending, setDiscardPending] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctValue, setCorrectValue] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [correctPending, setCorrectPending] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);

  const [resolveOpen, setResolveOpen] = useState(false);
  const [selectedAssertionId, setSelectedAssertionId] = useState<string | null>(null);
  const [resolveReason, setResolveReason] = useState('');
  const [resolvePending, setResolvePending] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `hace ${days} día${days > 1 ? 's' : ''}`;
    if (hours > 0) return `hace ${hours} hora${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    return 'hace pocos segundos';
  };

  const handleConfirm = async () => {
    setConfirmPending(true);
    try {
      await confirmExtractedFieldAction(organizationId, slug, dossierId, extractedAssertionId!);
      toast.success('Valor confirmado.');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al confirmar');
    } finally {
      setConfirmPending(false);
    }
  };

  const handleDiscard = async () => {
    if (!discardReason.trim()) return;
    setDiscardPending(true);
    try {
      await discardExtractedFieldAction(organizationId, slug, dossierId, extractedAssertionId!, discardReason.trim());
      toast.success('Valor descartado.');
      setDiscardOpen(false);
      setDiscardReason('');
      router.refresh();
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : 'Error al descartar');
    } finally {
      setDiscardPending(false);
    }
  };

  const handleCorrect = async () => {
    if (!correctValue.trim() || !correctReason.trim()) return;
    setCorrectPending(true);
    try {
      await correctExtractedFieldAction(
        organizationId,
        slug,
        dossierId,
        extractedAssertionId!,
        correctValue.trim(),
        correctReason.trim(),
        evidenceId || '',
        partyId,
        configurationVersionId,
      );
      toast.success('Valor corregido.');
      setCorrectOpen(false);
      setCorrectValue('');
      setCorrectReason('');
      router.refresh();
    } catch (err) {
      setCorrectError(err instanceof Error ? err.message : 'Error al corregir');
    } finally {
      setCorrectPending(false);
    }
  };

  const handleResolve = async () => {
    if (!selectedAssertionId || !resolveReason.trim()) return;
    setResolvePending(true);
    try {
      await resolveDiscrepancyAction(organizationId, slug, dossierId, field, selectedAssertionId, resolveReason.trim());
      toast.success('Discrepancia resuelta.');
      setResolveOpen(false);
      setSelectedAssertionId(null);
      setResolveReason('');
      router.refresh();
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Error al resolver discrepancia');
    } finally {
      setResolvePending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {discrepancyAssertions && (
          <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={resolvePending}
                    onClick={() => setResolveOpen(true)}
                  />
                }
              >
                {resolvePending ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <GitCompare className="w-4 h-4 text-primary" />
                )}
              </TooltipTrigger>
              <TooltipContent>Resolver discrepancia entre valores en conflicto</TooltipContent>
            </Tooltip>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Resolver discrepancia</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Seleccionar valor correcto</label>
                  <div className="space-y-2">
                    {discrepancyAssertions.map((assertion) => (
                      <label key={assertion.id} className="flex items-start gap-3 p-2 rounded border hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                        <input
                          type="radio"
                          name="assertion_choice"
                          value={assertion.id}
                          checked={selectedAssertionId === assertion.id}
                          onChange={(e) => setSelectedAssertionId(e.target.value)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-mono">{String(assertion.value)}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {assertion.origin} · {formatTimeAgo(assertion.producedAt)}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="resolve-reason" className="text-sm font-medium">
                    Motivo <span className="text-rose-600">*</span>
                  </label>
                  <Textarea
                    id="resolve-reason"
                    value={resolveReason}
                    onChange={(e) => setResolveReason(e.target.value)}
                    placeholder="Explique por qué resuelve la discrepancia de esta manera..."
                    required
                    className="min-h-24"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setResolveOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  disabled={!selectedAssertionId || !resolveReason.trim() || resolvePending}
                  onClick={handleResolve}
                >
                  {resolvePending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Resolver
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {extractedAssertionId && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button size="icon-sm" variant="ghost" disabled={confirmPending} onClick={handleConfirm} />
                }
              >
                {confirmPending ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                )}
              </TooltipTrigger>
              <TooltipContent>Confirmar el valor extraído por IA</TooltipContent>
            </Tooltip>

            <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={discardPending}
                      onClick={() => setDiscardOpen(true)}
                    />
                  }
                >
                  <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                </TooltipTrigger>
                <TooltipContent>Descartar el valor extraído por IA</TooltipContent>
              </Tooltip>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Descartar valor extraído</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="discard-reason" className="text-sm font-medium">
                      Motivo <span className="text-rose-600">*</span>
                    </label>
                    <Textarea
                      id="discard-reason"
                      value={discardReason}
                      onChange={(e) => setDiscardReason(e.target.value)}
                      placeholder="Explique por qué descarta este valor..."
                      required
                      className="min-h-24"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={!discardReason.trim() || discardPending}
                    onClick={handleDiscard}
                  >
                    {discardPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    Descartar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={correctPending}
                      onClick={() => setCorrectOpen(true)}
                    />
                  }
                >
                  <Pencil className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </TooltipTrigger>
                <TooltipContent>Corregir manualmente el valor</TooltipContent>
              </Tooltip>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Corregir valor</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="bg-zinc-50 dark:bg-zinc-900 p-2 rounded">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Valor extraído actual</p>
                    <p className="text-sm font-mono">{String(extractedValue)}</p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="correct-value" className="text-sm font-medium">
                      Valor correcto <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      id="correct-value"
                      value={correctValue}
                      onChange={(e) => setCorrectValue(e.target.value)}
                      placeholder="Ingrese el valor correcto..."
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="correct-reason" className="text-sm font-medium">
                      Motivo <span className="text-rose-600">*</span>
                    </label>
                    <Textarea
                      id="correct-reason"
                      value={correctReason}
                      onChange={(e) => setCorrectReason(e.target.value)}
                      placeholder="Explique por qué corrige este valor..."
                      required
                      className="min-h-24"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setCorrectOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    disabled={!correctValue.trim() || !correctReason.trim() || correctPending}
                    onClick={handleCorrect}
                  >
                    {correctPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    Guardar corrección
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}
