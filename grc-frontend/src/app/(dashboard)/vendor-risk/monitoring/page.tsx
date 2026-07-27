'use client';

// Continuous Monitoring — portfolio feed of outside-in signals across all
// vendors (security-rating drops, breaches, cert expiry, financial, SLA, etc).
// Filter / paginate; click through to the vendor to triage or trigger a
// reassessment (that lives on the vendor's lifecycle Monitoring panel).

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Radio, AlertCircle, ChevronLeft, ChevronRight, RefreshCw, BellRing, Check, Loader2, ArrowUpRight, ArrowDownWideNarrow, Clock } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import { SEV_HEX, sevBadgeCls, fmtDate, titleCase, TIER_ORDER } from '../_lib/tprmShared';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

interface Signal {
  id: number; vendor_id: number; vendor_name: string | null; signal_type: string;
  severity: string; title: string | null; source: string | null; detail: string | null;
  occurred_at: string | null; acknowledged: boolean; triggered_reassessment: boolean;
}
const PAGE = 25;
const TYPES = ['security_rating', 'breach', 'adverse_media', 'financial', 'sla', 'cert_expiry'];
// Lower index = more severe. Drives the severity-first sort.
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function MonitoringFeedPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canAck = hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [ack, setAck] = useState(''); // '' | 'new' | 'ack'
  const [reassessOnly, setReassessOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'severity'>('severity');
  const [page, setPage] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['tprm-monitoring', severity, type, ack, page],
    queryFn: async () => (await tpraApi.monitoringFeed({
      severity: severity || undefined, signal_type: type || undefined,
      acknowledged: ack === '' ? undefined : ack === 'ack',
      skip: page * PAGE, limit: PAGE,
    })).data as { items: Signal[]; total: number },
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });

  // Acknowledge — same update-signal endpoint the per-vendor SignalsPanel uses
  // (tpraApi.updateSignal). The portfolio feed doesn't surface row_version, so we
  // omit it; the backend skips the optimistic-concurrency check when it's absent.
  const ackMut = useMutation({
    mutationFn: (id: number) => tpraApi.updateSignal(id, { acknowledged: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tprm-monitoring'] });
      toast({ type: 'success', title: 'Signal acknowledged' });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not acknowledge', message: errMsg(e, 'Try again.') }),
  });

  const reset = (fn: () => void) => { fn(); setPage(0); };
  const rawItems = data?.items || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  // Client-side "triggered reassessment" filter + sort. The feed endpoint already
  // returns triggered_reassessment on each row; severity-first surfaces the most
  // urgent signals at the top of the current page.
  const items = useMemo(() => {
    let list = rawItems;
    if (reassessOnly) list = list.filter((s) => s.triggered_reassessment);
    if (sortBy === 'severity') {
      list = [...list].sort((a, b) => {
        const d = (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9);
        if (d !== 0) return d;
        return new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime();
      });
    }
    return list;
  }, [rawItems, reassessOnly, sortBy]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Monitoring Signals</h1>
        <p className="text-sm text-slate-500">Manually-logged signals for now — connect a ratings feed (BitSight / SecurityScorecard / UpGuard) to refresh automatically.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-xs text-gray-500">Severity
          <select value={severity} onChange={(e) => reset(() => setSeverity(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-slate-800">
            <option value="">All</option>{TIER_ORDER.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">Type
          <select value={type} onChange={(e) => reset(() => setType(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-slate-800">
            <option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">State
          <select value={ack} onChange={(e) => reset(() => setAck(e.target.value))} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-slate-800">
            <option value="">All</option><option value="new">New</option><option value="ack">Acknowledged</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={reassessOnly} onChange={(e) => setReassessOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600" /> Triggered reassessment
        </label>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>Sort</span>
          <div className="inline-flex rounded-lg border border-gray-300 p-0.5" role="group" aria-label="Sort signals">
            <button type="button" onClick={() => setSortBy('severity')} aria-pressed={sortBy === 'severity'}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${sortBy === 'severity' ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50'}`}>
              <ArrowDownWideNarrow className="h-3 w-3" strokeWidth={1.75} /> Severity
            </button>
            <button type="button" onClick={() => setSortBy('recent')} aria-pressed={sortBy === 'recent'}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${sortBy === 'recent' ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50'}`}>
              <Clock className="h-3 w-3" strokeWidth={1.75} /> Recent
            </button>
          </div>
        </div>
        <span className="ml-auto font-mono text-[11px] text-gray-400">{total} signal{total === 1 ? '' : 's'}</span>
      </div>

      {isLoading && !data ? (
        <div className="flex h-64 items-center justify-center"><PageLoader size="md" label="Loading monitoring feed…" /></div>
      ) : error ? (
        <div className="flex h-48 flex-col items-center justify-center text-red-500">
          <AlertCircle className="mb-2 h-7 w-7" /><p className="text-sm">Failed to load signals.</p>
          <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <Radio className="mx-auto mb-2 h-7 w-7 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">
            {reassessOnly && rawItems.length > 0 ? 'No signals triggered a reassessment' : 'No monitoring signals'}
          </p>
          <p className="text-xs text-gray-500">
            {reassessOnly && rawItems.length > 0
              ? 'Clear the "Triggered reassessment" filter to see all signals on this page.'
              : 'Signals appear here as feeds report changes, or when captured on a vendor.'}
          </p>
        </div>
      ) : (
        <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white ${isFetching ? 'opacity-70' : ''}`}>
          <div className="divide-y divide-gray-100">
            {items.map((s) => {
              const goToVendor = () => router.push(`/vendor-risk/vendors/${s.vendor_id}`);
              return (
                <div key={s.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                  <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: SEV_HEX[s.severity] || '#94a3b8' }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Primary nav is the signal title → vendor lifecycle. */}
                      <button onClick={goToVendor}
                        className="inline-flex items-center gap-1 text-left text-sm font-medium text-slate-800 hover:text-primary-700 hover:underline">
                        {s.title || titleCase(s.signal_type)}
                      </button>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sevBadgeCls(s.severity)}`}>{titleCase(s.severity)} severity</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{titleCase(s.signal_type)}</span>
                      {s.triggered_reassessment && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"><RefreshCw className="h-3 w-3" strokeWidth={1.75} /> reassessment</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-500">{s.vendor_name} · {fmtDate(s.occurred_at)}{s.source ? ` · ${s.source}` : ''}</p>
                    {s.detail && <p className="mt-0.5 truncate text-[11px] text-gray-400">{s.detail}</p>}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {s.acknowledged ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600"><Check className="h-3 w-3" strokeWidth={1.75} /> acknowledged</span>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-600"><BellRing className="h-3 w-3" strokeWidth={1.75} /> new</span>
                        {canAck && (
                          <button onClick={() => ackMut.mutate(s.id)} disabled={ackMut.isPending}
                            aria-label={`Acknowledge signal: ${s.title || titleCase(s.signal_type)}`} title="Acknowledge"
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                            {ackMut.isPending && ackMut.variables === s.id ? <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} /> : <Check className="h-3 w-3" strokeWidth={1.75} />}
                            Acknowledge
                          </button>
                        )}
                      </>
                    )}
                    <button onClick={goToVendor} aria-label={`Open ${s.vendor_name || 'vendor'} lifecycle`} title="Open vendor lifecycle"
                      className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-primary-600">
                      <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft className="h-3.5 w-3.5" /> Prev</button>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">Next <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
