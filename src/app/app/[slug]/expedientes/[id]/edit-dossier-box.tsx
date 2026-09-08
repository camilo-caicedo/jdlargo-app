'use client';

import * as React from 'react';
import { useActionState, useState } from 'react';
import { updateDossierAction, type UpdateDossierFormState } from '../actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Pencil, Check, X, Loader2, Lock } from 'lucide-react';

interface MemberOption {
  id: string;
  name: string;
  email: string;
}

interface EditDossierBoxProps {
  organizationId: string;
  dossierId: string;
  slug: string;
  state: string;
  currentInternalOwnerId: string | null;
  currentDeadline: Date | null;
  members: MemberOption[];
  canEdit: boolean;
}

export function EditDossierBox({
  organizationId,
  dossierId,
  slug,
  state,
  currentInternalOwnerId,
  currentDeadline,
  members,
  canEdit,
}: EditDossierBoxProps) {
  const isClosed = state === 'cerrada';
  const [isOpen, setIsOpen] = useState(false);

  // Form action
  const actionWithParams = updateDossierAction.bind(null, organizationId, dossierId, slug);
  const [formState, formAction, isPending] = useActionState<UpdateDossierFormState | null, FormData>(
    async (prevState, formData) => {
      const result = await actionWithParams(prevState, formData);
      if (result.success) {
        setIsOpen(false);
      }
      return result;
    },
    null,
  );

  // Member combobox state
  const memberItems = React.useMemo(
    () =>
      members.map((m) => ({
        value: m.id,
        label: `${m.name} (${m.email})`,
      })),
    [members],
  );

  const [selectedOwnerId, setSelectedOwnerId] = useState<string>(
    currentInternalOwnerId || members[0]?.id || '',
  );

  const selectedMemberItem = React.useMemo(
    () => memberItems.find((m) => m.value === selectedOwnerId) || memberItems[0] || null,
    [memberItems, selectedOwnerId],
  );

  // Formatted deadline for HTML date input (YYYY-MM-DD)
  const initialDateStr = currentDeadline
    ? new Date(currentDeadline).toISOString().split('T')[0]
    : '';
  const [deadlineStr, setDeadlineStr] = useState<string>(initialDateStr);

  if (!canEdit) {
    return null;
  }

  if (isClosed) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700">
        <Lock className="w-3.5 h-3.5 text-zinc-400" />
        <span>Expediente cerrado (edición deshabilitada)</span>
      </div>
    );
  }

  return (
    <div className="relative">
      {!isOpen ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="h-8 gap-1.5 text-xs font-medium border-zinc-200 dark:border-zinc-700"
        >
          <Pencil className="w-3.5 h-3.5" />
          Editar datos
        </Button>
      ) : (
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-md space-y-4 max-w-md w-full">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Editar datos administrativos
            </h4>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1"
              disabled={isPending}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {formState?.error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertDescription>{formState.error}</AlertDescription>
            </Alert>
          )}

          <form action={formAction} className="space-y-3.5 text-xs">
            <div className="space-y-1.5">
              <Label htmlFor="internalOwnerId" className="text-xs">
                Responsable interno *
              </Label>
              <input type="hidden" name="internalOwnerId" value={selectedOwnerId} />
              <Combobox
                items={memberItems}
                value={selectedMemberItem}
                onValueChange={(val) => {
                  if (val) setSelectedOwnerId(val.value);
                }}
                itemToStringLabel={(item) => item?.label ?? ''}
                isItemEqualToValue={(a, b) => a?.value === b?.value}
                disabled={isPending}
              >
                <ComboboxInput placeholder="Buscar por nombre o correo..." />
                <ComboboxContent>
                  <ComboboxEmpty>No se encontraron miembros.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: { value: string; label: string }) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="deadline" className="text-xs">
                  Fecha límite para completar
                </Label>
                {deadlineStr && (
                  <button
                    type="button"
                    onClick={() => setDeadlineStr('')}
                    className="text-[10px] text-zinc-400 hover:text-red-500 underline cursor-pointer"
                  >
                    Quitar fecha límite
                  </button>
                )}
              </div>
              <Input
                id="deadline"
                name="deadline"
                type="date"
                value={deadlineStr}
                onChange={(e) => setDeadlineStr(e.target.value)}
                disabled={isPending}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-zinc-400">
                Deje en blanco o use &quot;Quitar fecha límite&quot; para limpiar la fecha.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
                className="h-7 text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isPending}
                className="h-7 text-xs gap-1.5 shadow-xs"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Guardar cambios
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
