'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Loader2,
  AlertCircle,
  X,
  ShieldCheck,
  Plus,
  Trash2,
} from 'lucide-react';
import { recordDecisionAction, closeDossierAction } from '../actions';
import type { EvidenceRef } from '@/server/dossiers/decision';

interface EvidenceItemOption {
  kind: 'assertion' | 'document';
  id: string;
  label: string;
  sublabel?: string;
}

interface ExceptionWarning {
  reason: string;
  skippedRequirementKeys: string[];
}

interface DecisionBoxProps {
  organizationId: string;
  dossierId: string;
  dossierState: string;
  canDecide: boolean;
  canClose: boolean;
  availableEvidence: EvidenceItemOption[];
  exceptionWarning?: ExceptionWarning | null;
}

function getDefaultValidUntil(): string {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  return nextYear.toISOString().split('T')[0];
}

export function DecisionBox({
  organizationId,
  dossierId,
  dossierState,
  canDecide,
  canClose,
  availableEvidence,
  exceptionWarning,
}: DecisionBoxProps) {
  // Decision Form State
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [decisionType, setDecisionType] = React.useState<'approve' | 'approve_with_conditions' | 'reject'>('approve');
  const [title, setTitle] = React.useState('');
  const [rationale, setRationale] = React.useState('');
  const [validUntil, setValidUntil] = React.useState(getDefaultValidUntil);
  const [selectedEvidence, setSelectedEvidence] = React.useState<EvidenceRef[]>([]);
  const [conditions, setConditions] = React.useState<string[]>(['']);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Close dossier state
  const [isClosing, setIsClosing] = React.useState(false);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = React.useState(false);

  const isPendingDecision = dossierState === 'pendiente_de_decision';
  const isDecided = ['aprobada', 'aprobada_con_condiciones', 'rechazada'].includes(dossierState);

  const toggleEvidence = (item: EvidenceRef) => {
    const exists = selectedEvidence.some((e) => e.kind === item.kind && e.id === item.id);
    if (exists) {
      setSelectedEvidence(selectedEvidence.filter((e) => !(e.kind === item.kind && e.id === item.id)));
    } else {
      setSelectedEvidence([...selectedEvidence, item]);
    }
  };

  const handleAddCondition = () => {
    setConditions([...conditions, '']);
  };

  const handleRemoveCondition = (index: number) => {
    setConditions(conditions.filter((_, idx) => idx !== index));
  };

  const handleConditionChange = (index: number, val: string) => {
    const next = [...conditions];
    next[index] = val;
    setConditions(next);
  };

  const handleSubmitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage('El cargo del responsable es obligatorio');
      return;
    }
    if (!rationale.trim()) {
      setErrorMessage('El fundamento de la decisión es obligatorio');
      return;
    }
    if (selectedEvidence.length === 0) {
      setErrorMessage('Debe seleccionar al menos una evidencia del checklist');
      return;
    }
    if (!validUntil) {
      setErrorMessage('Debe especificar una fecha de vigencia válida');
      return;
    }

    if (decisionType === 'approve_with_conditions') {
      const clean = conditions.filter((c) => c && c.trim() !== '');
      if (clean.length === 0) {
        setErrorMessage('Debe especificar al menos una condición estructurada');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await recordDecisionAction({
        organizationId,
        dossierId,
        type: decisionType,
        title: title.trim(),
        rationale: rationale.trim(),
        evidence: selectedEvidence,
        validUntil: new Date(validUntil).toISOString(),
        conditions: decisionType === 'approve_with_conditions'
          ? conditions.filter((c) => c && c.trim() !== '')
          : undefined,
      });

      if (res.success) {
        setIsFormOpen(false);
      } else {
        setErrorMessage(res.error || 'Error al registrar la decisión');
      }
    } catch {
      setErrorMessage('Error de conexión al registrar la decisión');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseDossier = async () => {
    setIsClosing(true);
    setErrorMessage(null);
    try {
      const res = await closeDossierAction(organizationId, dossierId);
      if (!res.success) {
        setErrorMessage(res.error || 'Error al cerrar el expediente');
      }
    } catch {
      setErrorMessage('Error de conexión al cerrar el expediente');
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Buttons row (next to status badge) */}
      <div className="flex items-center gap-2">
        {canDecide && isPendingDecision && !isFormOpen && (
          <Button
            size="sm"
            onClick={() => setIsFormOpen(true)}
            className="text-xs gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white shadow-xs font-medium"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            Tomar decisión
          </Button>
        )}

        {canClose && isDecided && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCloseConfirmOpen(true)}
            disabled={isClosing}
            className="text-xs gap-1.5 text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {isClosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            Cerrar expediente
          </Button>
        )}
      </div>

      {errorMessage && !isFormOpen && (
        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {errorMessage}
        </p>
      )}

      {/* Decision Modal Form */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div
            className="relative w-full max-w-2xl my-8 rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-5 animate-in fade-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  Decisión del Oficial de Cumplimiento
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Registro formal, inmutable y auditable de la vinculación de la contraparte.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !isSubmitting && setIsFormOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                disabled={isSubmitting}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Warning banner if entered through exception */}
            {exceptionWarning && (
              <div className="p-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-purple-900 dark:text-purple-200">
                  <AlertTriangle className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                  Expediente revisado con excepción
                </div>
                <p className="text-purple-800 dark:text-purple-300">
                  <span className="font-medium">Motivo de excepción:</span> {exceptionWarning.reason}
                </p>
                {exceptionWarning.skippedRequirementKeys.length > 0 && (
                  <p className="text-purple-700 dark:text-purple-400">
                    <span className="font-medium">Requisitos pendientes:</span> {exceptionWarning.skippedRequirementKeys.join(', ')}
                  </p>
                )}
              </div>
            )}

            <form onSubmit={handleSubmitDecision} className="space-y-4 text-xs">
              {/* Decision Type Selector */}
              <div className="space-y-1.5">
                <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Sentido de la decisión *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDecisionType('approve')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1 text-center transition-all ${
                      decisionType === 'approve'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>Aprobar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecisionType('approve_with_conditions')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1 text-center transition-all ${
                      decisionType === 'approve_with_conditions'
                        ? 'border-amber-600 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 font-semibold'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <span>Aprobar con condiciones</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecisionType('reject')}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1 text-center transition-all ${
                      decisionType === 'reject'
                        ? 'border-rose-600 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-300 font-semibold'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <XCircle className="w-5 h-5 text-rose-600" />
                    <span>Rechazar</span>
                  </button>
                </div>
              </div>

              {/* Title & Validity row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Cargo o título del decisor *
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej: Oficial de Cumplimiento Titular"
                    className="text-xs"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Vigencia de la decisión *
                  </label>
                  <Input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="text-xs"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Rationale */}
              <div className="space-y-1">
                <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Fundamento y justificación de la decisión *
                </label>
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Detalle el análisis de riesgo, listas restrictivas consultadas, fuentes verificadas y razonamiento jurídico o de cumplimiento..."
                  rows={3}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-600"
                  disabled={isSubmitting}
                />
              </div>

              {/* Structured conditions if approve_with_conditions */}
              {decisionType === 'approve_with_conditions' && (
                <div className="space-y-2 p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-amber-900 dark:text-amber-200">
                      Condiciones estructuradas *
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddCondition}
                      className="text-[11px] h-7 gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Agregar condición
                    </Button>
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Cada condición debe quedar registrada de forma independiente para su posterior seguimiento.
                  </p>
                  <div className="space-y-2">
                    {conditions.map((cond, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <Input
                          value={cond}
                          onChange={(e) => handleConditionChange(idx, e.target.value)}
                          placeholder={`Condición ${idx + 1}: Ej: Actualizar composición accionaria antes de 6 meses`}
                          className="text-xs bg-white dark:bg-zinc-900"
                          disabled={isSubmitting}
                        />
                        {conditions.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveCondition(idx)}
                            className="h-8 w-8 p-0 text-zinc-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence checklist */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Checklist de evidencia citada * ({selectedEvidence.length} seleccionadas)
                  </label>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Seleccione las afirmaciones y documentos específicos del expediente que sustentan su decisión:
                </p>
                <div className="max-h-48 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded-xl divide-y divide-zinc-100 dark:divide-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                  {availableEvidence.length === 0 ? (
                    <div className="p-3 text-center text-zinc-400 italic">
                      No hay datos ni documentos registrados en este expediente.
                    </div>
                  ) : (
                    availableEvidence.map((item) => {
                      const checked = selectedEvidence.some((e) => e.kind === item.kind && e.id === item.id);
                      return (
                        <label
                          key={`${item.kind}-${item.id}`}
                          className="flex items-center gap-2.5 p-2.5 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEvidence({ kind: item.kind, id: item.id })}
                            className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-zinc-800 dark:text-zinc-200">
                              {item.label}
                            </span>
                            {item.sublabel && (
                              <span className="text-zinc-400 ml-1.5 text-[11px]">
                                ({item.sublabel})
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-mono bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            {item.kind}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {errorMessage && (
                <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 pt-1">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {errorMessage}
                </p>
              )}

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFormOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirmar y registrar decisión
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <AlertDialog open={isCloseConfirmOpen} onOpenChange={setIsCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar expediente</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Confirma que desea cerrar formalmente el expediente? Una vez cerrado, no admitirá más transiciones de estado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsCloseConfirmOpen(false);
                handleCloseDossier();
              }}
            >
              Cerrar expediente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
