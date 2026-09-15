import { ShieldCheck, FileCheck2 } from 'lucide-react';
import type { DecisionRecord } from '@/server/dossiers/decision';

interface DecisionHistoryBannerProps {
  decisionsHistory: DecisionRecord[];
}

export function DecisionHistoryBanner({ decisionsHistory }: DecisionHistoryBannerProps) {
  if (decisionsHistory.length === 0) return null;

  return (
    <div className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-950/60 bg-emerald-50/20 dark:bg-emerald-950/10 space-y-4">
      <div className="flex items-center gap-2 border-b border-emerald-100/70 dark:border-emerald-900/40 pb-3">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <div>
          <h2 className="text-sm font-semibold text-emerald-950 dark:text-emerald-200">
            Decisiones registradas ({decisionsHistory.length})
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Historial formal de decisiones del Oficial de Cumplimiento.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-emerald-100/60 dark:divide-emerald-900/30 text-xs">
        {decisionsHistory.map((d, index) => {
          const isLatest = index === decisionsHistory.length - 1;
          return (
            <li key={d.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Decisor: <strong className="text-zinc-800 dark:text-zinc-200">{d.title}</strong>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    {new Date(d.madeAt).toLocaleDateString()} · Vigente hasta: {new Date(d.validUntil).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded font-semibold text-[10px] uppercase whitespace-nowrap ${
                      d.type === 'approve'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                        : d.type === 'approve_with_conditions'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
                    }`}
                  >
                    {d.type === 'approve'
                      ? 'Aprobada'
                      : d.type === 'approve_with_conditions'
                      ? 'Cond.'
                      : 'Rechazada'}
                  </span>
                  {isLatest && (
                    <span className="text-[9px] bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                      Vigente
                    </span>
                  )}
                </div>
              </div>

              <div className="p-2.5 rounded bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-0.5">Fundamento:</span>
                <p className="text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{d.rationale}</p>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <div className="text-zinc-400 flex items-center gap-1">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>{d.evidence.length} elemento(s) de evidencia citados</span>
                </div>
                <div className="text-zinc-400 whitespace-nowrap">
                  {new Date(d.madeAt).toLocaleDateString()} {new Date(d.madeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {d.conditions && d.conditions.length > 0 && (
                <div className="p-2.5 rounded bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/50">
                  <span className="font-semibold text-amber-900 dark:text-amber-300 block mb-1">Condiciones:</span>
                  <ul className="list-disc list-inside space-y-0.5 text-amber-800 dark:text-amber-400">
                    {d.conditions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
