'use client';

import React from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toast, ToastPortal, ToastViewport, ToastRoot } from '@/components/ui/toast';
import { toastManager } from '@/lib/toast';

interface LayoutProvidersProps {
  children: React.ReactNode;
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return (
    <>
      {toasts.map((toast) => (
        <ToastRoot key={toast.id} toast={toast} />
      ))}
    </>
  );
}

export function LayoutProviders({ children }: LayoutProvidersProps) {
  return (
    <Toast toastManager={toastManager}>
      <TooltipProvider>{children}</TooltipProvider>
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </Toast>
  );
}
