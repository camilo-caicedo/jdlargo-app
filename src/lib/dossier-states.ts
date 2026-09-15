/**
 * Dossier state definitions and display utilities.
 * Centralizes state enums and mappings to ensure consistent labeling across the app.
 */

export enum DossierState {
  DRAFT = 'borrador',
  SENT = 'enviada',
  IN_DILIGENCE = 'en_diligenciamiento',
  DOCUMENTS_RECEIVED = 'documentos_recibidos',
  IN_REVIEW = 'en_revision',
  PENDING_DECISION = 'pendiente_de_decision',
  APPROVED = 'aprobada',
  REJECTED = 'rechazada',
  CLOSED = 'cerrada',
  EXPIRED_PENDING = 'expirado_pendiente',
}

export const DOSSIER_STATE_LABELS: Record<DossierState, string> = {
  [DossierState.DRAFT]: 'Borrador',
  [DossierState.SENT]: 'Enviada',
  [DossierState.IN_DILIGENCE]: 'En diligenciamiento',
  [DossierState.DOCUMENTS_RECEIVED]: 'Documentos recibidos',
  [DossierState.IN_REVIEW]: 'En revisión',
  [DossierState.PENDING_DECISION]: 'Pendiente de decisión',
  [DossierState.APPROVED]: 'Aprobada',
  [DossierState.REJECTED]: 'Rechazada',
  [DossierState.CLOSED]: 'Cerrada',
  [DossierState.EXPIRED_PENDING]: 'Expirado / Pendiente',
};

export const DOSSIER_STATE_COLORS: Record<
  DossierState,
  { bg: string; text: string; border: string }
> = {
  [DossierState.DRAFT]: {
    bg: 'bg-zinc-100 dark:bg-zinc-800',
    text: 'text-zinc-700 dark:text-zinc-300',
    border: 'border-zinc-200 dark:border-zinc-700',
  },
  [DossierState.SENT]: {
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-200/50 dark:border-purple-800/40',
  },
  [DossierState.IN_DILIGENCE]: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200/50 dark:border-blue-800/40',
  },
  [DossierState.DOCUMENTS_RECEIVED]: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-200/50 dark:border-indigo-800/40',
  },
  [DossierState.IN_REVIEW]: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200/50 dark:border-amber-800/40',
  },
  [DossierState.PENDING_DECISION]: {
    bg: 'bg-teal-100 dark:bg-teal-950',
    text: 'text-teal-800 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-700',
  },
  [DossierState.APPROVED]: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200/50 dark:border-emerald-800/40',
  },
  [DossierState.REJECTED]: {
    bg: 'bg-red-50 dark:bg-red-950/40',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200/50 dark:border-red-800/40',
  },
  [DossierState.CLOSED]: {
    bg: 'bg-slate-50 dark:bg-slate-950/40',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200/50 dark:border-slate-800/40',
  },
  [DossierState.EXPIRED_PENDING]: {
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-200/50 dark:border-orange-800/40',
  },
};

export interface StateBadge {
  label: string;
  className: string;
}

export function getStateBadge(state: string): StateBadge {
  const stateKey = state as DossierState;
  const colors = DOSSIER_STATE_COLORS[stateKey];

  if (!colors) {
    return {
      label: state,
      className: `${DOSSIER_STATE_COLORS[DossierState.DRAFT].bg} ${DOSSIER_STATE_COLORS[DossierState.DRAFT].text} border ${DOSSIER_STATE_COLORS[DossierState.DRAFT].border}`,
    };
  }

  return {
    label: DOSSIER_STATE_LABELS[stateKey] || state,
    className: `${colors.bg} ${colors.text} border ${colors.border}`,
  };
}

export function getStateLabel(state: string): string {
  return DOSSIER_STATE_LABELS[state as DossierState] || state;
}
