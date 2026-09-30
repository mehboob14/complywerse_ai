'use client';

// Screening work queue — World-Check One (LSEG) matches across all vendors that
// need an analyst decision, plus resolutions not yet synced back to World-Check One.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { AlertCircle, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { trDataApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { MatchTable, ResolveMatchPanel, type ScreeningMatch } from '../vendors/[id]/_tpra/ScreeningPanel';

const PAGE = 25;
const CLASSES = ['sanctions', 'law_enforcement', 'pep', 'adverse_media', 'other'];

interface Summary {
  by_status: Record<string, number>; unresolved_by_class: Record<string, number>; sync_failed: number;
  connection: { configured: boolean; active: boolean; mode: string | null };
}

export default function ScreeningQueuePage() {
  const qc = useQueryClient();
  const { hasAnyPermission, hasPermission } = usePermissions();
  const canView = hasAnyPermission(['vendor_risk:screening:view', 'vendor_risk:screening:run', 'vendor_risk:screening:resolve', 'erm:risks:edit']);
  const canResolve = hasPermission('vendor_risk:screening:resolve');
  const [status, setStatus] = useState('unresolved');
  const [hitClass, setHitClass] = useState('');
  const [syncFailed, setSyncFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<ScreeningMatch | null>(null);

  const summary = useQuery({
    queryKey: ['tr-screening-summary'],
    queryFn: async () => (await trDataApi.screeningSummary()).data as Summary,
    enabled: canView, ...TPRM_QUERY_OPTS,
  });
  const queue = useQuery({
    queryKey: ['tr-screening-queue', status, hitClass, syncFailed, page],
    queryFn: async () => (await trDataApi.screeningQueue({
      resolution_status: status || undefined, hit_class: hitClass || undefined,
      sync_status: syncFailed ? 'failed' : undefined, skip: page * PAGE, limit: PAGE,
    })).data as { items: ScreeningMatch[]; total: number },
    enabled: canView, placeholderData: keepPreviousData, ...TPRM_QUERY_OPTS,
  });

  if (!canView) {
    return <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">Viewing screening results requires the <b>vendor_risk:screening:view</b> permission.</p>;
  }
  const reset = (fn: () => void) => { fn(); setPage(0); };
  const total = queue.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const s = summary.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Screening</h1>
        <p className="text-sm text-gray-500">Sanctions, PEP and adverse-media matches from World-Check One (LSEG) across your vendors and their key people.</p>
      </div>

      {s && !s.connection.configured && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm">
          <span className="text-gray-600">World-Check One is not set up yet.</span>
          <Link href="/vendor-risk/settings#data-providers" className="text-xs font-medium text-primary-600 hover:underline">Set up data providers →</Link>
        </div>
      )}
      {s?.connection.mode === 'simulated' && (
        <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800"><b>Simulated mode.</b> Matches are fictitious test data.</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Awaiting review', value: s?.by_status?.unresolved ?? 0 },
          { label: 'Possible (EDD)', value: s?.by_status?.possible ?? 0 },
          { label: 'Confirmed', value: s?.by_status?.positive ?? 0 },
          { label: 'Not synced', value: s?.sync_failed ?? 0 },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className="text-xl font-semibold text-slate-900">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-xs text-gray-500">Resolution
          <select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-slate-800">
            <option value="">All</option><option value="unresolved">Unresolved</option><option value="possible">Possible</option>
            <option value="positive">Positive</option><option value="false">False</option><option value="unspecified">Unspecified</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">Type
          <select value={hitClass} onChange={(e) => reset(() => setHitClass(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-slate-800">
            <option value="">All</option>
            {CLASSES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}{s?.unresolved_by_class?.[c] ? ` (${s.unresolved_by_class[c]} open)` : ''}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={syncFailed} onChange={(e) => reset(() => setSyncFailed(e.target.checked))} className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600" />
          Not synced to World-Check One
        </label>
        <span className="ml-auto font-mono text-[11px] text-gray-400">{total} match{total === 1 ? '' : 'es'}</span>
      </div>

      {queue.isLoading && !queue.data ? (
        <div className="flex h-48 items-center justify-center"><PageLoader size="md" label="Loading screening queue…" /></div>
      ) : queue.error ? (
        <div className="flex h-40 flex-col items-center justify-center text-red-500">
          <AlertCircle className="mb-2 h-6 w-6" /><p className="text-sm">Failed to load the screening queue.</p>
          <button onClick={() => queue.refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
        </div>
      ) : (queue.data?.items || []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <ShieldCheck className="mx-auto mb-2 h-7 w-7 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">Nothing to review</p>
          <p className="text-xs text-gray-500">Matches appear here when a vendor or key person is screened, or ongoing screening finds something new.</p>
        </div>
      ) : (
        <div className={`space-y-2 ${queue.isFetching ? 'opacity-70' : ''}`}>
          <MatchTable matches={queue.data!.items} onOpen={setOpen} showVendor />
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft className="h-3.5 w-3.5" /> Prev</button>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">Next <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      )}

      <ResolveMatchPanel match={open} canResolve={canResolve} onClose={() => setOpen(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['tr-screening-queue'] });
          qc.invalidateQueries({ queryKey: ['tr-screening-summary'] });
        }} />
    </div>
  );
}
