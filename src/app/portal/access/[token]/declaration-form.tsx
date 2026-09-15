'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import {
  type RequirementDetail,
  isRequirementCurrentlyRequired,
  validateFieldValue,
} from '@/lib/requirement-evaluation';
import {
  saveDeclaredFieldsAction,
  completeDeclarationAction,
} from './declaration-actions';
import {
  FileText,
  Save,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';

interface FieldSuggestion {
  value: unknown;
  assertionId: string;
  evidenceId: string | null;
  confidence: string | null;
}

interface DeclarationFormProps {
  token: string;
  dossierId: string;
  organizationId: string;
  fieldRequirements: RequirementDetail[];
  documentRequirements?: RequirementDetail[];
  values: Record<string, unknown>;
  suggestions?: Record<string, FieldSuggestion>;
  correctionsReason?: string | null;
}

export function DeclarationForm({
  token,
  dossierId,
  organizationId,
  fieldRequirements,
  values: initialValues,
  suggestions: initialSuggestions = {},
  correctionsReason,
}: DeclarationFormProps) {
  const [formValues, setFormValues] = React.useState<Record<string, unknown>>(() => {
    const initial = { ...initialValues };
    // Seed formValues with suggestions for fields without declared values
    for (const [field, suggestion] of Object.entries(initialSuggestions)) {
      if (!(field in initial)) {
        initial[field] = suggestion.value;
      }
    }
    return initial;
  });
  const [dirtyKeys, setDirtyKeys] = React.useState<Set<string>>(() => {
    // Fields with suggestions but no declared values should be marked dirty from the start
    // so they get saved when the user saves progress
    const initial = new Set<string>();
    for (const field of Object.keys(initialSuggestions)) {
      if (!(field in initialValues)) {
        initial.add(field);
      }
    }
    return initial;
  });
  const [suggestedKeys, setSuggestedKeys] = React.useState<Set<string>>(
    new Set(Object.keys(initialSuggestions)),
  );
  const [hiddenConflicts, setHiddenConflicts] = React.useState<Set<string>>(new Set());
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [missingFieldKeys, setMissingFieldKeys] = React.useState<Set<string>>(new Set());

  const [isSaving, setIsSaving] = React.useState(false);
  const [isCompleting, setIsCompleting] = React.useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = React.useState<string | null>(null);
  const [generalError, setGeneralError] = React.useState<string | null>(null);

  const fieldRefs = React.useRef<Record<string, HTMLElement | null>>({});

  const handleValueChange = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    setDirtyKeys((prev) => new Set(prev).add(key));

    // Remove from suggestedKeys when user edits (it's no longer an unreviewed suggestion)
    if (suggestedKeys.has(key)) {
      setSuggestedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }

    // Clear error on change if present
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    if (missingFieldKeys.has(key)) {
      setMissingFieldKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    setSaveSuccessMsg(null);
    setGeneralError(null);
  };

  // 1. Guardar avance
  const handleSaveProgress = async () => {
    // Validate dirty fields against their validation schema
    const errors: Record<string, string> = {};
    for (const req of fieldRequirements) {
      if (dirtyKeys.has(req.key)) {
        const val = formValues[req.key];
        const err = validateFieldValue(val, req.validation);
        if (err) {
          errors[req.key] = err;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setGeneralError('Hay errores de validación en los campos modificados.');
      return;
    }

    setIsSaving(true);
    setGeneralError(null);
    setSaveSuccessMsg(null);

    // Only send dirty fields
    const payload: Record<string, unknown> = {};
    for (const k of dirtyKeys) {
      payload[k] = formValues[k] ?? null;
    }

    try {
      const res = await saveDeclaredFieldsAction(token, dossierId, organizationId, payload);
      if (!res.success) {
        setGeneralError(res.error || 'Error al guardar el avance');
      } else {
        setDirtyKeys(new Set());
        setFieldErrors({});
        setSaveSuccessMsg('Avance guardado correctamente en el sistema.');
      }
    } catch (err: unknown) {
      setGeneralError(err instanceof Error ? err.message : 'Error inesperado de conexión');
    } finally {
      setIsSaving(false);
    }
  };

  // 2. Finalizar diligenciamiento
  const handleComplete = async () => {
    setIsCompleting(true);
    setGeneralError(null);
    setSaveSuccessMsg(null);

    try {
      // First save dirty keys if any
      if (dirtyKeys.size > 0) {
        const payload: Record<string, unknown> = {};
        for (const k of dirtyKeys) {
          payload[k] = formValues[k] ?? null;
        }
        const saveRes = await saveDeclaredFieldsAction(token, dossierId, organizationId, payload);
        if (!saveRes.success) {
          setGeneralError(saveRes.error || 'Error al guardar cambios previos a la finalización');
          setIsCompleting(false);
          return;
        }
        setDirtyKeys(new Set());
      }

      // Now complete
      const res = await completeDeclarationAction(token, dossierId, organizationId);
      if (!res.success) {
        if (res.missingFields && res.missingFields.length > 0) {
          setMissingFieldKeys(new Set(res.missingFields));
          setGeneralError('Por favor complete todos los campos obligatorios antes de finalizar.');
          // Scroll to first missing field
          const firstMissing = res.missingFields[0];
          if (firstMissing && fieldRefs.current[firstMissing]) {
            fieldRefs.current[firstMissing]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          setGeneralError(res.error || 'Error al finalizar el diligenciamiento');
        }
      }
    } catch (err: unknown) {
      setGeneralError(err instanceof Error ? err.message : 'Error inesperado al finalizar');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <Card className="w-full shadow-sm border-zinc-200 dark:border-zinc-800">
      <CardHeader className="border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-lg">Formulario de debida diligencia</CardTitle>
            <CardDescription className="text-xs">
              Complete la información solicitada. Los campos con asterisco (*) son obligatorios.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {correctionsReason && (
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="space-y-1">
              <span className="font-semibold text-xs block">Se han solicitado correcciones para este expediente:</span>
              <AlertDescription className="text-xs text-amber-800 dark:text-amber-300">
                {correctionsReason}
              </AlertDescription>
            </div>
          </Alert>
        )}

        {generalError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{generalError}</AlertDescription>
          </Alert>
        )}

        {saveSuccessMsg && (
          <Alert className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <AlertDescription className="text-xs">{saveSuccessMsg}</AlertDescription>
          </Alert>
        )}

        {/* Dynamic Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fieldRequirements.map((req) => {
            const isRequired = isRequirementCurrentlyRequired(req, formValues);
            if (!isRequired && req.mandatory === 'conditional') {
              // Conditional field not required -> hide reactively
              return null;
            }

            const currentVal = formValues[req.key];
            const isMissing = missingFieldKeys.has(req.key);
            const err = fieldErrors[req.key];
            const labelText = req.key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

            const isFullWidth = req.validation?.dataType === 'string' && (req.key.includes('address') || req.key.includes('direccion') || req.key.includes('observacion') || req.key.includes('description'));
            return (
              <div
                key={req.key}
                ref={(el) => {
                  fieldRefs.current[req.key] = el;
                }}
                className={`space-y-1.5 p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-100 dark:border-zinc-800/80 transition-colors ${
                  isFullWidth ? 'md:col-span-2' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <Label htmlFor={req.key} className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {labelText} {isRequired && <span className="text-red-500">*</span>}
                  </Label>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider">
                    {req.mandatory === 'always'
                      ? 'Obligatorio'
                      : req.mandatory === 'conditional'
                        ? 'Condicional'
                        : 'Opcional'}
                  </span>
                </div>

                {/* Input according to dataType */}
                {req.validation?.dataType === 'boolean' ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={currentVal === true ? 'default' : 'outline'}
                      className={`h-8 px-4 text-xs font-medium ${
                        currentVal === true ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''
                      }`}
                      onClick={() => handleValueChange(req.key, true)}
                    >
                      Sí
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={currentVal === false ? 'default' : 'outline'}
                      className={`h-8 px-4 text-xs font-medium ${
                        currentVal === false ? 'bg-zinc-700 hover:bg-zinc-800 text-white' : ''
                      }`}
                      onClick={() => handleValueChange(req.key, false)}
                    >
                      No
                    </Button>
                  </div>
                ) : req.validation?.dataType === 'enum' && req.validation.enumValues ? (
                  <Combobox
                    items={req.validation.enumValues.map((v) => ({ value: v, label: v }))}
                    value={
                      currentVal ? { value: String(currentVal), label: String(currentVal) } : null
                    }
                    onValueChange={(val) => {
                      handleValueChange(req.key, val ? val.value : null);
                    }}
                    itemToStringLabel={(i) => i?.label ?? ''}
                    isItemEqualToValue={(a, b) => a?.value === b?.value}
                  >
                    <ComboboxInput
                      placeholder="Seleccionar una opción..."
                      className="h-9 text-xs bg-white dark:bg-zinc-950"
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No hay opciones disponibles.</ComboboxEmpty>
                      <ComboboxList>
                        {(item: { value: string; label: string }) => (
                          <ComboboxItem key={item.value} value={item}>
                            {item.label}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                ) : (
                  <Input
                    id={req.key}
                    type={
                      req.validation?.dataType === 'number'
                        ? 'number'
                        : req.validation?.dataType === 'date'
                          ? 'date'
                          : 'text'
                    }
                    value={
                      currentVal !== undefined && currentVal !== null
                        ? String(currentVal)
                        : ''
                    }
                    onChange={(e) => {
                      const v =
                        req.validation?.dataType === 'number'
                          ? e.target.value === ''
                            ? ''
                            : Number(e.target.value)
                          : e.target.value;
                      handleValueChange(req.key, v);
                    }}
                    className={`h-9 text-xs bg-white dark:bg-zinc-950 ${
                      isMissing || err ? 'border-red-500 focus-visible:ring-red-500' : ''
                    }`}
                    placeholder={`Ingrese ${labelText.toLowerCase()}`}
                  />
                )}

                {/* Suggestion badge for fields pre-filled from AI extraction */}
                {suggestedKeys.has(req.key) && !(req.key in initialValues) && (
                  <div className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 mt-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Sugerido por tu documento — verifica</span>
                  </div>
                )}

                {/* Conflict warning for fields with both declared and extracted values */}
                {initialSuggestions[req.key] &&
                  req.key in initialValues &&
                  !hiddenConflicts.has(req.key) && (
                    <div className="p-2.5 mt-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">
                            Tu documento dice: &quot;{String(initialSuggestions[req.key].value)}&quot; — tú
                            declaraste &quot;{String(currentVal)}&quot;.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setHiddenConflicts((prev) => new Set(prev).add(req.key));
                          }}
                        >
                          Mantener lo que declaré
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={() => {
                            handleValueChange(req.key, initialSuggestions[req.key].value);
                            setHiddenConflicts((prev) => new Set(prev).add(req.key));
                          }}
                        >
                          Usar el valor del documento
                        </Button>
                      </div>
                    </div>
                  )}

                {/* Validation or missing field alert */}
                {isMissing && (
                  <p className="text-[11px] text-red-500 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    Este campo es obligatorio para continuar.
                  </p>
                )}
                {err && (
                  <p className="text-[11px] text-red-500 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {err}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-800 pt-4 bg-zinc-50/50 dark:bg-zinc-900/20">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Clock className="w-3.5 h-3.5" />
          <span>Su avance puede ser guardado en cualquier momento y continuado después.</span>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSaveProgress}
            disabled={isSaving || isCompleting}
            className="flex-1 sm:flex-none text-xs gap-1.5"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar avance
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleComplete}
            disabled={isSaving || isCompleting}
            className="flex-1 sm:flex-none text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isCompleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            Finalizar diligenciamiento
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
