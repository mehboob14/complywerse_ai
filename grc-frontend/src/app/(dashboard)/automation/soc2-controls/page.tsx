'use client';

// Automation → Common controls. One SCF control set seen through the tenant's
// scope: each row names only the frameworks the tenant is assessed against.
// Search (name, code or requirement), compact filter pills, optional grouping by
// category, bulk owner assignment. A row opens the control.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Crosshair, Layers, ListChecks, Loader2, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { automationApi, certificationsApi, scfApi } from '@/lib/api';
import {
  ControlStatusPill, CONTROL_STATUS, CustomBadge, frameworkColor, type CommonControl,
} from '@/components/soc2/ui';
import { MultiSelectDropdown, useToast } from '@/components/ui';
import { ScopeDialog } from '@/components/soc2/ScopeDialog';

const SUB_TYPES = ['Automated', 'Hybrid', 'Manual'];
const STATUS_ORDER = ['failed', 'partial', 'expired', 'collection_failed', 'not_run', 'connect_one', 'unbound', 'passed', 'manual'];
const ORIGIN_ITEMS = [{ value: 'scf', label: 'SCF' }, { value: 'custom', label: 'Custom' }];
const OWNERSHIP_ITEMS = [
  { value: 'mine', label: 'Mine' },
  { value: 'unowned', label: 'Unowned' },
  { value: 'overdue', label: 'Overdue' },
];

interface Framework { key: string; label: string }
interface ListResponse {
  controls: CommonControl[];
  categories: string[];
  frameworks: (Framework & { authored: boolean })[];
  frameworks_total?: number;
  framework: string;
  scope_status?: string;
  scope?: { frameworks?: Framework[]; applicable_count?: number; total_count?: number };
}

const initials = (name: string) =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

// Codes in reading order: 6.3.2 before 11.2.
const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** One chip per in-scope framework: its label and how many of its requirements
 * the control discharges; the codes are on hover. Codes are written out when the
 * reader is looking for them: that framework is filtered, or the search matched. */
function FrameworkCell({ c, labels, focus, query, scoped }: {
  c: CommonControl; labels: Map<string, string>; focus: string[]; query: string; scoped: boolean;
}) {
  const keys = Object.keys(c.requirements || {}).filter((k) => c.requirements[k]?.length);
  if (!keys.length) {
    return <span className="text-[11px] text-slate-400">{scoped ? 'Not in your frameworks' : 'No crosswalk'}</span>;
  }
  const shown = keys.slice(0, 3);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((k) => {
        const codes = c.requirements[k].map((r) => r.code).sort(byCode);
        const hits = query ? codes.filter((x) => x.toLowerCase().includes(query)) : [];
        const inline = hits.length ? hits : focus.includes(k) ? codes : [];
        return (
          <span key={k} title={`${labels.get(k) || k}: ${codes.join(', ')}`}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: frameworkColor(k) }} />
            <span className="whitespace-nowrap">{labels.get(k) || k}</span>
            {inline.length ? (
              <span className="truncate font-normal text-slate-500">
                {inline.slice(0, 3).join(', ')}{inline.length > 3 ? ` +${inline.length - 3}` : ''}
              </span>
            ) : (
              <span className="tabular-nums text-slate-400">{codes.length}</span>
            )}
          </span>
        );
      })}
      {keys.length > shown.length && <span className="text-[11px] text-slate-400">+{keys.length - shown.length}</span>}
    </div>
  );
}

function StatButton({ value, label, tone, active, onClick }: {
  value: number; label: string; tone: 'slate' | 'emerald' | 'rose' | 'amber'; active?: boolean; onClick?: () => void;
}) {
  const color = { slate: 'text-slate-900', emerald: 'text-emerald-700', rose: 'text-rose-700', amber: 'text-amber-700' }[tone];
  const body = (
    <>
      <span className={`tabular-nums text-sm font-bold ${value ? color : 'text-slate-400'}`}>{value.toLocaleString()}</span>
      <span className="text-slate-500">{label}</span>
    </>
  );
  if (!onClick) return <span className="inline-flex items-baseline gap-1.5 px-1 text-xs">{body}</span>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${active ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-slate-100'}`}>
      {body}
    </button>
  );
}

export default function CommonControlsLibraryPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [fws, setFws] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [origin, setOrigin] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<string[]>([]);
  const [grouped, setGrouped] = useState(false);
  const [scopeMode, setScopeMode] = useState<'in_scope' | 'all'>('in_scope');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOwner, setBulkOwner] = useState<string[]>([]);
  // ?configure=scope opens the scope dialog (links from Overview and the old Scope page)
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [scopeOpen, setScopeOpen] = useState(false);
  useEffect(() => {
    // ?source=custom lands here from the Overview's "n authored here".
    const source = searchParams.get('source');
    if (source === 'custom' || source === 'scf') {
      setOrigin([source]);
      router.replace(pathname, { scroll: false });
      return;
    }
    if (searchParams.get('configure') !== 'scope') return;
    setScopeOpen(true);
    router.replace(pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  // The API only filters ownership within scope.
  const ownershipParam = scopeMode === 'in_scope' ? (ownership[0] as 'mine' | 'unowned' | 'overdue' | undefined) : undefined;

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['automation-common', scopeMode, ownershipParam ?? 'all'],
    queryFn: () => automationApi.listCommonControls({ scope: scopeMode, ownership: ownershipParam })
      .then((r) => r.data as ListResponse),
    placeholderData: keepPreviousData,
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

  const controls = useMemo(() => data?.controls ?? [], [data]);
  const frameworks = useMemo(() => data?.frameworks ?? [], [data]);
  const scopeFws = data?.scope?.frameworks ?? [];
  const labels = useMemo(() => new Map(frameworks.map((f) => [f.key, f.label])), [frameworks]);
  const unconfigured = scopeMode === 'in_scope' && data?.scope_status === 'unconfigured';
  const query = search.trim().toLowerCase();

  const bulkAssign = useMutation({
    mutationFn: async () => {
      const scopeId = scopeQ.data?.id;
      if (!scopeId) throw new Error('No default scope');
      if (!bulkOwner[0]) throw new Error('Pick an owner');
      return scfApi.bulkOwnership(scopeId, {
        scf_ids: selected,
        domain: controls.find((c) => c.control_id === selected[0])?.category || undefined,
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

  const visible = useMemo(() => controls.filter((c) => (
    (!cats.length || cats.includes(c.category)) &&
    (!fws.length || fws.some((f) => c.requirements?.[f]?.length)) &&
    (!types.length || types.includes(c.sub_type || '')) &&
    (!statuses.length || statuses.includes(c.overall_status)) &&
    (!origin.length || (origin[0] === 'custom') === !!c.custom) &&
    (!query ||
      c.control_id.toLowerCase().includes(query) ||
      c.title.toLowerCase().includes(query) ||
      Object.values(c.requirements || {}).some((items) => items.some((r) => r.code.toLowerCase().includes(query))))
  )), [controls, cats, fws, types, statuses, origin, query]);

  // Option counts are over the whole list, so a pill says what choosing it yields.
  const items = useMemo(() => {
    const tally = (key: (c: CommonControl) => string[]) => {
      const n = new Map<string, number>();
      for (const c of controls) for (const k of key(c)) n.set(k, (n.get(k) || 0) + 1);
      return n;
    };
    const withCount = (list: { value: string; label: string }[], n: Map<string, number>) =>
      list.map((it) => ({ ...it, label: `${it.label} (${n.get(it.value) || 0})` }));
    const catN = tally((c) => [c.category]);
    const fwN = tally((c) => Object.keys(c.requirements || {}));
    const typeN = tally((c) => [c.sub_type || '']);
    const statusN = tally((c) => [c.overall_status]);
    return {
      category: withCount((data?.categories ?? []).map((k) => ({ value: k, label: k })), catN),
      framework: withCount(frameworks.map((f) => ({ value: f.key, label: f.label })), fwN),
      type: withCount(SUB_TYPES.map((t) => ({ value: t, label: t })), typeN),
      status: withCount(
        STATUS_ORDER.filter((s) => statusN.get(s) || statuses.includes(s)).map((s) => ({ value: s, label: CONTROL_STATUS[s]?.label || s })),
        statusN,
      ),
    };
  }, [controls, data?.categories, frameworks, statuses]);

  const counts = useMemo(() => ({
    automated: controls.filter((c) => c.sub_type === 'Automated').length,
    failing: controls.filter((c) => c.overall_status === 'failed').length,
    unowned: controls.filter((c) => c.ownership_status === 'unowned').length,
  }), [controls]);

  const activeFilters = cats.length + fws.length + types.length + statuses.length + origin.length + ownership.length + (query ? 1 : 0);
  const clearAll = () => {
    setSearch(''); setCats([]); setFws([]); setTypes([]); setStatuses([]); setOrigin([]); setOwnership([]);
  };
  const toggleOnly = (current: string[], value: string, set: (v: string[]) => void) =>
    set(current.length === 1 && current[0] === value ? [] : [value]);

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
  const toggleOne = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAllVisible = () => {
    if (allVisibleSelected) setSelected((prev) => prev.filter((id) => !visibleIds.includes(id)));
    else setSelected((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const href = (code: string) => `/automation/soc2-controls/${encodeURIComponent(code)}`;
  const scoped = scopeFws.length > 0;
  const colCount = grouped ? 7 : 8;

  const renderRow = (c: CommonControl) => {
    const isSel = selected.includes(c.control_id);
    return (
      <tr key={c.control_id} onClick={() => router.push(href(c.control_id))}
        className={`group cursor-pointer border-b border-slate-100 last:border-0 ${isSel ? 'bg-primary-50/40' : 'hover:bg-slate-50'}`}>
        <td className="w-9 py-2 pl-3.5 pr-1" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSel} onChange={() => toggleOne(c.control_id)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            aria-label={`Select ${c.control_id}`} />
        </td>
        <td className="py-2 pr-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="w-[4.75rem] shrink-0 truncate font-mono text-[11px] text-slate-400">{c.control_id}</span>
            <Link href={href(c.control_id)} onClick={(e) => e.stopPropagation()}
              className="min-w-0 truncate text-[13px] font-medium text-slate-800 group-hover:text-primary-700">
              {c.title}
            </Link>
            {c.custom && <CustomBadge />}
          </div>
        </td>
        {!grouped && (
          <td className="max-w-[11rem] py-2 pr-3"><span className="block truncate text-xs text-slate-500" title={c.category}>{c.category || '—'}</span></td>
        )}
        <td className="py-2 pr-3">
          <FrameworkCell c={c} labels={labels} focus={fws} query={query} scoped={scoped} />
        </td>
        <td className="py-2 pr-3">
          {c.owner_name ? (
            <span className="flex min-w-0 items-center gap-1.5" title={c.owner_name}>
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600">{initials(c.owner_name)}</span>
              <span className="max-w-[7rem] truncate text-xs text-slate-600">{c.owner_name}</span>
            </span>
          ) : (
            <span className={`text-xs ${c.ownership_status === 'overdue' ? 'font-medium text-rose-600' : 'text-slate-400'}`}>
              {c.ownership_status === 'overdue' ? 'Overdue' : 'Unassigned'}
            </span>
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-slate-600">{c.sub_type || '—'}</td>
        <td className="py-2 pr-3 text-right text-xs tabular-nums text-slate-600">{c.checks_count || <span className="text-slate-300">0</span>}</td>
        <td className="py-2 pr-3.5"><ControlStatusPill status={c.overall_status} /></td>
      </tr>
    );
  };

  const head = (
    <thead>
      <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <th className="w-9 py-2 pl-3.5 pr-1">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible}
            className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            aria-label="Select all visible" />
        </th>
        <th className="py-2 pr-3">Control</th>
        {!grouped && <th className="py-2 pr-3">Category</th>}
        <th className="py-2 pr-3">{scoped ? 'In-scope frameworks' : 'Frameworks'}</th>
        <th className="py-2 pr-3">Owner</th>
        <th className="py-2 pr-3">Type</th>
        <th className="py-2 pr-3 text-right">Checks</th>
        <th className="py-2 pr-3.5">Status</th>
      </tr>
    </thead>
  );

  const renderTable = (rows: CommonControl[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        {head}
        <tbody>
          {rows.length ? rows.map(renderRow) : (
            <tr>
              <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-slate-500">
                No controls match these filters.{' '}
                <button type="button" onClick={clearAll} className="font-semibold text-primary-700 hover:underline">Clear filters</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const segCls = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;
  const ghostBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50';

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 px-1 py-1">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">Common controls</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
            {scoped ? (
              <>
                <span>Scoped to</span>
                {scopeFws.map((f) => (
                  <span key={f.key} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: frameworkColor(f.key) }} />
                    {f.label}
                  </span>
                ))}
                <span className="text-slate-300">·</span>
              </>
            ) : data?.frameworks_total ? (
              <span>Crosswalked to {data.frameworks_total} frameworks ·</span>
            ) : null}
            <span>{data?.framework ?? 'SCF'}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold" role="tablist" aria-label="Which controls">
            <button type="button" role="tab" aria-selected={scopeMode === 'in_scope'} onClick={() => setScopeMode('in_scope')} className={segCls(scopeMode === 'in_scope')}>
              In scope
              {data?.scope?.applicable_count != null && <span className="tabular-nums font-normal text-slate-400">{data.scope.applicable_count.toLocaleString()}</span>}
            </button>
            <button type="button" role="tab" aria-selected={scopeMode === 'all'} onClick={() => { setScopeMode('all'); setOwnership([]); }} className={segCls(scopeMode === 'all')}>
              All
              {data?.scope?.total_count != null && <span className="tabular-nums font-normal text-slate-400">{data.scope.total_count.toLocaleString()}</span>}
            </button>
          </div>
          <button type="button" onClick={() => setScopeOpen(true)} className={ghostBtn}><Crosshair className="h-3.5 w-3.5" />Configure scope</button>
          <Link href="/automation/soc2-controls/coverage" className={ghostBtn}><ListChecks className="h-3.5 w-3.5" />Coverage</Link>
          <Link href="/automation/soc2-controls/review" className={ghostBtn}><ShieldCheck className="h-3.5 w-3.5" />Review</Link>
          <Link href="/automation/soc2-controls/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700">
            <Plus className="h-3.5 w-3.5" />New control
          </Link>
          <button type="button" onClick={() => seed.mutate()} disabled={seed.isPending} title="Refresh the automated checks catalogue"
            aria-label="Refresh checks" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            {seed.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Quick stats double as one-click filters */}
      {!unconfigured && controls.length > 0 && (
        <div className="-ml-1 flex flex-wrap items-center gap-1">
          <StatButton value={controls.length} label="controls" tone="slate" />
          <span className="text-slate-200">|</span>
          <StatButton value={counts.automated} label="automated" tone="emerald"
            active={types.length === 1 && types[0] === 'Automated'} onClick={() => toggleOnly(types, 'Automated', setTypes)} />
          <StatButton value={counts.failing} label="failing" tone="rose"
            active={statuses.length === 1 && statuses[0] === 'failed'} onClick={() => toggleOnly(statuses, 'failed', setStatuses)} />
          {scopeMode === 'in_scope' && (
            <StatButton value={counts.unowned} label="unowned" tone="amber"
              active={ownership[0] === 'unowned'} onClick={() => toggleOnly(ownership, 'unowned', setOwnership)} />
          )}
          {isFetching && !isLoading && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-slate-400" />}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code or requirement…"
            className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 text-xs text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <MultiSelectDropdown title="Category" items={items.category} selectedValues={cats} onApply={setCats} size="sm" forceSearch />
        {frameworks.length > 1 && (
          <MultiSelectDropdown title="Framework" items={items.framework} selectedValues={fws} onApply={setFws} size="sm" />
        )}
        <MultiSelectDropdown title="Type" items={items.type} selectedValues={types} onApply={setTypes} size="sm" />
        <MultiSelectDropdown title="Status" items={items.status} selectedValues={statuses} onApply={setStatuses} size="sm" />
        <MultiSelectDropdown title="Origin" items={ORIGIN_ITEMS} selectedValues={origin} onApply={setOrigin}
          multiSelect={false} showSelectionInTrigger placeholder="All" size="sm" />
        {scopeMode === 'in_scope' && (
          <MultiSelectDropdown title="Owner" items={OWNERSHIP_ITEMS} selectedValues={ownership} onApply={setOwnership}
            multiSelect={false} showSelectionInTrigger placeholder="Anyone" size="sm" />
        )}
        <button type="button" onClick={() => setGrouped((g) => !g)} aria-pressed={grouped}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${grouped ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}>
          <Layers className="h-3.5 w-3.5" />Group by category
        </button>
        {activeFilters > 0 && (
          <button type="button" onClick={clearAll} className="px-1 text-xs font-medium text-slate-500 hover:text-slate-800">Clear all</button>
        )}
        <span className="ml-auto text-xs tabular-nums text-slate-500">
          {visible.length === controls.length ? `${controls.length.toLocaleString()} controls` : `${visible.length.toLocaleString()} of ${controls.length.toLocaleString()}`}
        </span>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50/70 px-3 py-1.5">
          <span className="text-xs font-semibold text-primary-800">{selected.length} selected</span>
          <div className="min-w-[180px]">
            <MultiSelectDropdown title="Owner" items={people} selectedValues={bulkOwner} onApply={setBulkOwner}
              multiSelect={false} autoApply forceSearch triggerVariant="input" size="sm" placeholder="Assign owner…" />
          </div>
          <button type="button" disabled={!bulkOwner[0] || bulkAssign.isPending || !scopeQ.data?.id} onClick={() => bulkAssign.mutate()}
            className="inline-flex h-8 items-center rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {bulkAssign.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Assign owner'}
          </button>
          <button type="button" onClick={() => { setSelected([]); setBulkOwner([]); }} className="text-xs font-medium text-slate-500 hover:text-slate-700">
            Clear selection
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Couldn’t load controls. The backend may need a restart.</div>
      ) : unconfigured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-amber-900">Choose your frameworks first</p>
          <p className="mt-1.5 text-sm text-amber-800/80">The in-scope list is built from the frameworks you are assessed against.</p>
          <button type="button" onClick={() => setScopeOpen(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-700">
            <Crosshair className="h-3.5 w-3.5" />Configure scope
          </button>
        </div>
      ) : grouped ? (
        <div className="space-y-3">
          {byCategory.map(([category, rows]) => (
            <div key={category} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2">
                <h2 className="text-[13px] font-semibold text-slate-800">{category}</h2>
                <span className="text-[11px] tabular-nums text-slate-400">{rows.length}</span>
              </div>
              {renderTable(rows)}
            </div>
          ))}
          {!byCategory.length && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              No controls match these filters.{' '}
              <button type="button" onClick={clearAll} className="font-semibold text-primary-700 hover:underline">Clear filters</button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {renderTable(visible)}
        </div>
      )}
      <ScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} />
    </div>
  );
}
