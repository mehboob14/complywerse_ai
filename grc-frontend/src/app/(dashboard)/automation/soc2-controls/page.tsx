'use client';

// Automation → Common Controls library. One unified control set (Probo
// mitigations) where each control maps to requirements across SOC 2 / ISO 27001
// / GDPR. Search + facets (category, framework, type, status), an optional
// group-by-category view (like the control catalog), and one shared automated-
// check engine so linked checks + live status show on every control. A row opens
// the control-detail page.

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Search, Layers, List, ListChecks, ShieldCheck } from 'lucide-react';
import { automationApi } from '@/lib/api';
import {
  SubTypeChip, ControlStatusPill, CONTROL_STATUS, FrameworkBadge,
  type CommonControl, type FrameworkReq,
} from '@/components/soc2/ui';

const SUB_TYPES = ['Automated', 'Hybrid', 'Manual'];
const STATUS_OPTS = ['passed', 'failed', 'partial', 'expired', 'collection_failed', 'not_run', 'manual'];
// Order the crosswalk rows: the frameworks with the most requirements first, so
// the densest mapping is what the eye lands on. Driven by the data, not a list.
const fwOrder = (reqs: CommonControl['requirements']): string[] =>
  Object.keys(reqs || {}).filter((k) => (reqs[k] || []).length)
    .sort((a, b) => (reqs[b].length - reqs[a].length) || a.localeCompare(b));

// A control can discharge obligations in 20+ frameworks. Rendering all of them
// makes one row taller than the viewport and the table unscannable, so the cell
// is a preview: the densest few frameworks, the rest behind a count that leads
// to the detail page where the full crosswalk lives.
const MAX_FW_ROWS = 3;
const MAX_CODES = 5;

/** Framework crosswalk preview: each framework's requirement codes on their own
 * aligned row (fixed-width pill column so the codes line up), SCF-style, capped
 * so every row stays the same scannable height. When a framework filter is
 * active that framework is the only thing the reader is looking for, so it is
 * shown alone and in full rather than buried among twenty others. */
function CrosswalkCell({ reqs, only }: { reqs: CommonControl['requirements']; only?: string }) {
  const all = fwOrder(reqs);
  if (!all.length) return <span className="text-[11px] text-slate-300">No crosswalk</span>;

  const filtered = only && only !== 'all';
  const groups = filtered ? all.filter((f) => f === only) : all;
  const shownGroups = filtered ? groups : groups.slice(0, MAX_FW_ROWS);
  const hiddenFw = groups.length - shownGroups.length;
  const hiddenReqs = groups
    .slice(shownGroups.length)
    .reduce((n, f) => n + (reqs[f] || []).length, 0);

  return (
    <div className="max-w-[420px]">
      <div className="grid grid-cols-[68px_1fr] items-start gap-x-2.5 gap-y-1.5">
        {shownGroups.map((fw) => {
          const items = reqs[fw] || [];
          // The filtered framework is the answer to the reader's question, so it
          // gets more room before it truncates.
          const cap = filtered ? 12 : MAX_CODES;
          const shown = items.slice(0, cap);
          return (
            <Fragment key={fw}>
              <div className="pt-px"><FrameworkBadge fw={fw} /></div>
              <div className="flex flex-wrap items-center gap-1">
                {shown.map((r: FrameworkReq) => (
                  <span key={r.code} title={r.text || r.name} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                    {r.code}
                  </span>
                ))}
                {items.length > shown.length && (
                  <span className="text-[10px] font-medium text-slate-400" title={`${items.length - shown.length} more requirement(s)`}>
                    +{items.length - shown.length}
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
      {hiddenFw > 0 && (
        <p className="mt-1.5 text-[10px] font-medium text-primary-600">
          +{hiddenFw} more framework{hiddenFw === 1 ? '' : 's'}
          {hiddenReqs > 0 && ` · ${hiddenReqs} requirement${hiddenReqs === 1 ? '' : 's'}`} — open to view
        </p>
      )}
    </div>
  );
}

/** Compact header metric. */
function StatChip({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'rose' | 'emerald' }) {
  const cls =
    tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-700'
      : tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${cls}`}>
      <span className="tabular-nums text-sm font-bold">{value}</span>{label}
    </span>
  );
}

export default function CommonControlsLibraryPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [fw, setFw] = useState('all');
  const [subType, setSubType] = useState('all');
  const [status, setStatus] = useState('all');
  const [grouped, setGrouped] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['automation-common'],
    queryFn: () =>
      automationApi.listCommonControls().then(
        (r) => r.data as { controls: CommonControl[]; categories: string[];
          frameworks: { key: string; label: string; authored: boolean }[]; framework: string },
      ),
  });
  const seed = useMutation({
    mutationFn: () => automationApi.seed(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-common'] }),
  });

  const controls = useMemo(() => data?.controls ?? [], [data]);
  const categories = data?.categories ?? [];
  const frameworks = data?.frameworks ?? [];
  const libraryName = data?.framework ?? 'Common controls';
  const automated = controls.filter((c) => c.sub_type === 'Automated').length;
  const failing = controls.filter((c) => c.overall_status === 'failed').length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return controls.filter((c) => {
      return (
        (cat === 'all' || c.category === cat) &&
        (fw === 'all' || (c.frameworks || []).includes(fw)) &&
        (subType === 'all' || c.sub_type === subType) &&
        (status === 'all' || c.overall_status === status) &&
        (!q ||
          c.control_id.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          fwOrder(c.requirements).some((f) => (c.requirements[f] || []).some((r) => r.code.toLowerCase().includes(q))))
      );
    });
  }, [controls, search, cat, fw, subType, status]);

  const byCategory = useMemo(() => {
    const m = new Map<string, CommonControl[]>();
    for (const c of visible) {
      const k = c.category || 'Uncategorized';
      (m.get(k) || m.set(k, []).get(k)!).push(c);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const selCls = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-600 focus:border-primary-500 focus:outline-none';

  const openControl = (code: string) => router.push(`/automation/soc2-controls/${encodeURIComponent(code)}`);

  const Row = ({ c }: { c: CommonControl }) => (
    <tr
      key={c.control_id}
      onClick={() => openControl(c.control_id)}
      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
    >
      <td className="px-4 py-3">
        <div className="max-w-[300px]">
          <span className="font-mono text-[11px] text-slate-400">{c.control_id}</span>
          <span className="mt-0.5 block truncate font-medium text-slate-800">{c.title}</span>
        </div>
      </td>
      {!grouped && <td className="px-3 py-3 text-[12px] text-slate-600">{c.category || '—'}</td>}
      <td className="px-3 py-3"><CrosswalkCell reqs={c.requirements} only={fw} /></td>
      <td className="px-3 py-3"><SubTypeChip value={c.sub_type} /></td>
      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{c.checks_count || <span className="text-slate-300">0</span>}</td>
      <td className="px-3 py-3"><ControlStatusPill status={c.overall_status} /></td>
    </tr>
  );

  const Head = () => (
    <thead>
      <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
        <th className="px-4 py-2.5 text-left font-semibold">Control</th>
        {!grouped && <th className="px-3 py-2.5 text-left font-semibold">Category</th>}
        <th className="px-3 py-2.5 text-left font-semibold">Framework crosswalk</th>
        <th className="px-3 py-2.5 text-left font-semibold">Type</th>
        <th className="px-3 py-2.5 text-right font-semibold">Checks</th>
        <th className="px-3 py-2.5 text-left font-semibold">Status</th>
      </tr>
    </thead>
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-1 py-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Compliance</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Common controls</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            One control set crosswalked to {frameworks.length} frameworks · {libraryName}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatChip label="controls" value={controls.length} />
            <StatChip label="automated" value={automated} tone={automated > 0 ? 'emerald' : 'slate'} />
            <StatChip label="failing" value={failing} tone={failing > 0 ? 'rose' : 'slate'} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/automation/soc2-controls/coverage"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ListChecks className="h-3.5 w-3.5" />
            Coverage
          </Link>
          <Link
            href="/automation/soc2-controls/review"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Review
          </Link>
          <button
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {seed.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code or requirement…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-2 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={selCls}>
          <option value="all">Category: All</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fw} onChange={(e) => setFw(e.target.value)} className={selCls}>
          <option value="all">Framework: All</option>
          {frameworks.map((f) => <option key={f.key} value={f.key}>{f.label}{f.authored ? ' *' : ''}</option>)}
        </select>
        <select value={subType} onChange={(e) => setSubType(e.target.value)} className={selCls}>
          <option value="all">Type: All</option>
          {SUB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
          <option value="all">Status: All</option>
          {STATUS_OPTS.map((s) => <option key={s} value={s}>{CONTROL_STATUS[s].label}</option>)}
        </select>
        <button
          onClick={() => setGrouped((g) => !g)}
          title="Group controls by category"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-sm font-medium ${grouped ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          {grouped ? <Layers className="h-4 w-4" /> : <List className="h-4 w-4" />}
          {grouped ? 'Grouped' : 'Group by category'}
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Showing <span className="tabular-nums">{visible.length}</span> of{' '}
        <span className="tabular-nums">{controls.length}</span> controls
      </p>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Couldn’t load controls — the backend may need a restart.</div>
      ) : grouped ? (
        <div className="space-y-5">
          {byCategory.map(([category, items]) => (
            <div key={category} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <h2 className="text-sm font-bold text-slate-700">{category}</h2>
                <span className="text-[11px] tabular-nums text-slate-400">{items.length} control{items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm"><Head /><tbody>{items.map((c) => <Row key={c.control_id} c={c} />)}</tbody></table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm"><Head /><tbody>{visible.map((c) => <Row key={c.control_id} c={c} />)}</tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}
