'use client';

// SOC 2 control detail — faithful to the Verity reference control-detail-page:
// breadcrumb, header (code · status · sub-type · category + Run test), tabbed
// body (Overview / Evidence / Tests / Requirements / History) and a right rail
// (Status facts · Framework mappings · Related controls). Tests + Run test are
// wired live to /automation/soc2 (the GitHub/AWS checks actually execute here).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ChevronDown, ChevronRight, FileText, Loader2, Play, Users,
} from 'lucide-react';
import { automationApi } from '@/lib/api';
import {
  CodeChip, ControlStatusPill, SubTypeChip, CONTROL_STATUS, FrameworkBadge,
  type CommonControl, type LinkedCheck,
} from '@/components/soc2/ui';

// Framework slugs come from the data now (the SCF crosswalk resolves 31 of them),
// ordered by how many requirements each one contributes.
const fwOrder = (reqs?: CommonControl['requirements']): string[] =>
  Object.keys(reqs || {}).filter((k) => (reqs?.[k] || []).length)
    .sort((a, b) => ((reqs?.[b]?.length || 0) - (reqs?.[a]?.length || 0)) || a.localeCompare(b));

const SOURCE_BADGE: Record<string, string> = {
  connector: 'bg-indigo-100 text-indigo-800',
  aws: 'bg-amber-100 text-amber-800',
};
const sevCls = (s: string | null) =>
  /crit|high/.test(s || '') ? 'text-rose-600' : /med/.test(s || '') ? 'text-amber-600' : 'text-slate-400';

type Tab = 'overview' | 'evidence' | 'tests' | 'requirements' | 'history';

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
function Fact({ label, value, muted = false }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-slate-400">{label}</span>
      <span className={`min-w-0 text-right text-sm font-semibold ${muted ? 'text-slate-300' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

function CheckRow({ chk, onRan }: { chk: LinkedCheck; onRan: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; msg?: string } | null>(null);
  const run = async () => {
    if (!chk.id) return;
    setBusy(true);
    try {
      const r = await automationApi.runCheck(chk.id);
      const run = (r.data as { run?: { status?: string } })?.run;
      setResult({ status: run?.status || 'done' });
      onRan();
    } catch (e: unknown) {
      setResult({ status: 'error', msg: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed' });
    } finally {
      setBusy(false);
    }
  };
  const status = result?.status || chk.last_run?.status || 'not_run';
  const st = CONTROL_STATUS[status] || CONTROL_STATUS.not_run;
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-slate-700">{chk.title || chk.plugin_key}</span>
          {chk.source && <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${SOURCE_BADGE[chk.source] || 'bg-slate-100 text-slate-600'}`}>{chk.source}</span>}
          {chk.severity && <span className={`text-[10px] font-semibold uppercase ${sevCls(chk.severity)}`}>{chk.severity}</span>}
        </div>
        {result?.msg && <p className="mt-1 text-[11px] text-rose-600">{result.msg}</p>}
        {chk.last_run?.result_summary && !result?.msg && <p className="mt-1 truncate text-[11px] text-slate-400">{chk.last_run.result_summary}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${st.cls}`}><span className={`size-1.5 rounded-full ${st.dot}`} />{st.label}</span>
        {chk.id && (
          <button onClick={run} disabled={busy} title="Run this test" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-primary-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          </button>
        )}
      </div>
    </li>
  );
}


interface ReqItem {
  code: string;
  reference: string;
  title: string | null;
  text: string | null;
  domain: string | null;
  resolved: boolean;
  /** How the code was matched. `exact` is code identity; `parent`/`child` are
   *  inferences across a granularity difference. */
  match_mode: string;
  confidence: number | null;
}
interface ReqGroup {
  framework: string;
  label: string;
  version: string | null;
  provenance: string;
  confidence: number | null;
  pivot_via: string | null;
  count: number;
  unresolved: number;
  match_modes: string[];
  inferred_count: number;
  items: ReqItem[];
}
interface EvidenceItem {
  source: string;
  ref: string | null;
  name: string | null;
  description: string | null;
  area: string | null;
  filetype: string | null;
}
interface ConsolidatedArtifact {
  name: string;
  description: string | null;
  collection_method: 'automated' | 'manual' | 'hybrid';
  required_by: string[];
  source_count: number;
  filetype: string | null;
}
interface ControlDetail {
  control_id: string;
  assurance_mode?: 'automated' | 'manual' | 'hybrid';
  implementation?: {
    target_maturity: string | null;
    maturity_levels: Record<string, string>;
    solutions: Record<string, string>;
    conformity_cadence: string | null;
    pptdf: string | null;
  };
  evidence?: {
    automated: { check_id: string; connector: string; title: string | null }[];
    manual: EvidenceItem[];
    automated_count: number;
    manual_count: number;
    from_frameworks: number;
    consolidated?: ConsolidatedArtifact[] | null;
    consolidated_from?: number | null;
  };
  requirement_groups: ReqGroup[];
  requirement_count: number;
  framework_count: number;
  release: string;
}

/** How a mapping was established — the traceability claim, stated on every group. */
function ProvenanceChip({ g }: { g: ReqGroup }) {
  if (g.provenance === 'ai') {
    const pct = g.confidence != null ? Math.round(g.confidence * 100) : null;
    return (
      <span
        title={`Authored by us${g.pivot_via ? ` via ${g.pivot_via.replace(/_/g, ' ')}` : ''}. Not an SCF-published mapping.`}
        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
      >
        Authored mapping{pct != null ? ` · ${pct}%` : ''}
      </span>
    );
  }
  return (
    <span
      title="Resolved from the SCF crosswalk published with SCF 2026.2."
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
    >
      SCF crosswalk
    </span>
  );
}

/** A match made across a granularity difference rather than on the code itself.
 *  Sound for navigation, not defensible in assurance until a reviewer confirms it. */
function MatchModeChip({ mode }: { mode: string }) {
  if (!mode || mode === 'exact') return null;
  const why =
    mode === 'parent'
      ? 'Our code is broader than the source’s, so it inherits every mapping on the source’s sub-codes. Over-attributes.'
      : 'Our code is narrower than the source’s, so it inherits its parent’s controls. Some may address sibling sub-requirements.';
  return (
    <span
      title={`Matched by ${mode} rollup, not on the code itself. ${why}`}
      className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700"
    >
      {mode} match
    </span>
  );
}

/** One framework's requirements. Collapsible because a control can discharge
 *  obligations in 20+ frameworks and an always-open list is unreadable. */
function RequirementGroup({ g, defaultOpen }: { g: ReqGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <FrameworkBadge fw={g.framework} label={g.label} />
        <span className="font-semibold text-slate-800">{g.label}</span>
        {g.version && <span className="text-[11px] text-slate-400">{g.version}</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
          {g.count}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {g.unresolved > 0 && (
            <span title={`${g.unresolved} identifier(s) had no matching text in the library`}
              className="text-[10px] font-medium text-slate-400">{g.unresolved} without text</span>
          )}
          {g.inferred_count > 0 && (
            <span title={`${g.inferred_count} of ${g.count} matched by parent/child rollup, not on the code itself`}
              className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {g.inferred_count === g.count ? 'all inferred' : `${g.inferred_count} inferred`}
            </span>
          )}
          <ProvenanceChip g={g} />
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {(showAll ? g.items : g.items.slice(0, 10)).map((it) => (
            <li key={it.code} className="grid grid-cols-[104px_1fr] gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <CodeChip code={it.code} />
                {it.reference && it.reference !== it.code && (
                  <p className="mt-1 font-mono text-[10px] text-slate-400" title="The framework's own reference">
                    {it.reference}
                  </p>
                )}
                <div className="mt-1"><MatchModeChip mode={it.match_mode} /></div>
              </div>
              <div className="min-w-0">
                {it.title && <p className="font-semibold text-slate-800">{it.title}</p>}
                {it.text ? (
                  <p className="mt-1 max-w-[68ch] text-[13px] leading-relaxed text-slate-600">{it.text}</p>
                ) : (
                  <p className="mt-1 text-[13px] italic text-slate-400">
                    No requirement text for this identifier in the {g.label} library.
                  </p>
                )}
                {it.domain && (
                  <p className="mt-1.5 text-[11px] text-slate-400">{it.domain}</p>
                )}
              </div>
            </li>
          ))}
          {!showAll && g.items.length > 10 && (
            <li className="px-4 py-2.5">
              <button type="button" onClick={() => setShowAll(true)}
                className="text-xs font-semibold text-primary-700 hover:underline">
                Show {g.items.length - 10} more
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}


/** Implementation guidance, rendered verbatim from the catalog. */
function ImplementationPanel({ impl }: { impl: NonNullable<ControlDetail['implementation']> }) {
  const [showLadder, setShowLadder] = useState(false);
  const [size, setSize] = useState<string>('medium');
  const sizes = Object.keys(impl.solutions || {});
  const levels = Object.entries(impl.maturity_levels || {});
  return (
    <Panel title="How to implement this" action={<span className="text-xs text-slate-400">Target: SCR-CMM Level 3 · Well Defined</span>}>
      {impl.target_maturity ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{impl.target_maturity}</p>
      ) : (
        <p className="text-sm italic text-slate-400">No maturity guidance published for this control.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        {impl.pptdf && <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">{impl.pptdf}</span>}
        {impl.conformity_cadence && (
          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium">Reassess: {impl.conformity_cadence}</span>
        )}
      </div>

      {levels.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowLadder((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:underline">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showLadder ? 'rotate-180' : ''}`} />
            {showLadder ? 'Hide' : 'Show'} the full maturity ladder ({levels.length} levels)
          </button>
          {showLadder && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {levels.map(([name, text]) => (
                <li key={name} className="px-3.5 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{name}</p>
                  <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sizes.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Options for</span>
            {sizes.map((k) => (
              <button key={k} type="button" onClick={() => setSize(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize transition-colors ${
                  size === k ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {k}
              </button>
            ))}
          </div>
          <p className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-[13px] leading-relaxed text-slate-600">
            {impl.solutions[size] || 'No options published for this organisation size.'}
          </p>
        </div>
      )}
      <p className="mt-3 text-[10px] text-slate-400">
        Guidance reproduced verbatim from the Secure Controls Framework 2026.2.
      </p>
    </Panel>
  );
}

/** What to collect to evidence this control, by how it is obtained. */
function EvidencePanel({ ev, mode }: { ev: NonNullable<ControlDetail['evidence']>; mode?: string }) {
  const [showAll, setShowAll] = useState(false);
  const scfFirst = [...ev.manual].sort((a, b) =>
    Number(b.source === 'SCF evidence request list') - Number(a.source === 'SCF evidence request list'));
  const shown = showAll ? scfFirst : scfFirst.slice(0, 10);
  const tone = mode === 'automated' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : mode === 'hybrid' ? 'border-sky-200 bg-sky-50 text-sky-700'
      : 'border-slate-200 bg-slate-50 text-slate-600';
  return (
    <Panel title="Recommended evidence"
      action={<span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{mode || 'manual'}</span>}>
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Automated · {ev.automated_count}
        </h3>
        {ev.automated.length ? (
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {ev.automated.map((a) => (
              <li key={a.check_id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{a.connector}</span>
                <span className="text-[13px] text-slate-600">{a.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13px] text-slate-400">No collector asserts this control — evidence is produced by hand.</p>
        )}
      </section>

      {ev.consolidated && ev.consolidated.length > 0 ? (
        <section className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            What to collect · {ev.consolidated.length}
            <span className="ml-1.5 font-normal normal-case text-slate-400">
              merged from {ev.consolidated_from} requests across {ev.from_frameworks} frameworks
            </span>
          </h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {ev.consolidated.map((a) => {
              const tone = a.collection_method === 'automated' ? 'bg-emerald-50 text-emerald-700'
                : a.collection_method === 'hybrid' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600';
              return (
                <li key={a.name} className="px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{a.collection_method}</span>
                    <span className="font-semibold text-slate-800">{a.name}</span>
                    {a.filetype && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{a.filetype}</span>}
                    <span className="ml-auto text-[10px] text-slate-400" title={a.required_by.join(', ')}>
                      required by {a.required_by.length} framework{a.required_by.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {a.description && <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{a.description}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
      <section className="mt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Manual · {ev.manual_count}
          {ev.from_frameworks > 0 && (
            <span className="ml-1.5 font-normal normal-case text-slate-400">
              merged from {ev.from_frameworks} framework{ev.from_frameworks === 1 ? '' : 's'}
            </span>
          )}
        </h3>
        {shown.length ? (
          <>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {shown.map((m, i) => (
                <li key={`${m.ref}-${i}`} className="px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{m.name}</span>
                    {m.filetype && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{m.filetype}</span>}
                    <span className="ml-auto text-[10px] text-slate-400">{m.source}{m.ref ? ` · ${m.ref}` : ''}</span>
                  </div>
                  {m.description && <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{m.description}</p>}
                </li>
              ))}
            </ul>
            {!showAll && scfFirst.length > shown.length && (
              <button type="button" onClick={() => setShowAll(true)}
                className="mt-2 text-xs font-semibold text-primary-700 hover:underline">
                Show {scfFirst.length - shown.length} more
              </button>
            )}
            {ev.manual_count > 25 && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                These are every artifact the linked frameworks ask for, de-duplicated by name only.
                Many are the same document described in different words — consolidating them into one
                request per artifact is not done yet.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1.5 text-[13px] text-slate-400">No manual evidence is defined for this control.</p>
        )}
      </section>
      )}
    </Panel>
  );
}

export default function ControlDetailPage() {
  const params = useParams();
  const backHref = '/automation/soc2-controls';
  const code = decodeURIComponent(String(params.code || ''));
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [runningAll, setRunningAll] = useState(false);

  const controlsQ = useQuery({
    queryKey: ['automation-common'],
    queryFn: () => automationApi.listCommonControls().then((r) => r.data as { controls: CommonControl[] }),
  });

  const controls = controlsQ.data?.controls ?? [];

  // Requirement text lives in the framework libraries, not the crosswalk, so the
  // detail endpoint resolves it server-side. Fetched only when the tab is opened.
  const detailQ = useQuery({
    queryKey: ['automation-common-detail', code],
    enabled: (tab === 'requirements' || tab === 'overview') && !!code,
    queryFn: () => automationApi.getCommonControl(code).then((r) => r.data as ControlDetail),
  });
  const reqGroupsFull = detailQ.data?.requirement_groups ?? [];
  const control = controls.find((c) => c.control_id === code);

  const allReqCodes = (c?: CommonControl) =>
    c ? fwOrder(c.requirements).flatMap((f) => (c.requirements[f] || []).map((r) => `${f}:${r.code}`)) : [];

  // Requirement mappings grouped by framework (only frameworks with mappings).
  const reqGroups = useMemo(
    () => (control ? fwOrder(control.requirements)
      .map((f) => ({ fw: f, items: control.requirements[f] || [] })) : []),
    [control],
  );
  const totalReqs = reqGroups.reduce((n, g) => n + g.items.length, 0);

  const related = useMemo(() => {
    if (!control) return [];
    const mine = new Set(allReqCodes(control));
    return controls
      .filter((c) => c.control_id !== control.control_id && allReqCodes(c).some((k) => mine.has(k)))
      .slice(0, 12);
  }, [control, controls]);

  const runTest = async () => {
    const ids = (control?.checks || []).map((c) => c.id).filter(Boolean) as number[];
    if (!ids.length) return;
    setRunningAll(true);
    for (const id of ids) {
      try { await automationApi.runCheck(id); } catch { /* surfaced per-row */ }
    }
    await qc.invalidateQueries({ queryKey: ['automation-common'] });
    setRunningAll(false);
  };

  if (controlsQ.isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!control) {
    return (
      <div className="mx-auto max-w-[1200px] py-10 text-center">
        <p className="text-sm text-slate-500">Control <span className="font-mono">{code}</span> not found.</p>
        <Link href={backHref} className="mt-2 inline-block text-sm font-semibold text-primary-700">← Back to controls</Link>
      </div>
    );
  }

  const lastTested = (control.checks || [])
    .map((c) => c.last_run?.started_at)
    .filter(Boolean)
    .sort()
    .pop();
  const evidence = (control.checks || []).filter((c) => c.last_run);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'evidence', label: 'Evidence', count: evidence.length },
    { id: 'tests', label: 'Tests', count: control.checks?.length || 0 },
    { id: 'requirements', label: 'Requirements', count: totalReqs },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-1 py-1">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href={backHref} className="text-slate-400 hover:text-slate-700">Controls</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="font-semibold text-slate-700">{control.control_id}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <CodeChip code={control.control_id} />
            <ControlStatusPill status={control.overall_status} />
            {control.importance && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">{control.importance}</span>}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{control.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500">
            {control.sub_type && (
              <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-slate-400" />{control.sub_type}</span>
            )}
            <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-slate-400" />Unassigned</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{control.category}</span>
          </div>
        </div>
        <button
          onClick={runTest}
          disabled={runningAll || !(control.checks?.length)}
          title={control.checks?.length ? 'Run all automated tests for this control' : 'This control is evidenced manually — no automated test'}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          Run test
        </button>
      </div>

      <nav aria-label="Sections" className="mb-5 mt-5 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative -mb-px flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {t.label}
              {t.count !== undefined && <span className="tabular-nums text-xs text-slate-400">{t.count}</span>}
              {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary-600" />}
            </button>
          );
        })}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          {tab === 'overview' && (
            <>
              <Panel title="Control statement">
                <p className="text-sm leading-relaxed text-slate-600">{control.description}</p>
                {control.guidance && (
                  <>
                    <h3 className="mb-2 mt-5 text-sm font-bold text-slate-900">Implementation guidance</h3>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{control.guidance}</p>
                  </>
                )}
              </Panel>
              {detailQ.data?.implementation && (
                <ImplementationPanel impl={detailQ.data.implementation} />
              )}
              {detailQ.data?.evidence && (
                <EvidencePanel ev={detailQ.data.evidence} mode={detailQ.data.assurance_mode} />
              )}
              <Panel title="Automated tests">
                {control.checks?.length ? (
                  <ul className="space-y-2">
                    {control.checks.map((chk, i) => <CheckRow key={i} chk={chk} onRan={() => qc.invalidateQueries({ queryKey: ['automation-library'] })} />)}
                  </ul>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <p className="text-sm text-slate-600">No collector asserts this control yet. Its status is <span className="font-semibold">not assessed</span> — not satisfied. Connect a collector on the Connections page, or record the manual evidence listed above.</p>
                  </div>
                )}
              </Panel>
            </>
          )}

          {tab === 'tests' && (
            <Panel title="Automated tests">
              {control.checks?.length ? (
                <ul className="space-y-2">
                  {control.checks.map((chk, i) => <CheckRow key={i} chk={chk} onRan={() => qc.invalidateQueries({ queryKey: ['automation-library'] })} />)}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
                  No automated tests. Continuous tests run against connected systems — connect a collector to cover this control’s criteria.
                </div>
              )}
            </Panel>
          )}

          {tab === 'requirements' && (
            <Panel title="Linked requirements" action={<span className="text-xs text-slate-400">Every framework obligation this control discharges</span>}>
              {detailQ.isLoading ? (
                <div className="flex h-32 items-center justify-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : detailQ.isError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">
                  Couldn&apos;t load requirement text.
                </div>
              ) : reqGroupsFull.length ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-700">{detailQ.data?.requirement_count}</span> requirements across{' '}
                    <span className="font-semibold tabular-nums text-slate-700">{detailQ.data?.framework_count}</span> frameworks
                    <span className="text-slate-400"> · crosswalked via SCF {detailQ.data?.release}</span>
                  </p>
                  {(detailQ.data?.framework_count ?? 0) > 10 && (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                      This control appears in <span className="font-semibold text-slate-700">{detailQ.data?.framework_count}</span> frameworks
                      because many of them restate the same underlying obligation. A high count is crosswalk breadth,
                      not extra assurance — authored mappings below are our own and capped at 8 per framework.
                    </p>
                  )}
                  {reqGroupsFull.map((g, i) => (
                    <RequirementGroup key={g.framework} g={g} defaultOpen={i < 2} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  This control is in the catalog but no framework you have selected requires it.
                </div>
              )}
            </Panel>
          )}

          {tab === 'evidence' && (
            <Panel title="Evidence">
              {evidence.length ? (
                <ul className="divide-y divide-slate-100">
                  {evidence.map((chk, i) => {
                    const st = CONTROL_STATUS[chk.last_run?.status || 'not_run'] || CONTROL_STATUS.not_run;
                    return (
                      <li key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-700">{chk.title || chk.plugin_key}</span>
                          <span className="block truncate text-[11px] text-slate-400">{chk.last_run?.started_at ? new Date(chk.last_run.started_at).toLocaleString() : 'collected'}</span>
                        </span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${st.cls}`}><span className={`size-1.5 rounded-full ${st.dot}`} />{st.label}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  No evidence collected yet. Run this control’s tests, or attach evidence from the collectors.
                </div>
              )}
            </Panel>
          )}

          {tab === 'history' && (
            <Panel title="History">
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Change history is written to the audit trail as controls and evidence are edited.
              </div>
            </Panel>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-base font-bold text-slate-900">Status</h2>
            <Fact label="Implementation" value={<ControlStatusPill status={control.overall_status} inline />} />
            <Fact label="Owner" value="Unassigned" muted />
            <Fact label="Sub-type" value={control.sub_type || '—'} />
            <Fact label="Source" value="Template" />
            <Fact label="Checks" value={`${control.checks_count} linked`} />
            <Fact label="Last tested" value={lastTested ? new Date(lastTested).toLocaleDateString() : 'Not tested'} muted={!lastTested} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-base font-bold text-slate-900">Framework mappings</h2>
            {reqGroups.length ? (
              <div className="space-y-3">
                {reqGroups.map((g) => (
                  <div key={g.fw}>
                    <FrameworkBadge fw={g.fw} />
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {g.items.map((r) => (
                        <span key={r.code} title={r.text || r.name} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{r.code}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-amber-600">Not mapped to any framework requirement</p>
            )}
          </section>

          {related.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-1 text-base font-bold text-slate-900">Related controls</h2>
              <p className="mb-3 text-[11px] text-slate-400">Also satisfying a criterion this control covers.</p>
              <div className="flex flex-wrap gap-1.5">
                {related.map((c) => (
                  <Link key={c.control_id} href={`/automation/soc2-controls/${c.control_id}`} title={c.title}>
                    <CodeChip code={c.control_id} className="hover:bg-primary-600 hover:text-white" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
