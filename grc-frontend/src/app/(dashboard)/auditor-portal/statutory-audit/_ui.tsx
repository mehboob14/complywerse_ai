'use client';

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  complied: 'Complied',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const TYPE_LABEL: Record<string, string> = {
  requirement: 'Requirement',
  observation: 'Observation',
  finding: 'Finding',
  recommendation: 'Recommendation',
};

export const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));
export const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));
export const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));

export function StatusBadge({ status }: { status?: string }) {
  const s = (status || 'open').toLowerCase();
  const tones: Record<string, string> = {
    open: 'bg-slate-100 text-slate-700 border-slate-200',
    in_progress: 'bg-sky-50 text-sky-800 border-sky-200',
    complied: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    closed: 'bg-slate-50 text-slate-500 border-slate-200',
    cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[s] || tones.open}`}>
      {STATUS_LABEL[s] || status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority?: string }) {
  const p = (priority || 'medium').toLowerCase();
  const tones: Record<string, string> = {
    critical: 'bg-rose-50 text-rose-800 border-rose-200',
    high: 'bg-orange-50 text-orange-800 border-orange-200',
    medium: 'bg-amber-50 text-amber-800 border-amber-200',
    low: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[p] || tones.medium}`}>
      {PRIORITY_LABEL[p] || priority}
    </span>
  );
}

export function fmtDate(v?: string | null) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return v;
  }
}

export const fieldClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-300';
export const labelClass = 'mb-1 block text-xs font-medium text-slate-600';
