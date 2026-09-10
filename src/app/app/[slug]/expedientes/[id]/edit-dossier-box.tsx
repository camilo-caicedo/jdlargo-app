'use client';

import * as React from 'react';
import { useActionState, useState } from 'react';
import { updateDossierAction, type UpdateDossierFormState } from '../actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  internalOwnerName: string | null;
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
  internalOwnerName,
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

  const handleCancel = () => {
    setSelectedOwnerId(currentInternalOwnerId || members[0]?.id || '');
    setDeadlineStr(initialDateStr);
    setIsOpen(false);
  };

  // If user cannot edit or if dossier is closed, show read-only details
  if (!canEdit || isClosed) {
    return (
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center text-xs text-zinc-500 border-t sm:border-t-0 sm:border-l border-zinc-100 dark:border-zinc-800 pt-3 sm:pt-0 sm:pl-6">
        <div>
          <div className="text-[11px] text-zinc-400">Responsable interno:</div>
          <div className="font-medium text-zinc-800 dark:text-zinc-200">
            {internalOwnerName || 'Sin asignar'}
          </div>
        </div>
        <div className="sm:ml-4">
          <div className="text-[11px] text-zinc-400">Fecha límite:</div>
          <div className="font-medium text-zinc-800 dark:text-zinc-200">
            {currentDeadline ? new Date(currentDeadline).toLocaleDateString() : 'Sin fecha límite'}
          </div>
        </div>
        {isClosed && (
          <div className="sm:ml-3 flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
            <Lock className="w-3 h-3 text-zinc-400" />
            <span>Cerrado</span>
          </div>
        )}
      </div>
    );
  }

  // Edit mode: inline form replacing the read-only divs
  if (isOpen) {
    return (
      <div className="border-t sm:border-t-0 sm:border-l border-zinc-100 dark:border-zinc-800 pt-3 sm:pt-0 sm:pl-6">
        <form action={formAction} className="space-y-3">
          {formState?.error && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              {formState.error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="space-y-1">
              <label htmlFor="internalOwnerId" className="text-[11px] font-medium text-zinc-500">
                Responsable interno *
              </label>
              <input type="hidden" name="internalOwnerId" value={selectedOwnerId} />
              <div className="w-[200px] sm:w-[240px]">
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
                  <ComboboxInput placeholder="Buscar miembro..." className="h-8 text-xs" />
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
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <label htmlFor="deadline" className="text-[11px] font-medium text-zinc-500">
                  Fecha límite
                </label>
                {deadlineStr && (
                  <button
                    type="button"
                    onClick={() => setDeadlineStr('')}
                    className="text-[10px] text-zinc-400 hover:text-red-500 underline cursor-pointer"
                  >
                    Quitar
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
                className="h-8 text-xs w-[140px]"
              />
            </div>

            <div className="flex items-center gap-1.5 pb-0.5">
              <Button
                type="submit"
                size="sm"
                disabled={isPending}
                className="h-8 px-2.5 text-xs gap-1 shadow-xs"
              >
                {isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Guardar</span>
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={isPending}
                className="h-8 px-2 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
                <span className="sr-only sm:not-sr-only sm:ml-1">Cancelar</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  // Read mode: exact view with small inline edit pencil button
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center text-xs text-zinc-500 border-t sm:border-t-0 sm:border-l border-zinc-100 dark:border-zinc-800 pt-3 sm:pt-0 sm:pl-6">
      <div>
        <div className="text-[11px] text-zinc-400">Responsable interno:</div>
        <div className="font-medium text-zinc-800 dark:text-zinc-200">
          {internalOwnerName || 'Sin asignar'}
        </div>
      </div>
      <div className="sm:ml-4">
        <div className="text-[11px] text-zinc-400">Fecha límite:</div>
        <div className="font-medium text-zinc-800 dark:text-zinc-200">
          {currentDeadline ? new Date(currentDeadline).toLocaleDateString() : 'Sin fecha límite'}
        </div>
      </div>
      <div className="sm:ml-3 pt-1 sm:pt-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="h-7 px-2 text-xs gap-1 font-medium border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100"
          title="Editar responsable interno y fecha límite"
        >
          <Pencil className="w-3 h-3" />
          <span>Editar</span>
        </Button>
      </div>
    </div>
  );
}

