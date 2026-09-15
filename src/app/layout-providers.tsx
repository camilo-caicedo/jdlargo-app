'use client';

import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toast, ToastPortal, ToastViewport } from '@/components/ui/toast';
import { toastManager } from '@/lib/toast';

interface LayoutProvidersProps {
  children: React.ReactNode;
}

export function LayoutProviders({ children }: LayoutProvidersProps) {
  return (
    <Toast toastManager={toastManager}>
      <TooltipProvider>{children}</TooltipProvider>
      <ToastPortal>
        <ToastViewport />
      </ToastPortal>
    </Toast>
  );
}
