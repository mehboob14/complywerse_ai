'use client';

// Automation → Common Controls library. One unified control set (Probo
// mitigations) where each control maps to requirements across SOC 2 / ISO 27001
// / GDPR. Search + facets (category, framework, type, status, ownership), an
// optional group-by-category view, multi-select bulk owner assign, and one
// shared automated-check engine so linked checks + live status show on every
// control. A row opens the control-detail page.

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Search, Layers, List, ListChecks, ShieldCheck, Plus } from 'lucide-react';
import { automationApi, certificationsApi, scfApi } from '@/lib/api';
import {
  SubTypeChip, ControlStatusPill, CONTROL_STATUS, FrameworkBadge, CustomBadge,
  type CommonControl, type FrameworkReq,
} from '@/components/soc2/ui';
import { MultiSelectDropdown, useToast } from '@/components/ui';

const SUB_TYPES = ['Automated', 'Hybrid', 'Manual'];
const STATUS_OPTS = ['passed', 'failed', 'partial', 'expired', 'collection_failed', 'connect_one', 'unbound', 'not_run', 'manual'];
const OWNERSHIP_OPTS = [
  { value: 'all', label: 'Ownership: All' },
  { value: 'unowned', label: 'Unowned' },
  { value: 'mine', label: 'Mine' },
  { value: 'overdue', label: 'Overdue' },
] as const;
type OwnershipFilter = (typeof OWNERSHIP_OPTS)[number]['value'];
type OriginFilter = 'all' | 'custom' | 'scf';

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
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [fw, setFw] = useState('all');
  const [subType, setSubType] = useState('all');
  const [status, setStatus] = useState('all');
  const [ownership, setOwnership] = useState<OwnershipFilter>('all');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [grouped, setGrouped] = useState(false);
  const [scopeMode, setScopeMode] = useState<'in_scope' | 'all'>('in_scope');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOwner, setBulkOwner] = useState<string[]>([]);

  const ownershipParam = ownership === 'all' ? undefined : ownership;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['automation-common', scopeMode, ownershipParam ?? 'all'],
    queryFn: () =>
      automationApi.listCommonControls({
        scope: scopeMode,
        ownership: ownershipParam,
      }).then(
        (r) => r.data as {
          controls: CommonControl[]; categories: string[];
          frameworks: { key: string; label: string; authored: boolean }[]; framework: string;
          scope_status?: string;
          scope?: { framework_slugs?: string[]; applicable_count?: number; total_count?: number };
        },
      ),
  });
  const scopeQ = useQuery({
    queryKey: ['scf-default-scope'],
    queryFn: async () => (await scfApi.getDefaultScope()).data,
    staleTime: 60_000,
  });
  const usersQ = useQuery({
    queryKey: ['tenant-users-ownership'],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data as Array<{
      id: number; display_name?: string; email?: string; username?: string;
    }>,
    staleTime: 5 * 60_000,
  });
  const people = useMemo(
    () => (usersQ.data || []).map((u) => ({
      value: String(u.id),
      label: u.display_name || u.username || u.email || `User ${u.id}`,
      subLabel: u.email || undefined,
    })),
    [usersQ.data],
  );

  const seed = useMutation({
    mutationFn: () => automationApi.seed(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-common'] }),
  });
  const bulkAssign = useMutation({
    mutationFn: async () => {
      const scopeId = scopeQ.data?.id;
      if (!scopeId) throw new Error('No default scope');
      if (!bulkOwner[0]) throw new Error('Pick an owner');
      const domain = selected.length
        ? (controls.find((c) => c.control_id === selected[0])?.category || undefined)
        : undefined;
      return scfApi.bulkOwnership(scopeId, {
        scf_ids: selected,
        domain,
        owner_user_id: Number(bulkOwner[0]),
      });
    },
    onSuccess: () => {
      toast({ type: 'success', title: `Assigned owner to ${selected.length} control${selected.length === 1 ? '' : 's'}` });
      setSelected([]);
      setBulkOwner([]);
      qc.invalidateQueries({ queryKey: ['automation-common'] });
    },
    onError: (e) => toast({
      type: 'error',
      title: 'Bulk assign failed',
      message: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Try again.',
    }),
  });

  const controls = useMemo(() => data?.controls ?? [], [data]);
  const categories = data?.categories ?? [];
  const frameworks = data?.frameworks ?? [];
  const libraryName = data?.framework ?? 'Common controls';
  const scopeStatus = data?.scope_status;
  const scopeMeta = data?.scope;
  const unconfigured = scopeMode === 'in_scope' && scopeStatus === 'unconfigured';
  const automated = controls.filter((c) => c.sub_type === 'Automated').length;
  const failing = controls.filter((c) => c.overall_status === 'failed').length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return controls.filter((c) => {
      const isCustom = !!c.custom;
      return (
        (cat === 'all' || c.category === cat) &&
        (fw === 'all' || (c.frameworks || []).includes(fw)) &&
        (subType === 'all' || c.sub_type === subType) &&
        (status === 'all' || c.overall_status === status) &&
        (origin === 'all' || (origin === 'custom' ? isCustom : !isCustom)) &&
        (!q ||
          c.control_id.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          fwOrder(c.requirements).some((f) => (c.requirements[f] || []).some((r) => r.code.toLowerCase().includes(q))))
      );
    });
  }, [controls, search, cat, fw, subType, status, origin]);

  const byCategory = useMemo(() => {
    const m = new Map<string, CommonControl[]>();
    for (const c of visible) {
      const k = c.category || 'Uncategorized';
      (m.get(k) || m.set(k, []).get(k)!).push(c);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const visibleIds = useMemo(() => visible.map((c) => c.control_id), [visible]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const toggleOne = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) setSelected((prev) => prev.filter((id) => !visibleIds.includes(id)));
    else setSelected((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const selCls = 'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-600 focus:border-primary-500 focus:outline-none';

  const openControl = (code: string) => router.push(`/automation/soc2-controls/${encodeURIComponent(code)}`);

  const Row = ({ c }: { c: CommonControl }) => (
    <tr
      key={c.control_id}
      onClick={() => openControl(c.control_id)}
      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
    >
      <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected.includes(c.control_id)}
          onChange={() => toggleOne(c.control_id)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          aria-label={`Select ${c.control_id}`}
        />
      </td>
      <td className="px-4 py-3">
        <div className="max-w-[300px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-slate-400">{c.control_id}</span>
            {c.custom && <CustomBadge />}
            {c.binding_source === 'soc2_fallback' && (
              <span className="text-[10px] font-medium text-slate-300" title="Status still inherits via SOC 2 criteria">
                via SOC 2
              </span>
            )}
          </div>
          <span className="mt-0.5 block truncate font-medium text-slate-800">{c.title}</span>
          {c.owner_name && <span className="mt-0.5 block truncate text-[11px] text-slate-400">Owner: {c.owner_name}</span>}
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
        <th className="w-10 px-3 py-2.5 text-left">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAllVisible}
            className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            aria-label="Select all visible"
            onClick={(e) => e.stopPropagation()}
          />
        </th>
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
            {scopeMeta?.framework_slugs && scopeMeta.framework_slugs.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                <span className="tabular-nums text-sm font-bold">{scopeMeta.framework_slugs.length}</span>
                frameworks
              </span>
            )}
            {scopeMeta?.applicable_count != null && scopeStatus === 'in_scope' && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700">
                <span className="tabular-nums text-sm font-bold">{scopeMeta.applicable_count}</span>
                applicable
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setScopeMode('in_scope')}
              className={`rounded-md px-2.5 py-1.5 ${scopeMode === 'in_scope' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
            >
              In scope
            </button>
            <button
              type="button"
              onClick={() => setScopeMode('all')}
              className={`rounded-md px-2.5 py-1.5 ${scopeMode === 'all' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
            >
              All controls
            </button>
          </div>
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
          <Link
            href="/automation/soc2-controls/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New control
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
        <select
          value={origin}
          onChange={(e) => setOrigin(e.target.value as OriginFilter)}
          className={selCls}
        >
          <option value="all">Origin: All</option>
          <option value="custom">Custom</option>
          <option value="scf">SCF</option>
        </select>
        <select
          value={ownership}
          onChange={(e) => setOwnership(e.target.value as OwnershipFilter)}
          className={selCls}
        >
          {OWNERSHIP_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50/70 px-3 py-2">
          <span className="text-xs font-semibold text-primary-800">
            {selected.length} selected
          </span>
          <div className="min-w-[180px]">
            <MultiSelectDropdown
              title="Owner"
              items={people}
              selectedValues={bulkOwner}
              onApply={setBulkOwner}
              multiSelect={false}
              autoApply
              forceSearch
              triggerVariant="input"
              size="sm"
              placeholder="Assign owner…"
            />
          </div>
          <button
            type="button"
            disabled={!bulkOwner[0] || bulkAssign.isPending || !scopeQ.data?.id}
            onClick={() => bulkAssign.mutate()}
            className="inline-flex h-8 items-center rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {bulkAssign.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Assign owner'}
          </button>
          <button
            type="button"
            onClick={() => { setSelected([]); setBulkOwner([]); }}
            className="text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Showing <span className="tabular-nums">{visible.length}</span> of{' '}
        <span className="tabular-nums">{controls.length}</span> controls
      </p>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Couldn’t load controls — the backend may need a restart.</div>
      ) : unconfigured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-amber-900">Scope not configured</p>
          <p className="mt-1.5 text-sm text-amber-800/80">
            Select frameworks under Automation → Scope. Until then, the in-scope Common Controls list stays empty.
          </p>
          <Link
            href="/automation/scope"
            className="mt-4 inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700"
          >
            Configure scope
          </Link>
        </div>
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
