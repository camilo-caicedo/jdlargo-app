"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  Check,
  Lock,
  Unlock,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { createDraftFromRolesAction, updateDraftRolesAction } from "./actions";
import type { PermissionKey } from "@/server/auth/permissions";

export interface RoleConfigItem {
  code: string;
  name: string;
  description?: string | null;
  permissions: PermissionKey[];
}

interface RolesClientProps {
  organizationId: string;
  slug: string;
  isDraft: boolean;
  versionNumber: string;
  roles: RoleConfigItem[];
  allPermissions: string[];
  canAdminister: boolean;
  readOnly?: boolean;
}

export function RolesClient({
  organizationId,
  slug,
  isDraft,
  versionNumber,
  roles: initialRoles,
  allPermissions,
  canAdminister,
  readOnly = false,
}: RolesClientProps) {
  const [roles, setRoles] = useState<RoleConfigItem[]>(initialRoles);
  const [selectedRoleCode, setSelectedRoleCode] = useState<string>(
    initialRoles[0]?.code || "admin"
  );
  const [isPending, startTransition] = useTransition();

  const selectedRole = roles.find((r) => r.code === selectedRoleCode);

  const handleTogglePermission = (permission: string) => {
    if (!isDraft || !canAdminister || readOnly) return;

    setRoles((prevRoles) =>
      prevRoles.map((r) => {
        if (r.code !== selectedRoleCode) return r;

        const hasPerm = r.permissions.includes(permission as PermissionKey);
        const newPerms = hasPerm
          ? r.permissions.filter((p) => p !== permission)
          : [...r.permissions, permission as PermissionKey];

        return {
          ...r,
          permissions: newPerms,
        };
      })
    );
  };

  const handleCreateDraft = () => {
    startTransition(async () => {
      const res = await createDraftFromRolesAction(organizationId, slug);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Borrador creado exitosamente. Ahora puede modificar los roles.");
      }
    });
  };

  const handleSaveRoles = () => {
    startTransition(async () => {
      const sanitized = roles.map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description || undefined,
        permissions: r.permissions,
      }));
      const res = await updateDraftRolesAction(organizationId, slug, sanitized);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Roles actualizados exitosamente en el borrador.");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Draft banner or Create Draft button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          {isDraft ? (
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 border border-amber-200 dark:border-amber-800">
              <Unlock className="w-5 h-5" />
            </div>
          ) : (
            <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              <Lock className="w-5 h-5" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {isDraft
                ? `Editando borrador de configuración (v${versionNumber})`
                : `Versión publicada v${versionNumber} (Solo lectura)`}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {isDraft
                ? "Los cambios a los permisos se guardan directamente en el borrador vigente."
                : "Las versiones publicadas son inmutables. Cree un borrador para modificar los permisos."}
            </p>
          </div>
        </div>

        {!isDraft && canAdminister && !readOnly && (
          <Button onClick={handleCreateDraft} disabled={isPending} size="sm" className="gap-1.5 shrink-0">
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Crear borrador para editar
          </Button>
        )}

        {isDraft && canAdminister && !readOnly && (
          <Button onClick={handleSaveRoles} disabled={isPending} size="sm" className="gap-1.5 shrink-0">
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Guardar cambios de roles
          </Button>
        )}
      </div>

      {/* Role Selection & Permissions Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Role list sidebar */}
        <div className="md:col-span-1 space-y-2">
          <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-1">Roles configurados</h4>
          <div className="space-y-1">
            {roles.map((role) => (
              <button
                key={role.code}
                onClick={() => setSelectedRoleCode(role.code)}
                className={`w-full text-left p-2.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedRoleCode === role.code
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-850"
                }`}
              >
                <div className="font-semibold">{role.name}</div>
                <div className="text-[10px] opacity-75 mt-0.5">{role.permissions.length} permisos</div>
              </button>
            ))}
          </div>
        </div>

        {/* Permissions list for selected role */}
        <div className="md:col-span-3">
          <Card>
            <CardHeader className="border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">{selectedRole?.name}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {selectedRole?.description || `Permisos asignados al rol ${selectedRole?.name}`}
                  </CardDescription>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  {selectedRole?.code}
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {allPermissions.map((perm) => {
                  const isChecked = selectedRole?.permissions.includes(perm as PermissionKey);
                  return (
                    <label
                      key={perm}
                      className={`flex items-center gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60 text-zinc-900 dark:text-zinc-100"
                          : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!isDraft || !canAdminister || readOnly}
                        onChange={() => handleTogglePermission(perm)}
                        className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5"
                      />
                      <span className="font-mono text-[11px]">{perm}</span>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
