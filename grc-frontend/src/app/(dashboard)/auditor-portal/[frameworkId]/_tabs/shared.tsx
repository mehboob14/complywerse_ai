'use client';

import { Loader2, AlertCircle, Inbox } from 'lucide-react';

/**
 * Shared scaffolding for every auditor-portal tab.
 *
 * Each tab is a thin shell around a React Query call that hits one of
 * the per-section endpoints on /auditor-portal/{id}. Centralising the
 * loading/error/empty states here keeps every tab visually consistent
 * and avoids re-implementing the boilerplate in each file.
 */
export function TabLoader() {
  return (
    <div className="flex items-center justify-center py-16 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Loading…
    </div>
  );
}

export function TabError({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
      <AlertCircle className="h-4 w-4" />
      {message || 'Failed to load this section. Please try again.'}
    </div>
  );
}

export function TabEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
      <Inbox className="mx-auto h-10 w-10 text-slate-400" />
      <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function StatusPill({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const v = value.toLowerCase();
  const color =
    v === 'approved' || v === 'active' || v === 'published' || v === 'in_scope'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : v === 'rejected' || v === 'open' || v === 'failed' || v === 'expired'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : v === 'pending' || v === 'draft' || v === 'in_progress'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${color}`}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export const SECTION_ROOT = '/auditor-portal';
