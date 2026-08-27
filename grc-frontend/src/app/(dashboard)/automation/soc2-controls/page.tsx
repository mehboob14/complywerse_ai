'use client';

// SOC 2 → Controls library. Faithful to the Verity reference controls-page:
// overline + title + live count summary, a search/facet band, and a dense table
// (Control · Trust Services · Criteria · Frameworks · Type · Checks · Status)
// with paging. A row opens the control-detail page. Wired to /automation/soc2.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { automationApi } from '@/lib/api';
import {
  TRUST_SERVICES,
  TrustServiceChip,
  CriterionChip,
  SubTypeChip,
  ControlStatusPill,
  CONTROL_STATUS,
  trustServicesForCriteria,
  type Soc2Control,
} from '@/components/soc2/ui';

const PAGE_SIZE = 20;
const SUB_TYPES = ['Automated', 'Hybrid', 'Manual'];
const STATUS_OPTS = ['passed', 'failed', 'partial', 'not_run', 'manual'];

/** The framework's mark — a small contained badge, one per row (all SOC 2 here). */
function FrameworkBadge() {
  return (
    <span
      title="SOC 2"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-50 text-[9px] font-bold text-primary-700 ring-1 ring-inset ring-primary-100"
    >
      SOC2
    </span>
  );
}

export default function ControlsLibraryPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [tsc, setTsc] = useState('all');
  const [subType, setSubType] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['soc2-library'],
    queryFn: () =>
      automationApi.listControls().then((r) => r.data as { framework: string; controls: Soc2Control[] }),
  });
  const seed = useMutation({
    mutationFn: () => automationApi.seed(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['soc2-library'] }),
  });

  const controls = useMemo(() => data?.controls ?? [], [data]);
  const automated = controls.filter((c) => c.sub_type === 'Automated').length;
  const failing = controls.filter((c) => c.overall_status === 'failed').length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return controls.filter((c) => {
      const services = trustServicesForCriteria(c.criteria || []);
      return (
        (tsc === 'all' || services.includes(tsc as (typeof TRUST_SERVICES)[number])) &&
        (subType === 'all' || c.sub_type === subType) &&
        (status === 'all' || c.overall_status === status) &&
        (!q ||
          c.control_id.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          (c.criteria || []).some((k) => k.toLowerCase().includes(q)))
      );
    });
  }, [controls, search, tsc, subType, status]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const cur = Math.min(page, pageCount);
  const start = (cur - 1) * PAGE_SIZE;
  const paged = visible.slice(start, start + PAGE_SIZE);
  const reset = () => setPage(1);

  const selCls = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-600 focus:border-primary-500 focus:outline-none';

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-1 py-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Compliance</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Controls library</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            <span className="tabular-nums font-medium text-slate-700">{controls.length}</span> controls across SOC 2
            {' · '}
            <span className="font-medium text-slate-700">{automated}</span> automated
            {failing > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-rose-600">{failing} failing</span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => seed.mutate()}
          disabled={seed.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {seed.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); reset(); }}
            placeholder="Search by name, code or criterion…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-2 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <select value={tsc} onChange={(e) => { setTsc(e.target.value); reset(); }} className={selCls}>
          <option value="all">Trust Services: All</option>
          {TRUST_SERVICES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={subType} onChange={(e) => { setSubType(e.target.value); reset(); }} className={selCls}>
          <option value="all">Type: All</option>
          {SUB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} className={selCls}>
          <option value="all">Status: All</option>
          {STATUS_OPTS.map((s) => <option key={s} value={s}>{CONTROL_STATUS[s].label}</option>)}
        </select>
      </div>

      <p className="text-xs text-slate-400">
        Showing <span className="tabular-nums">{visible.length}</span> of{' '}
        <span className="tabular-nums">{controls.length}</span> controls
      </p>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Couldn’t load controls — the backend may need a restart.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-2.5 text-left font-semibold">Control</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Trust Services</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Criteria</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Frameworks</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Type</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Checks</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((c) => {
                  const services = trustServicesForCriteria(c.criteria || []);
                  return (
                    <tr
                      key={c.control_id}
                      onClick={() => router.push(`/automation/soc2-controls/${c.control_id}`)}
                      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                    >
                      <td className="px-4 py-3">
                        <div className="max-w-[320px]">
                          <span className="font-mono text-[11px] text-slate-400">{c.control_id}</span>
                          <span className="mt-0.5 block truncate font-medium text-slate-800">{c.title}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {services.length ? services.map((t) => <TrustServiceChip key={t} tsc={t} />) : <span className="text-slate-300">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex max-w-[150px] flex-wrap gap-1">
                          {(c.criteria || []).length ? (c.criteria || []).map((k) => <CriterionChip key={k} code={k} />) : <span className="text-[11px] text-amber-600">None</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3"><FrameworkBadge /></td>
                      <td className="px-3 py-3"><SubTypeChip value={c.sub_type} /></td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{c.checks_count || <span className="text-slate-300">0</span>}</td>
                      <td className="px-3 py-3"><ControlStatusPill status={c.overall_status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="tabular-nums">
            {start + 1}–{Math.min(start + PAGE_SIZE, visible.length)} of {visible.length}
          </span>
          <div className="flex gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={cur === 1} className="rounded border border-slate-200 px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40">Prev</button>
            <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={cur >= pageCount} className="rounded border border-slate-200 px-2.5 py-1 hover:bg-slate-50 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
