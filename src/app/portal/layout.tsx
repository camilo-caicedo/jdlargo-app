import type { Metadata } from 'next';
import * as React from 'react';

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
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <header className="mb-6 text-center">
        <div className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-500 inline-block" />
          JD Largo
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Plataforma de Debida Diligencia y Cumplimiento
        </p>
      </header>
      <main className="w-full max-w-[440px]">
        {children}
      </main>
      <footer className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Conexión cifrada de extremo a extremo
      </footer>
    </div>
  );
}
