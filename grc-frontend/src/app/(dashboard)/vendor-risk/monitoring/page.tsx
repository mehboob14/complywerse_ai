'use client';

// Continuous Monitoring — portfolio feed of outside-in signals across all
// vendors (security-rating drops, breaches, cert expiry, financial, SLA, etc).
// Filter / paginate; click through to the vendor to triage or trigger a
// reassessment (that lives on the vendor's lifecycle Monitoring panel).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Radio, AlertCircle, ChevronLeft, ChevronRight, RefreshCw, BellRing } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { SEV_HEX, sevBadgeCls, fmtDate, titleCase, TIER_ORDER } from '../_lib/tprmShared';

interface Signal {
  id: number; vendor_id: number; vendor_name: string | null; signal_type: string;
  severity: string; title: string | null; source: string | null; detail: string | null;
  occurred_at: string | null; acknowledged: boolean; triggered_reassessment: boolean;
}
const PAGE = 25;
const TYPES = ['security_rating', 'breach', 'adverse_media', 'financial', 'sla', 'cert_expiry'];

export default function MonitoringFeedPage() {
  const router = useRouter();
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [ack, setAck] = useState(''); // '' | 'new' | 'ack'
  const [page, setPage] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['tprm-monitoring', severity, type, ack, page],
    queryFn: async () => (await tpraApi.monitoringFeed({
      severity: severity || undefined, signal_type: type || undefined,
      acknowledged: ack === '' ? undefined : ack === 'ack',
      skip: page * PAGE, limit: PAGE,
    })).data as { items: Signal[]; total: number },
    placeholderData: keepPreviousData,
  });

  const reset = (fn: () => void) => { fn(); setPage(0); };
  const items = data?.items || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Continuous Monitoring</h1>
        <p className="text-sm text-gray-500">Outside-in signals keep vendor ratings fresh between formal reviews.</p>
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
        <span className="ml-auto font-mono text-[11px] text-gray-400">{total} signal{total === 1 ? '' : 's'}</span>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center"><PageLoader size="md" label="Loading monitoring feed…" /></div>
      ) : error ? (
        <div className="flex h-48 flex-col items-center justify-center text-red-500">
          <AlertCircle className="mb-2 h-7 w-7" /><p className="text-sm">Failed to load signals.</p>
          <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <Radio className="mx-auto mb-2 h-7 w-7 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No monitoring signals</p>
          <p className="text-xs text-gray-500">Signals appear here as feeds report changes, or when captured on a vendor.</p>
        </div>
      ) : (
        <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white ${isFetching ? 'opacity-70' : ''}`}>
          <div className="divide-y divide-gray-100">
            {items.map((s) => (
              <button key={s.id} onClick={() => router.push(`/vendor-risk/vendors/${s.vendor_id}`)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50">
                <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: SEV_HEX[s.severity] || '#94a3b8' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{s.title || titleCase(s.signal_type)}</span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sevBadgeCls(s.severity)}`}>{titleCase(s.severity)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{titleCase(s.signal_type)}</span>
                    {s.triggered_reassessment && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"><RefreshCw className="h-3 w-3" /> reassessment</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">{s.vendor_name} · {fmtDate(s.occurred_at)}{s.source ? ` · ${s.source}` : ''}</p>
                  {s.detail && <p className="mt-0.5 truncate text-[11px] text-gray-400">{s.detail}</p>}
                </div>
                {!s.acknowledged && (
                  <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600"><BellRing className="h-3 w-3" /> new</span>
                )}
              </button>
            ))}
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
