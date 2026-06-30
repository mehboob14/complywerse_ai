'use client';

// Findings & Remediation — cross-portfolio risk register. Every gap across all
// vendors, with vendor name, SLA due date and overdue flag. Filter / sort /
// paginate; click a row to open the vendor's lifecycle where it's edited.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { sevBadgeCls, DOMAIN_LABELS, DOMAIN_KEYS, STATUS_LABELS, fmtDate, titleCase, TIER_ORDER } from '../_lib/tprmShared';

interface Finding {
  id: number; vendor_id: number; vendor_name: string | null; domain: string;
  severity: string; title: string | null; status: string; is_critical_control_fail: boolean;
  due_date: string | null; overdue: boolean; created_at: string | null;
}
const PAGE = 25;
const STATUSES = ['open', 'in_remediation', 'accepted', 'closed'];

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ v: string; l: string }>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-slate-800">
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

export default function FindingsRegisterPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [domain, setDomain] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['tprm-findings', status, severity, domain, overdueOnly, page],
    queryFn: async () => (await tpraApi.findingsRegister({
      status: status || undefined, severity: severity || undefined, domain: domain || undefined,
      overdue_only: overdueOnly || undefined, sort: 'created_at', order: 'desc',
      skip: page * PAGE, limit: PAGE,
    })).data as { items: Finding[]; total: number; skip: number; limit: number },
    placeholderData: keepPreviousData,
  });

  const reset = (fn: () => void) => { fn(); setPage(0); };
  const items = data?.items || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Findings &amp; Remediation</h1>
        <p className="text-sm text-gray-500">Every open and historical gap across the portfolio. Tracked to closure with SLA.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5">
        <Select label="Status" value={status} onChange={(v) => reset(() => setStatus(v))}
          options={[{ v: '', l: 'All' }, ...STATUSES.map((s) => ({ v: s, l: STATUS_LABELS[s] || titleCase(s) }))]} />
        <Select label="Severity" value={severity} onChange={(v) => reset(() => setSeverity(v))}
          options={[{ v: '', l: 'All' }, ...TIER_ORDER.map((s) => ({ v: s, l: titleCase(s) }))]} />
        <Select label="Domain" value={domain} onChange={(v) => reset(() => setDomain(v))}
          options={[{ v: '', l: 'All' }, ...DOMAIN_KEYS.map((d) => ({ v: d, l: DOMAIN_LABELS[d] }))]} />
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => reset(() => setOverdueOnly(e.target.checked))}
            className="h-3.5 w-3.5 rounded border-gray-300" /> Overdue only
        </label>
        <span className="ml-auto font-mono text-[11px] text-gray-400">{total} finding{total === 1 ? '' : 's'}</span>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center"><PageLoader size="md" label="Loading findings…" /></div>
      ) : error ? (
        <div className="flex h-48 flex-col items-center justify-center text-red-500">
          <AlertCircle className="mb-2 h-7 w-7" /><p className="text-sm">Failed to load findings.</p>
          <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-emerald-500" />
          <p className="text-sm font-medium text-gray-700">No findings match these filters</p>
          <p className="text-xs text-gray-500">Adjust the filters above, or assess a vendor to surface gaps.</p>
        </div>
      ) : (
        <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white ${isFetching ? 'opacity-70' : ''}`}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Severity</th>
                  <th className="px-4 py-2.5">Finding</th>
                  <th className="px-4 py-2.5">Vendor</th>
                  <th className="px-4 py-2.5">Domain</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">SLA due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((f) => (
                  <tr key={f.id} onClick={() => router.push(`/vendor-risk/vendors/${f.vendor_id}`)}
                    className="cursor-pointer hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sevBadgeCls(f.severity)}`}>{titleCase(f.severity)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-800">{f.title || 'Untitled finding'}</span>
                      {f.is_critical_control_fail && <span className="ml-2 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-600">critical control</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{f.vendor_name || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{DOMAIN_LABELS[f.domain] || titleCase(f.domain)}</td>
                    <td className="px-4 py-2.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{STATUS_LABELS[f.status] || titleCase(f.status)}</span></td>
                    <td className="px-4 py-2.5">
                      <span className={f.overdue ? 'font-medium text-red-600' : 'text-gray-500'}>
                        {fmtDate(f.due_date)}{f.overdue && ' · overdue'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
