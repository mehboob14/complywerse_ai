'use client';

// SOC 2 control detail — faithful to the Verity reference control-detail-page:
// breadcrumb, header (code · status · sub-type · category + Run test), tabbed
// body (Overview / Evidence / Tests / Requirements / History) and a right rail
// (Status facts · Framework mappings · Related controls). Tests + Run test are
// wired live to /automation/soc2 (the GitHub/AWS checks actually execute here).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ChevronDown, ChevronRight, FileText, Loader2, Play, Users,
} from 'lucide-react';
import { apiClient, automationApi, certificationsApi } from '@/lib/api';
import {
  CreateArtifactModal, EditArtifactModal, ViewArtifactModal,
  type CatalogItem, type TenantArtifact, type TenantUser,
} from '@/components/compliance/ArtifactsTab';
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

type Tab = 'overview' | 'evidence' | 'tests' | 'artifacts' | 'requirements' | 'history';

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
  /** Present on deliverables folded in from the framework artifact catalogue.
   *  Those name a document someone owes rather than an ask an auditor makes,
   *  so they carry an owner and the match that attached them. */
  source?: 'catalog';
  owner?: string | null;
  mandatory?: boolean | null;
  match_mode?: 'exact' | 'parent' | 'child';
}
interface Coverage {
  /** covered = at least one connected source proves this; connect_one = it is
   *  automatable but the tenant runs none of the systems that would prove it. */
  state: 'covered' | 'connect_one' | 'unbound' | 'manual';
  satisfied_by: string[];
  provider_count: number;
  options: {
    category: string;
    connected: boolean;
    providers: { provider: string; label: string; checks: number; connected: boolean }[];
  }[];
}
interface TestGroup {
  category: string;
  connected: boolean;
  status: string;
  providers: { provider: string; label: string; connected: boolean; checks: LinkedCheck[] }[];
}
interface ControlArtifact {
  artifact_id: string;
  name: string;
  description: string | null;
  filetype: string | null;
  owner: string | null;
  mandatory: boolean | null;
  stage: string | null;
  artifact_type: string | null;
  required_by: string[];
  match_mode?: 'exact' | 'parent' | 'child';
  has_template: boolean;
}
interface ControlDetail {
  control_id: string;
  description?: string | null;
  control_question?: string | null;
  test_groups?: TestGroup[];
  related?: {
    family: { control_id: string; title: string | null }[];
    by_requirements: { control_id: string; title: string | null; shared: number; score: number }[];
  };
  artifacts?: ControlArtifact[];
  coverage?: Coverage;
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
            {showLadder ? 'Hide' : 'Show'} all {levels.length} maturity levels
          </button>
          {!showLadder && (
            <p className="mt-1 text-[11px] text-slate-500">
              SCF grades every control on a six-step capability maturity model, from Level 0 Not Performed to
              Level 5 Continuously Improving. Level 3 Well Defined is the usual target for a compliance obligation,
              so it is shown above; the other levels describe what the control looks like below and beyond it.
            </p>
          )}
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

/** The sources that can prove this control, and what to connect if none is.
 *
 *  Connectors bound to a control are ALTERNATIVES: 53 of them claim CC6.1
 *  because 53 systems can prove logical access, and nobody runs 53. So the ask
 *  is "connect any one", grouped by category because that is the shape of a
 *  decision a customer can act on. Connect a second and it joins the
 *  conjunction — both then have to pass, because both are in scope.
 */
function CoveragePanel({ cov }: { cov: Coverage }) {
  const [showAll, setShowAll] = useState(false);
  if (cov.state === 'manual') return null;
  // `unbound` has no categories to list: SCF says a machine could assess this
  // control and no check reaches it, so the honest panel names the gap rather
  // than showing an empty list or, worse, nothing at all.
  if (cov.state === 'unbound') {
    return (
      <Panel
        title="Evidence sources"
        action={
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-700">
            no check yet
          </span>
        }
      >
        <p className="text-[13px] leading-relaxed text-slate-600">
          SCF marks at least one of this control&rsquo;s assessment objectives as
          <span className="font-semibold text-slate-800"> Technology</span>, so a machine could assess it.
          No check reaches it today, because checks bind through SOC&nbsp;2 criteria and this control maps
          to none. That is a gap in what we have built, not a property of the control.
        </p>
        <p className="mt-2 text-[12px] text-slate-500">
          It is not Manual. Manual is for controls no collector could ever prove, such as board oversight
          or staff training.
        </p>
      </Panel>
    );
  }
  if (!cov.options.length) return null;
  const shown = showAll ? cov.options : cov.options.slice(0, 4);
  return (
    <Panel
      title="Evidence sources"
      action={
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
          cov.state === 'covered'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
          {cov.state === 'covered' ? `${cov.satisfied_by.length} connected` : 'connect any one'}
        </span>
      }
    >
      <p className="text-[13px] leading-relaxed text-slate-600">
        {cov.state === 'covered' ? (
          <>
            Evidenced by <span className="font-semibold text-slate-800">{cov.satisfied_by.join(', ')}</span>.
            {' '}{cov.provider_count} sources in total can prove this control — connecting another adds
            coverage, and its result then counts too.
          </>
        ) : (
          <>
            No source connected yet. Any <em>one</em> of these {cov.provider_count} proves this control —
            you do not need them all. Pick whichever you already run.
          </>
        )}
      </p>
      <ul className="mt-3 space-y-2">
        {shown.map((o) => (
          <li key={o.category} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{o.category}</span>
              {o.connected && (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">connected</span>
              )}
              <span className="ml-auto text-[10px] text-slate-400">{o.providers.length} sources</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {o.providers.slice(0, 8).map((pr) => (
                <span key={pr.provider}
                  title={`${pr.checks} check${pr.checks === 1 ? '' : 's'} for this control`}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    pr.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {pr.label}
                </span>
              ))}
              {o.providers.length > 8 && (
                <span className="text-[11px] text-slate-400">+{o.providers.length - 8}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {cov.options.length > 4 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-semibold text-primary-700 hover:underline">
          {showAll ? 'Show fewer categories' : `Show ${cov.options.length - 4} more categories`}
        </button>
      )}
      <Link href="/admin/evidence-collectors"
        className="mt-3 inline-block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        Connect a source →
      </Link>
    </Panel>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  scm: 'Source control', identity: 'Identity provider', cloud: 'Cloud',
  observability: 'Observability', security: 'Security tooling', productivity: 'Work management',
  comms: 'Communications', email: 'Email', incident: 'Incident response', hr: 'HR system',
  mdm: 'Device management', itsm: 'IT service management', crm: 'CRM', data: 'Data platform',
  payments: 'Payments', ai: 'AI platform', other: 'Other',
};

/** Automated tests grouped by connector category.
 *
 *  A tenant runs one identity provider. Okta, Entra ID and Google Workspace are
 *  alternatives for the same evidence, so drawing each as its own "Not run" test
 *  implies all three must be checked, which no tenant can satisfy and none should
 *  try to. Each category asks for any one source; only a connected source's
 *  results are shown as results.
 */
function TestGroupsPanel({ groups, onRan }: { groups: TestGroup[]; onRan: () => void }) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  if (!groups.length) {
    return (
      <Panel title="Automated tests">
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
          No automated test reaches this control yet.
        </div>
      </Panel>
    );
  }
  const live = groups.filter((g) => g.connected).length;
  return (
    <Panel
      title="Automated tests"
      action={<span className="text-xs text-slate-500">{live} of {groups.length} categories connected</span>}
    >
      <p className="mb-3 text-[13px] leading-relaxed text-slate-600">
        Each category below can evidence this control. Connect <span className="font-semibold">any one</span> source
        from a category; you do not need them all. Once connected, that source&apos;s results count.
      </p>
      <ul className="space-y-2">
        {groups.map((g) => {
          const connectedProviders = g.providers.filter((p) => p.connected);
          const options = g.providers.filter((p) => !p.connected);
          const open = openCat === g.category;
          return (
            <li key={g.category} className="overflow-hidden rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setOpenCat(open ? null : g.category)}
                aria-expanded={open}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-50"
              >
                <span className="text-sm font-semibold text-slate-800">{CATEGORY_LABEL[g.category] || g.category}</span>
                {g.connected
                  ? <ControlStatusPill status={g.status} />
                  : <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">connect any one</span>}
                <span className="ml-auto truncate text-[11px] text-slate-500">
                  {g.connected
                    ? `via ${connectedProviders.map((p) => p.label).join(', ')}`
                    : options.slice(0, 3).map((p) => p.label).join(' · ') + (options.length > 3 ? ` +${options.length - 3}` : '')}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="border-t border-slate-100 bg-slate-50/40 px-3.5 py-3">
                  {connectedProviders.map((p) => (
                    <div key={p.provider} className="mb-3 last:mb-0">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">{p.label} · connected</p>
                      <ul className="space-y-2">
                        {p.checks.map((chk, i) => <CheckRow key={`${p.provider}-${i}`} chk={chk} onRan={onRan} />)}
                      </ul>
                    </div>
                  ))}
                  {options.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {g.connected ? 'Other sources that could also evidence this' : 'Connect any one of these'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {options.map((p) => (
                          <span key={p.provider} title={`${p.checks.length} check${p.checks.length === 1 ? '' : 's'} for this control`}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700">
                            {p.label}
                          </span>
                        ))}
                      </div>
                      <Link href="/admin/evidence-collectors" className="mt-2 inline-block text-xs font-semibold text-primary-700 hover:underline">
                        Connect a source →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

interface LinkedEvidence {
  evidence_id: number; mapping_id: number; name: string; description: string | null;
  file_name: string | null; file_type: string | null; evidence_type: string | null;
  status: string; uploaded_at: string | null; expiry_date: string | null;
  is_stale: boolean; coverage_type: string;
}

/** Evidence a person attaches: the manual and hybrid half no collector produces. */
function ControlEvidencePanel({ code, mode, collected }: {
  code: string; mode?: string; collected: LinkedCheck[];
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [coverage, setCoverage] = useState<'full' | 'partial' | 'supporting'>('supporting');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const listQ = useQuery({
    queryKey: ['control-evidence', code],
    queryFn: () => automationApi.listControlEvidence(code).then((r) => r.data as { items: LinkedEvidence[] }),
  });
  const items = listQ.data?.items ?? [];
  const acceptsUploads = mode !== 'automated';

  const upload = async () => {
    if (!file) { setMsg({ tone: 'err', text: 'Choose a file first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name.trim() || file.name);
      form.append('source_system', `Control ${code}`);
      const up = await automationApi.uploadEvidenceItem(form);
      const body = up.data as { id?: number; evidence_id?: number };
      const id = body.id ?? body.evidence_id;
      if (!id) throw new Error('Upload returned no evidence id');
      await automationApi.linkControlEvidence(code, id, { coverage_type: coverage });
      setMsg({ tone: 'ok', text: 'Evidence uploaded and attached to this control.' });
      setFile(null); setName('');
      await qc.invalidateQueries({ queryKey: ['control-evidence', code] });
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMsg({ tone: 'err', text: detail || (e as Error)?.message || 'Upload failed.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {acceptsUploads && (
        <Panel title="Upload evidence">
          <p className="mb-3 text-[13px] text-slate-600">
            {mode === 'hybrid'
              ? 'Part of this control is collected automatically. Attach the rest here: a policy, an approval record, an export.'
              : 'No collector can prove this control, so evidence is attached by hand: a policy, a signed approval, a review record.'}
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (defaults to file name)"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none" />
            <select value={coverage} onChange={(e) => setCoverage(e.target.value as 'full' | 'partial' | 'supporting')}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 focus:border-primary-500 focus:outline-none">
              <option value="full">Fully evidences</option>
              <option value="partial">Partially evidences</option>
              <option value="supporting">Supporting</option>
            </select>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={upload} disabled={busy || !file}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Upload and attach
            </button>
            {msg && <span className={`text-xs ${msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</span>}
          </div>
        </Panel>
      )}

      <Panel title="Attached evidence" action={<span className="text-xs text-slate-500">{items.length}</span>}>
        {listQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : items.length ? (
          <ul className="divide-y divide-slate-100">
            {items.map((it) => (
              <li key={it.mapping_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <Link href={`/evidence/${it.evidence_id}`} className="block truncate text-sm font-medium text-slate-800 hover:text-primary-700">{it.name}</Link>
                  <span className="block truncate text-[11px] text-slate-400">
                    {it.file_name || it.evidence_type || 'file'}
                    {it.uploaded_at && ` · ${new Date(it.uploaded_at).toLocaleDateString()}`}
                    {it.expiry_date && ` · expires ${new Date(it.expiry_date).toLocaleDateString()}`}
                  </span>
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-600">{it.coverage_type}</span>
                {it.is_stale && <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">stale</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No evidence attached yet.</p>
        )}
      </Panel>

      {collected.length > 0 && (
        <Panel title="Collected automatically">
          <ul className="divide-y divide-slate-100">
            {collected.map((chk, i) => {
              const st = CONTROL_STATUS[chk.last_run?.status || 'not_run'] || CONTROL_STATUS.not_run;
              return (
                <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-700">{chk.title || chk.plugin_key}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {chk.last_run?.started_at ? new Date(chk.last_run.started_at).toLocaleString() : 'collected'}
                    </span>
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>
                    <span className={`size-1.5 rounded-full ${st.dot}`} />{st.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

interface ControlArtifactRow {
  framework_key: string;
  framework_name: string | null;
  catalog: CatalogItem;
  artifact: TenantArtifact | null;
  required_by: string[];
  match_mode?: 'exact' | 'parent' | 'child' | null;
}

const ARTIFACT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  in_review: { label: 'In review', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  archived: { label: 'Archived', cls: 'bg-slate-50 text-slate-400 border-slate-200' },
};

/** This control's artifacts, with the same lifecycle the Frameworks page has.
 *
 *  View, start a working copy, assign, edit, send for review, approve and
 *  download all go through the Frameworks modals, unchanged. A control's
 *  artifacts span several frameworks, so each row carries its own framework key
 *  rather than the page assuming one.
 */
function ControlArtifactsPanel({ code }: { code: string }) {
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<ControlArtifactRow | null>(null);
  const [creating, setCreating] = useState<ControlArtifactRow | null>(null);
  const [editing, setEditing] = useState<TenantArtifact | null>(null);
  const [filter, setFilter] = useState<'all' | 'started' | 'not_started'>('all');

  const listQ = useQuery({
    queryKey: ['control-artifacts', code],
    queryFn: () => automationApi.listControlArtifacts(code).then((r) => r.data as { items: ControlArtifactRow[] }),
  });
  const usersQ = useQuery({
    queryKey: ['control-artifact-users'],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data,
    staleTime: 5 * 60_000,
  });
  const tenantUsers: TenantUser[] = (usersQ.data || []).map((u: { id: number; display_name?: string; email?: string }) => ({
    id: u.id, label: u.display_name || u.email || String(u.id), email: u.email ?? null,
  }));

  const refresh = () => qc.invalidateQueries({ queryKey: ['control-artifacts', code] });
  const create = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiClient.post('/artifacts', payload)).data,
    onSuccess: () => { setCreating(null); refresh(); },
  });
  const update = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TenantArtifact> }) =>
      (await apiClient.put(`/artifacts/${id}`, data)).data,
    onSuccess: () => { setEditing(null); refresh(); },
  });

  const items = listQ.data?.items ?? [];
  const shown = items.filter((i) =>
    filter === 'all' ? true : filter === 'started' ? !!i.artifact : !i.artifact);
  const started = items.filter((i) => i.artifact).length;
  const approved = items.filter((i) => i.artifact?.status === 'approved').length;

  if (listQ.isLoading) {
    return (
      <Panel title="Artifacts">
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      </Panel>
    );
  }
  if (!items.length) {
    return (
      <Panel title="Artifacts">
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No framework names a specific deliverable for this control.
        </div>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title="Artifacts"
        action={
          <span className="text-xs text-slate-500">
            {started} of {items.length} started · {approved} approved
          </span>
        }
      >
        <p className="mb-3 text-[13px] text-slate-600">
          Documents the linked frameworks expect you to produce and keep. Open one to read it, start a working copy,
          assign it, send it for review, and download it.
        </p>
        <div className="mb-3 flex gap-1.5">
          {([['all', 'All'], ['started', 'Started'], ['not_started', 'Not started']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {l}
            </button>
          ))}
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {shown.map((row) => {
            const c = row.catalog;
            const a = row.artifact;
            const st = a ? (ARTIFACT_STATUS[a.status] || ARTIFACT_STATUS.draft) : null;
            return (
              <li key={`${row.framework_key}-${c.artifact_id}`} className="px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setViewing(row)} className="text-left font-semibold text-slate-800 hover:text-primary-700">
                    {a?.name || c.name}
                  </button>
                  {c.format && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{c.format}</span>}
                  {c.mandatory && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">mandatory</span>}
                  {row.match_mode === 'parent' && (
                    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
                      title="Attached via a section-level reference, a weaker claim">section-level</span>
                  )}
                  {st
                    ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                    : <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400">Not started</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => setViewing(row)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      View
                    </button>
                    {a ? (
                      <button onClick={() => setEditing(a)}
                        className="rounded-md bg-primary-600 px-2 py-1 text-xs font-semibold text-white hover:bg-primary-700">
                        Edit &amp; review
                      </button>
                    ) : (
                      <button onClick={() => setCreating(row)}
                        className="rounded-md bg-primary-600 px-2 py-1 text-xs font-semibold text-white hover:bg-primary-700">
                        Start
                      </button>
                    )}
                  </span>
                </div>
                {c.description && <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{c.description}</p>}
                <p className="mt-1 text-[11px] text-slate-400">
                  {[
                    row.framework_name,
                    a?.assigned_to_name ? `Assigned to ${a.assigned_to_name}` : (c.owner && `Suggested owner: ${c.owner}`),
                    c.has_content ? 'starter document available' : 'no starter document yet',
                    c.artifact_id,
                  ].filter(Boolean).join(' · ')}
                </p>
              </li>
            );
          })}
        </ul>
      </Panel>

      {viewing && (
        <ViewArtifactModal
          item={viewing.catalog}
          frameworkKey={viewing.framework_key}
          onClose={() => setViewing(null)}
          onCreate={viewing.artifact ? undefined : () => { setCreating(viewing); setViewing(null); }}
        />
      )}
      {creating && (
        <CreateArtifactModal
          item={creating.catalog}
          frameworkKey={creating.framework_key}
          frameworkName={creating.framework_name || creating.framework_key}
          tenantUsers={tenantUsers}
          onConfirm={(payload) => create.mutate(payload)}
          onClose={() => setCreating(null)}
          isPending={create.isPending}
        />
      )}
      {editing && (
        <EditArtifactModal
          artifact={editing}
          tenantUsers={tenantUsers}
          onSave={(data) => update.mutate({ id: editing.id, data })}
          onClose={() => setEditing(null)}
          isPending={update.isPending}
        />
      )}
    </>
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
              {ev.consolidated_from
                ? `merged from ${ev.consolidated_from} requests across ${ev.from_frameworks} frameworks`
                : 'deliverables named by the frameworks this control maps to'}
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
                    {a.mandatory && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">mandatory</span>}
                    {/* the framework cited a whole section, not this control — a weaker claim */}
                    {a.match_mode === 'parent' && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700" title="attached via a section-level reference">
                        section-level
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-400" title={a.required_by.join(', ')}>
                      {a.owner ? `${a.owner} · ` : ''}
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
    // Statement, grouped tests, artifacts and attached evidence all come from the
    // detail endpoint, so it is needed on every tab rather than two of them.
    enabled: !!code,
    queryFn: () => automationApi.getCommonControl(code).then((r) => r.data as ControlDetail),
  });
  const reqGroupsFull = detailQ.data?.requirement_groups ?? [];
  // Same key as ControlEvidencePanel, so react-query shares one request between the
  // tab count and the panel; without it an upload left the tab reading 0.
  const attachedQ = useQuery({
    queryKey: ['control-evidence', code],
    enabled: !!code,
    queryFn: () => automationApi.listControlEvidence(code).then((r) => r.data as { items: { mapping_id: number }[] }),
  });
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
    { id: 'evidence', label: 'Evidence', count: evidence.length + (attachedQ.data?.items.length ?? 0) },
    { id: 'tests', label: 'Tests', count: detailQ.data?.test_groups?.length ?? (control.checks?.length || 0) },
    { id: 'artifacts', label: 'Artifacts', count: detailQ.data?.artifacts?.length ?? 0 },
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
                {/* The list endpoint sends description: null for all 1,534 rows so the
                    table stays light; the detail endpoint carries the real text. */}
                {(detailQ.data?.description || control.description) ? (
                  <p className="text-sm leading-relaxed text-slate-700">{detailQ.data?.description || control.description}</p>
                ) : detailQ.isLoading ? (
                  <p className="text-sm text-slate-400">Loading…</p>
                ) : (
                  <p className="text-sm italic text-slate-400">No statement published for this control.</p>
                )}
                {detailQ.data?.control_question && (
                  <p className="mt-3 border-l-2 border-slate-200 pl-3 text-[13px] italic leading-relaxed text-slate-500">
                    {detailQ.data.control_question}
                  </p>
                )}
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
              {detailQ.data?.coverage && <CoveragePanel cov={detailQ.data.coverage} />}
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
            detailQ.isLoading ? (
              <Panel title="Automated tests">
                <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              </Panel>
            ) : (
              <TestGroupsPanel
                groups={detailQ.data?.test_groups ?? []}
                onRan={() => {
                  qc.invalidateQueries({ queryKey: ['automation-common-detail', code] });
                  qc.invalidateQueries({ queryKey: ['automation-common'] });
                }}
              />
            )
          )}

          {tab === 'artifacts' && <ControlArtifactsPanel code={code} />}

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
                    <RequirementGroup key={g.framework} g={g} defaultOpen={false} />
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
            <ControlEvidencePanel
              code={code}
              mode={detailQ.data?.assurance_mode}
              collected={evidence}
            />
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

          {detailQ.data?.related && (detailQ.data.related.family.length > 0 || detailQ.data.related.by_requirements.length > 0) && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-base font-bold text-slate-900">Related controls</h2>
              {detailQ.data.related.family.length > 0 && (
                <div className="mb-4">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Same control family</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detailQ.data.related.family.map((c) => (
                      <Link key={c.control_id} href={`/automation/soc2-controls/${c.control_id}`} title={c.title || c.control_id}>
                        <CodeChip code={c.control_id} className="hover:bg-primary-600 hover:text-white" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {detailQ.data.related.by_requirements.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Shares specific requirements</p>
                  <ul className="space-y-1.5">
                    {detailQ.data.related.by_requirements.map((c) => (
                      <li key={c.control_id}>
                        <Link href={`/automation/soc2-controls/${c.control_id}`} className="group flex items-baseline gap-2">
                          <CodeChip code={c.control_id} className="group-hover:bg-primary-600 group-hover:text-white" />
                          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600 group-hover:text-slate-900">{c.title}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{c.shared}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                    Ranked by how specific the shared requirements are. One shared by two controls counts for far more
                    than one shared by thirty.
                  </p>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
