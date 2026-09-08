'use client';

// Requirement coverage — every requirement in every framework and what accounts
// for it. A bare "95% mapped" leaves the other 5% unexplained, which is the first
// thing an assessor asks about. Most unmapped requirements are not gaps: they
// bind the regulator, the exchange operator or a supervisory authority, and no
// control the assessed organisation implements can discharge them. Each one
// carries its disposition and the written reason, so the shortfall is auditable.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import { automationApi } from '@/lib/api';

type Disposition = 'mapped' | 'other_party' | 'out_of_scope' | 'pending';

interface Unmapped {
  code: string;
  reference: string;
  title: string | null;
  disposition: Disposition;
  rule: string;
  reason: string | null;
}
interface FrameworkCoverage {
  key: string;
  label: string;
  total: number;
  counts: Record<Disposition, number>;
  mapped_pct: number;
  accounted_pct: number;
  /** Mapped by parent/child rollup rather than on the code itself. A framework
   *  can read 100% mapped while every row is an inference — COBIT does. */
  inferred: number;
  unmapped: Unmapped[];
}
interface Coverage {
  generated: string;
  total: number;
  counts: Record<Disposition, number>;
  labels: Record<Disposition, string>;
  mapped_pct: number;
  accounted_pct: number;
  frameworks: FrameworkCoverage[];
}

// Semantic, not decorative: mapped is the goal, pending is the only real gap,
// and the two middle states are legitimate outcomes that need to read as such.
const TONE: Record<Disposition, { bar: string; dot: string; text: string; chip: string }> = {
  mapped: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  other_party: { bar: 'bg-sky-500', dot: 'bg-sky-500', text: 'text-sky-700', chip: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  out_of_scope: { bar: 'bg-slate-400', dot: 'bg-slate-400', text: 'text-slate-600', chip: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
  pending: { bar: 'bg-amber-500', dot: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
};
const ORDER: Disposition[] = ['mapped', 'other_party', 'out_of_scope', 'pending'];

function StackedBar({ counts, total }: { counts: Record<Disposition, number>; total: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img"
      aria-label={ORDER.map((d) => `${counts[d] || 0} ${d}`).join(', ')}>
      {ORDER.map((d) => {
        const n = counts[d] || 0;
        if (!n) return null;
        return <div key={d} className={TONE[d].bar} style={{ width: `${(n / total) * 100}%` }} />;
      })}
    </div>
  );
}

function DispositionChip({ d, label }: { d: Disposition; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[d].chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE[d].dot}`} />
      {label}
    </span>
  );
}

function FrameworkRow({ fw, labels, query }: { fw: FrameworkCoverage; labels: Record<Disposition, string>; query: string }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fw.unmapped;
    return fw.unmapped.filter(
      (u) => u.code.toLowerCase().includes(q) || (u.title || '').toLowerCase().includes(q) || (u.reason || '').toLowerCase().includes(q),
    );
  }, [fw.unmapped, query]);

  const clean = fw.counts.pending === 0;
  // What share of the mapped requirements were matched on the code itself. A
  // framework mapped entirely by rollup is making a weaker claim than the
  // percentage alone suggests, so it has to read differently.
  const inferredShare = fw.counts.mapped ? fw.inferred / fw.counts.mapped : 0;
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!fw.unmapped.length}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="w-4 shrink-0 text-slate-400">
          {fw.unmapped.length ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
        </span>
        <span className="w-52 shrink-0 truncate text-sm font-semibold text-slate-800">{fw.label}</span>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500">{fw.total}</span>
        <span className="min-w-0 flex-1"><StackedBar counts={fw.counts} total={fw.total} /></span>
        <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800">{fw.mapped_pct}%</span>
        <span className="w-28 shrink-0 text-right">
          {fw.inferred > 0 ? (
            <span
              title={`${fw.inferred} of ${fw.counts.mapped} mapped requirements were matched by parent/child rollup, not on the code itself`}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${
                inferredShare >= 0.5
                  ? 'bg-amber-50 text-amber-800 ring-amber-600/20'
                  : 'bg-slate-100 text-slate-600 ring-slate-500/20'
              }`}
            >
              {Math.round(inferredShare * 100)}% inferred
            </span>
          ) : (
            <span className="text-[11px] text-slate-300">exact</span>
          )}
        </span>
        <span className={`w-24 shrink-0 text-right text-xs font-semibold tabular-nums ${clean ? 'text-emerald-600' : 'text-amber-600'}`}>
          {clean ? 'accounted' : `${fw.counts.pending} pending`}
        </span>
      </button>

      {open && (
        <div className="bg-slate-50/70 px-4 pb-4 pl-11">
          <p className="py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {rows.length} requirement{rows.length === 1 ? '' : 's'} with no control
          </p>
          <ul className="space-y-2">
            {rows.map((u) => (
              <li key={u.code} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{u.reference}</code>
                  <DispositionChip d={u.disposition} label={labels[u.disposition]} />
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{u.rule}</span>
                </div>
                {u.title && <p className="mt-1.5 text-sm font-medium text-slate-800">{u.title}</p>}
                {u.reason && <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{u.reason}</p>}
              </li>
            ))}
            {!rows.length && <li className="py-2 text-sm text-slate-400">No requirements match this search.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function CoveragePage() {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['automation-coverage'],
    queryFn: () => automationApi.getRequirementCoverage().then((r) => r.data as Coverage),
  });

  const frameworks = useMemo(() => {
    const list = data?.frameworks ?? [];
    // Anything still pending first — that is the only real to-do list here.
    return [...list].sort((a, b) => (b.counts.pending - a.counts.pending) || (a.mapped_pct - b.mapped_pct));
  }, [data]);

  if (isLoading) {
    return <div className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading coverage…</div>;
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-[1200px] p-8">
        <p className="text-sm text-slate-600">
          Requirement dispositions have not been built for this release. Run{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">python -m grc.tools.build_scf_dispositions --emit</code>.
        </p>
      </div>
    );
  }

  const pending = data.counts.pending || 0;
  const totalInferred = (data.frameworks ?? []).reduce((n, f) => n + (f.inferred || 0), 0);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-1 py-1">
      <div>
        <Link href="/automation/soc2-controls" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Common controls
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Requirement coverage</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-slate-500">
          Every requirement across {data.frameworks.length} frameworks, and what accounts for it. A requirement with no
          control is not automatically a gap — most bind the regulator or the exchange operator, and no control the
          assessed organisation implements can discharge them.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mapped to a control</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{data.mapped_pct}%</p>
          <p className="mt-0.5 text-xs text-slate-500">{data.counts.mapped.toLocaleString()} of {data.total.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Accounted for</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${pending ? 'text-slate-900' : 'text-emerald-600'}`}>{data.accounted_pct}%</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {pending ? `${pending} still to assess` : 'no requirement unexplained'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{data.labels.other_party}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-sky-700">{data.counts.other_party}</p>
          <p className="mt-0.5 text-xs text-slate-500">regulator, operator or authority</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Matched by rollup</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-700">{totalInferred}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            inferred, not matched on the code · {data.counts.out_of_scope} out of scope
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full min-w-0 sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search unmapped code, title or reason…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-2 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ORDER.map((d) => <DispositionChip key={d} d={d} label={`${data.labels[d]} · ${data.counts[d]}`} />)}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <span className="w-4 shrink-0" />
          <span className="w-52 shrink-0">Framework</span>
          <span className="w-16 shrink-0 text-right">Reqs</span>
          <span className="min-w-0 flex-1">Disposition</span>
          <span className="w-16 shrink-0 text-right">Mapped</span>
          <span className="w-28 shrink-0 text-right">Match</span>
          <span className="w-24 shrink-0 text-right">Status</span>
        </div>
        {frameworks.map((fw) => <FrameworkRow key={fw.key} fw={fw} labels={data.labels} query={search} />)}
      </div>

      <p className="pb-6 text-xs text-slate-400">
        Dispositions generated {new Date(data.generated).toLocaleString()} by{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5">build_scf_dispositions</code>. Each classification records the
        rule that produced it, so any row can be traced to the phrase it was matched on.
      </p>
    </div>
  );
}
