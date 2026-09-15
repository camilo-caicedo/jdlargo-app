'use client';

import { useState } from 'react';
import { revokeInvitationAction, inviteMemberAction } from './actions';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Loader2, Trash2, RefreshCw } from 'lucide-react';
import { type InvitationDetail } from '@/server/organizations/invitations';

interface PendingListProps {
  organizationId: string;
  invitations: InvitationDetail[];
}

export function PendingInvitationsList({ organizationId, invitations }: PendingListProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  if (invitations.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No hay invitaciones pendientes activas para esta organización.
      </div>
    );
  }

  const handleRevoke = async (invitationId: string) => {
    setLoadingId(invitationId);
    setActionError(null);
    try {
      const res = await revokeInvitationAction(organizationId, invitationId);
      if (!res.success) {
        setActionError(res.error || 'No se pudo revocar la invitación');
      }
    } finally {
      setLoadingId(null);
    }
  };

  const handleResend = async (email: string, role: string) => {
    setLoadingId(email);
    setActionError(null);
    try {
      const formData = new FormData();
      formData.append('email', email);
      formData.append('role', role);
      const res = await inviteMemberAction(organizationId, null, formData);
      if (!res.success) {
        setActionError(res.error || 'No se pudo reenviar la invitación');
      }
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {actionError && (
        <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/40 p-2.5 rounded-md">
          {actionError}
        </div>
      )}

      <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {invitations.map((inv) => {
          const isBusy = loadingId === inv.id || loadingId === inv.email;
          const formattedDate = new Date(inv.createdAt).toLocaleDateString('es-CO', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });

          return (
            <div
              key={inv.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white dark:bg-zinc-900 gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                    {inv.email}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    Pendiente
                  </span>
                </div>
                <div className="text-xs text-zinc-500">
                  Rol: <span className="font-medium text-zinc-700 dark:text-zinc-300">{inv.role}</span> · Enviada el {formattedDate}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => handleResend(inv.email, inv.role)}
                  className="text-xs h-8"
                  title="Reenviar invitación (invalida la anterior)"
                >
                  {isBusy && loadingId === inv.email ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Reenviar
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => setPendingRevokeId(inv.id)}
                  className="text-xs h-8 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  title="Revocar invitación"
                >
                  {isBusy && loadingId === inv.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Revocar
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={pendingRevokeId !== null} onOpenChange={(open) => !open && setPendingRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revocar invitación</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Está seguro de que desea revocar esta invitación? El enlace dejará de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center justify-end gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const id = pendingRevokeId;
                setPendingRevokeId(null);
                if (id) handleRevoke(id);
              }}
            >
              Revocar
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
