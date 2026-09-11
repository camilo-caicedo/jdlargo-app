import type { Metadata } from 'next';
import * as React from 'react';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Portal de Contraparte | JD Largo',
  description: 'Diligenciamiento seguro de debida diligencia LA/FT/FPADM',
};

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 flex flex-col items-center p-4 sm:p-8 md:p-12">
      <Toaster richColors position="top-center" />
      <header className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 font-semibold text-xl tracking-tight text-zinc-900 dark:text-zinc-100">
          <span className="w-3 h-3 rounded-full bg-emerald-600 dark:bg-emerald-500 inline-block" />
          JD Largo
        </div>
        <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Plataforma de Debida Diligencia y Cumplimiento
        </p>
      </header>
      <main className="w-full max-w-4xl flex-1">
        {children}
      </main>
      <footer className="mt-12 mb-4 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Conexión cifrada de extremo a extremo
      </footer>
    </div>
  );
}
