'use client';

import * as React from 'react';
import { useActionState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { createDossierAction, type CreateDossierFormState } from '../actions';
import { FolderPlus, ArrowLeft, Loader2 } from 'lucide-react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';

const DOC_TYPES = [
  { value: 'NIT', label: 'NIT - Número de Identificación Tributaria' },
  { value: 'CC', label: 'CC - Cédula de Ciudadanía' },
  { value: 'CE', label: 'CE - Cédula de Extranjería' },
  { value: 'PP', label: 'Pasaporte' },
];

interface NewDossierFormProps {
  organizationId: string;
  slug: string;
  counterpartyTypes: { id: string; name: string; nature: string }[];
  members: { id: string; name: string; email: string }[];
  activeUserId: string;
  standard: string;
}

export function NewDossierForm({
  organizationId,
  slug,
  counterpartyTypes,
  members,
  activeUserId,
  standard,
}: NewDossierFormProps) {
  const actionWithOrg = createDossierAction.bind(null, organizationId, slug);
  const [state, formAction, isPending] = useActionState<CreateDossierFormState | null, FormData>(
    actionWithOrg,
    null,
  );

  const [sendInviteNow, setSendInviteNow] = React.useState(true);

  // Combobox states
  const [docType, setDocType] = React.useState('NIT');
  const selectedDocType = React.useMemo(
    () => DOC_TYPES.find((d) => d.value === docType) || DOC_TYPES[0],
    [docType]
  );

  const cpItems = React.useMemo(
    () =>
      counterpartyTypes.map((t) => ({
        value: t.name,
        label: `${t.name.toUpperCase()} (${t.nature === 'legal_entity' ? 'Persona Jurídica' : 'Persona Natural'})`,
      })),
    [counterpartyTypes]
  );
  const [cpType, setCpType] = React.useState(counterpartyTypes[0]?.name || '');
  const selectedCpItem = React.useMemo(
    () => cpItems.find((c) => c.value === cpType) || cpItems[0] || null,
    [cpItems, cpType]
  );

  const memberItems = React.useMemo(
    () =>
      members.map((m) => ({
        value: m.id,
        label: `${m.name} (${m.email})`,
      })),
    [members]
  );
  const [ownerId, setOwnerId] = React.useState(activeUserId);
  const selectedMemberItem = React.useMemo(
    () => memberItems.find((m) => m.value === ownerId) || memberItems[0] || null,
    [memberItems, ownerId]
  );

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Standard indicator */}
      <div className="rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
        <span>
          Estándar regulatorio aplicado a esta versión: <strong>{standard}</strong>
        </span>
        <span className="text-[11px] bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded font-medium">
          Congelado al abrir
        </span>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 border-b border-zinc-100 dark:border-zinc-800 pb-2">
          1. Datos de la contraparte
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="identificationType">Tipo de documento *</Label>
            <input type="hidden" name="identificationType" value={docType} />
            <Combobox
              items={DOC_TYPES}
              value={selectedDocType}
              onValueChange={(val) => {
                if (val) setDocType(val.value);
              }}
              itemToStringLabel={(item) => item?.label ?? ''}
              isItemEqualToValue={(a, b) => a?.value === b?.value}
              disabled={isPending}
            >
              <ComboboxInput placeholder="Seleccionar tipo..." />
              <ComboboxContent>
                <ComboboxEmpty>No se encontraron tipos.</ComboboxEmpty>
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

          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="identificationNumber">Número de identificación *</Label>
            <Input
              id="identificationNumber"
              name="identificationNumber"
              type="text"
              required
              disabled={isPending}
              placeholder="Ej. 900123456-1 o 1020304050"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="declaredName">Razón social o nombre completo declarado *</Label>
          <Input
            id="declaredName"
            name="declaredName"
            type="text"
            required
            disabled={isPending}
            placeholder="Ej. Inversiones y Logística S.A.S."
          />
          <p className="text-[11px] text-zinc-500">
            Se registrará como afirmación declarada inicial con procedencia operativa.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="counterpartyTypeName">Tipo de contraparte en el sistema *</Label>
          <input type="hidden" name="counterpartyTypeName" value={cpType} />
          <Combobox
            items={cpItems}
            value={selectedCpItem}
            onValueChange={(val) => {
              if (val) setCpType(val.value);
            }}
            itemToStringLabel={(item) => item?.label ?? ''}
            isItemEqualToValue={(a, b) => a?.value === b?.value}
            disabled={isPending}
          >
            <ComboboxInput placeholder="Seleccionar o buscar tipo..." />
            <ComboboxContent>
              <ComboboxEmpty>No se encontraron tipos de contraparte.</ComboboxEmpty>
              <ComboboxList>
                {(item: { value: string; label: string }) => (
                  <ComboboxItem key={item.value} value={item}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <p className="text-[11px] text-zinc-500">
            Determina la matriz de requisitos documentales y de formulario que se le exigirán.
          </p>
        </div>
      </div>

      <div className="space-y-4 pt-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 border-b border-zinc-100 dark:border-zinc-800 pb-2">
          2. Asignación y control interno
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="internalOwnerId">Responsable interno *</Label>
            <input type="hidden" name="internalOwnerId" value={ownerId} />
            <Combobox
              items={memberItems}
              value={selectedMemberItem}
              onValueChange={(val) => {
                if (val) setOwnerId(val.value);
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
            <Label htmlFor="deadline">Fecha límite para completar (opcional)</Label>
            <Input
              id="deadline"
              name="deadline"
              type="date"
              disabled={isPending}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            3. Enlace de acceso a la contraparte
          </h3>
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={sendInviteNow}
              onChange={(e) => setSendInviteNow(e.target.checked)}
              className="rounded border-zinc-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
            />
            Generar enlace de acceso ahora
          </label>
        </div>

        {sendInviteNow ? (
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="recipientEmail">Correo electrónico de la contraparte *</Label>
              <Input
                id="recipientEmail"
                name="recipientEmail"
                type="email"
                required={sendInviteNow}
                disabled={isPending}
                placeholder="contacto@contraparte.com"
              />
              <p className="text-[11px] text-zinc-500">
                Se enviará el enlace de acceso por correo y además podrás copiarlo manualmente en pantalla.
              </p>
            </div>

            <div className="flex items-start gap-2 pt-1">
              <input
                id="requiresSecondFactor"
                name="requiresSecondFactor"
                type="checkbox"
                disabled={isPending}
                className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
              />
              <Label htmlFor="requiresSecondFactor" className="text-xs font-normal text-zinc-600 dark:text-zinc-400 cursor-pointer">
                Exigir segundo factor de autenticación (OTP de 6 dígitos enviado al correo para ingresar).
              </Label>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 italic">
            Podrás emitir y compartir el enlace de acceso más adelante desde la ficha del expediente.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <Link
          href={`/app/${slug}/expedientes`}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Cancelar
        </Link>

        <Button type="submit" disabled={isPending} className="font-medium inline-flex items-center gap-2">
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Abriendo expediente...
            </>
          ) : (
            <>
              <FolderPlus className="w-4 h-4" />
              Crear solicitud y abrir expediente
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
