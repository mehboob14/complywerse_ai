'use client';

// SOC 2 control detail — faithful to the Verity reference control-detail-page:
// breadcrumb, header (code · status · sub-type · category + Run test), tabbed
// body (Overview / Evidence / Tests / Requirements / History) and a right rail
// (Status facts · Framework mappings · Related controls). Tests + Run test are
// wired live to /automation/soc2 (the GitHub/AWS checks actually execute here).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronRight, FileText, HardDrive, Loader2, Play, X,
} from 'lucide-react';
import {
  apiClient, artifactsApi, assetsApi, automationApi, certificationsApi, risksApi, scfApi,
  type ScfHistoryEntry,
} from '@/lib/api';
import {
  ArtifactDownload, CreateArtifactModal, EditArtifactModal, ViewArtifactModal,
  type CatalogItem, type TenantArtifact, type TenantUser,
} from '@/components/compliance/ArtifactsTab';
import {
  CodeChip, ControlStatusPill, SubTypeChip, CONTROL_STATUS, FrameworkBadge, CustomBadge,
  type BindingSource, type CommonControl, type LinkedCheck,
} from '@/components/soc2/ui';
import { CustomControlForm, type CustomControlFormValues } from '@/components/soc2/CustomControlForm';
import { AnimatedModal, MultiSelectDropdown, useToast } from '@/components/ui';
import InlineLinkPicker from '@/components/ui/InlineLinkPicker';
import type { ITAsset, Risk } from '@/types';

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

type Tab = 'overview' | 'evidence' | 'tests' | 'artifacts' | 'risks' | 'assets' | 'requirements' | 'history';

const EMPTY_CHECK_IDS: string[] = [];

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

function CheckRow({
  chk,
  connectionId,
  onRan,
}: {
  chk: LinkedCheck;
  connectionId?: number | null;
  onRan: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; msg?: string } | null>(null);
  const run = async () => {
    if (!chk.id) return;
    setBusy(true);
    try {
      // AWS checks need a connection; connectors ignore it (API accepts null).
      const r = await automationApi.runCheck(chk.id, connectionId ?? undefined);
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
  const covers = chk.covers?.filter(Boolean) ?? [];
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-slate-700">{chk.title || chk.plugin_key}</span>
          {chk.source && <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${SOURCE_BADGE[chk.source] || 'bg-slate-100 text-slate-600'}`}>{chk.source}</span>}
          {chk.severity && <span className={`text-[10px] font-semibold uppercase ${sevCls(chk.severity)}`}>{chk.severity}</span>}
        </div>
        {covers.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {covers.map((id) => (
              <span
                key={id}
                title={`Covers ${id}`}
                className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-teal-800"
              >
                {id}
              </span>
            ))}
          </div>
        )}
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

function BindingSourceCaption({ source }: { source?: BindingSource | null }) {
  if (source === 'soc2_fallback') {
    return (
      <p className="text-[11px] leading-snug text-amber-700/90">
        Status still inherits via SOC 2 criteria — SCF covers bindings pending review.
      </p>
    );
  }
  if (source === 'covers') {
    return (
      <p className="text-[11px] leading-snug text-slate-500">
        Status from SCF-bound checks.
      </p>
    );
  }
  return null;
}

/** Stage G — attach connector check ids so a custom control can take status from results. */
function AttachedChecksPanel({
  code,
  initialIds,
  onSaved,
}: {
  code: string;
  initialIds: string[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [ids, setIds] = useState<string[]>(initialIds);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setIds(initialIds);
  }, [initialIds]);

  const addOne = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    setIds((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setDraft('');
  };

  const save = useMutation({
    mutationFn: () => {
      const pending = draft.trim();
      const check_ids = pending && !ids.includes(pending) ? [...ids, pending] : ids;
      return scfApi.setCustomControlChecks(code, { check_ids });
    },
    onSuccess: async () => {
      setDraft('');
      toast({ type: 'success', title: 'Attached checks saved' });
      onSaved();
    },
    onError: (e) => toast({
      type: 'error',
      title: 'Could not save checks',
      message: errDetail(e),
    }),
  });

  return (
    <Panel title="Attached checks" action={<span className="text-xs text-slate-400">Connector check ids</span>}>
      <p className="mb-2 text-[12px] leading-relaxed text-slate-500">
        Attach connector check ids; status then comes from those checks&apos; results.
      </p>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-primary-500">
        {ids.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700"
          >
            {id}
            <button
              type="button"
              onClick={() => setIds((prev) => prev.filter((x) => x !== id))}
              className="text-slate-400 hover:text-slate-700"
              aria-label={`Remove ${id}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addOne(draft.replace(/,/g, ''));
            } else if (e.key === 'Backspace' && !draft && ids.length) {
              setIds((prev) => prev.slice(0, -1));
            }
          }}
          onBlur={() => { if (draft.trim()) addOne(draft); }}
          placeholder={ids.length ? '' : 'e.g. okta.org_mfa_enforced'}
          className="min-w-[10rem] flex-1 border-0 bg-transparent py-1 font-mono text-sm text-slate-700 outline-none"
        />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="inline-flex items-center rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save checks'}
        </button>
      </div>
    </Panel>
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
  custom?: boolean;
  implements_scf_ids?: string[];
  bound_check_ids?: string[];
  binding_source?: BindingSource;
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
  owner_user_id?: number | null;
  owner_name?: string | null;
  reviewer_user_id?: number | null;
  reviewer_name?: string | null;
  assigned_user_ids?: number[] | null;
  next_due_at?: string | null;
  ownership_status?: string | null;
  /** Stage H — SCFControlState fields when default scope has a row. */
  designation?: string | null;
  inheritance_type?: string | null;
  exception_id?: number | null;
  alternative_scf_id?: string | null;
  provider_vendor_id?: number | null;
}

type TenantUserRow = { id: number; display_name?: string; email?: string; username?: string };

function userLabel(u: TenantUserRow) {
  return u.display_name || u.username || u.email || `User ${u.id}`;
}

function errDetail(e: unknown, fallback = 'Request failed') {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

function OwnershipEditors({
  code,
  ownerId,
  reviewerId,
  assignedIds,
  nextDueAt,
  onSaved,
}: {
  code: string;
  ownerId?: number | null;
  reviewerId?: number | null;
  assignedIds?: number[] | null;
  nextDueAt?: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [owner, setOwner] = useState<string[]>(ownerId != null ? [String(ownerId)] : []);
  const [reviewer, setReviewer] = useState<string[]>(reviewerId != null ? [String(reviewerId)] : []);
  const [assignees, setAssignees] = useState<string[]>((assignedIds || []).map(String));

  useEffect(() => {
    setOwner(ownerId != null ? [String(ownerId)] : []);
    setReviewer(reviewerId != null ? [String(reviewerId)] : []);
    setAssignees((assignedIds || []).map(String));
  }, [ownerId, reviewerId, assignedIds]);

  const scopeQ = useQuery({
    queryKey: ['scf-default-scope'],
    queryFn: async () => (await scfApi.getDefaultScope()).data,
    staleTime: 60_000,
  });
  const usersQ = useQuery({
    queryKey: ['tenant-users-ownership'],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data as TenantUserRow[],
    staleTime: 5 * 60_000,
  });
  const people = useMemo(
    () => (usersQ.data || []).map((u) => ({
      value: String(u.id),
      label: userLabel(u),
      subLabel: u.email || undefined,
    })),
    [usersQ.data],
  );

  const save = useMutation({
    mutationFn: async () => {
      const scopeId = scopeQ.data?.id;
      if (!scopeId) throw new Error('No default scope');
      return scfApi.setOwnership(scopeId, code, {
        owner_user_id: owner[0] ? Number(owner[0]) : null,
        reviewer_user_id: reviewer[0] ? Number(reviewer[0]) : null,
        assigned_user_ids: assignees.map(Number),
      });
    },
    onSuccess: () => {
      toast({ type: 'success', title: 'Ownership saved' });
      onSaved();
    },
    onError: (e) => toast({ type: 'error', title: 'Could not save ownership', message: errDetail(e) }),
  });

  const dueLabel = nextDueAt
    ? new Date(nextDueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const dueOverdue = nextDueAt ? new Date(nextDueAt).getTime() < Date.now() : false;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Owner</p>
          <MultiSelectDropdown
            title="Owner"
            items={people}
            selectedValues={owner}
            onApply={setOwner}
            multiSelect={false}
            autoApply
            forceSearch
            triggerVariant="input"
            size="sm"
            placeholder="Unassigned"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reviewer</p>
          <MultiSelectDropdown
            title="Reviewer"
            items={people}
            selectedValues={reviewer}
            onApply={setReviewer}
            multiSelect={false}
            autoApply
            forceSearch
            triggerVariant="input"
            size="sm"
            placeholder="Unassigned"
          />
        </div>
        <div className="min-w-[200px] flex-[1.4]">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Assignees</p>
          <MultiSelectDropdown
            title="Assignees"
            items={people}
            selectedValues={assignees}
            onApply={setAssignees}
            multiSelect
            forceSearch
            triggerVariant="input"
            size="sm"
            placeholder="Add people…"
          />
        </div>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !scopeQ.data?.id}
          className="inline-flex h-8 items-center rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </button>
      </div>
      <p className={`text-[11px] ${dueOverdue ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>
        Next due: {dueLabel || '—'}{dueOverdue ? ' · overdue' : ''}
      </p>
    </div>
  );
}

function HistoryPanel({ code }: { code: string }) {
  const scopeQ = useQuery({
    queryKey: ['scf-default-scope'],
    queryFn: async () => (await scfApi.getDefaultScope()).data,
    staleTime: 60_000,
  });
  const histQ = useQuery({
    queryKey: ['scf-control-history', scopeQ.data?.id, code],
    enabled: !!scopeQ.data?.id && !!code,
    queryFn: async () => {
      const raw = (await scfApi.getControlHistory(scopeQ.data!.id, code)).data;
      return Array.isArray(raw) ? raw : (raw?.items || []);
    },
  });
  const items = histQ.data || [];

  return (
    <Panel title="History" action={<span className="text-xs text-slate-400">Ownership &amp; applicability audit</span>}>
      {histQ.isLoading || scopeQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : histQ.isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">
          Couldn&apos;t load history.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No ownership or applicability events yet.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.map((ev: ScfHistoryEntry, i: number) => (
            <li key={ev.id ?? i} className="px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">
                  {ev.summary || ev.action || 'Event'}
                </span>
                <span className="text-[11px] text-slate-400">
                  {ev.created_at ? new Date(ev.created_at).toLocaleString() : '—'}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {[ev.actor_name || (ev.actor_id != null ? `User ${ev.actor_id}` : null), ev.action]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
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
function TestGroupsPanel({
  groups,
  connectionId,
  onRan,
  bindingSource,
}: {
  groups: TestGroup[];
  connectionId?: number | null;
  onRan: () => void;
  bindingSource?: BindingSource | null;
}) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  if (!groups.length) {
    return (
      <Panel title="Automated tests">
        <BindingSourceCaption source={bindingSource} />
        <div className={`rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500 ${bindingSource === 'covers' || bindingSource === 'soc2_fallback' ? 'mt-3' : ''}`}>
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
      {(bindingSource === 'covers' || bindingSource === 'soc2_fallback') && (
        <div className="mb-3"><BindingSourceCaption source={bindingSource} /></div>
      )}
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
                        {p.checks.map((chk, i) => (
                          <CheckRow
                            key={`${p.provider}-${i}`}
                            chk={chk}
                            connectionId={connectionId}
                            onRan={onRan}
                          />
                        ))}
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

interface LinkedControlRisk {
  link_id: number;
  risk_id: number;
  title: string;
  status: string;
  inherent_score?: number | null;
  residual_score?: number | null;
  owner_name?: string | null;
}

interface ControlRisksResponse {
  items: LinkedControlRisk[];
  scf_prompts?: {
    risks?: string[] | string | null;
    threats?: string[] | string | null;
    risk_if_not_implemented?: string | null;
  } | null;
}

const RISK_STATUS_PILL: Record<string, string> = {
  open: 'bg-rose-50 text-rose-700 border-rose-200',
  in_treatment: 'bg-amber-50 text-amber-700 border-amber-200',
  mitigating: 'bg-amber-50 text-amber-700 border-amber-200',
  mitigated: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accepted: 'bg-primary-50 text-primary-700 border-primary-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

function asCodeList(v?: string[] | string | null): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

/** Live risk-register links + read-only SCF catalogue prompts (Decision 4). */
function ControlRisksPanel({ code }: { code: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [likelihood, setLikelihood] = useState<number | ''>('');
  const [impact, setImpact] = useState<number | ''>('');

  const listQ = useQuery({
    queryKey: ['control-risks', code],
    queryFn: () => automationApi.listControlRisks(code).then((r) => r.data as ControlRisksResponse),
  });
  const items = listQ.data?.items ?? [];
  const prompts = listQ.data?.scf_prompts;
  const linkedIds = new Set(items.map((i) => i.risk_id));

  const risksQ = useQuery({
    queryKey: ['risks-for-control-link'],
    queryFn: () => risksApi.getAll().then((r) => r.data as Risk[]),
  });

  const unlink = useMutation({
    mutationFn: (linkId: number) => automationApi.unlinkControlRisk(code, linkId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['control-risks', code] });
      toast({ type: 'success', title: 'Risk unlinked' });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast({ type: 'error', title: detail || 'Could not unlink risk' });
    },
  });

  const link = useMutation({
    mutationFn: (riskId: number) => automationApi.linkControlRisk(code, riskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['control-risks', code] });
      toast({ type: 'success', title: 'Risk linked' });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast({ type: 'error', title: detail || 'Could not link risk' });
    },
  });

  const create = useMutation({
    mutationFn: () => automationApi.createControlRisk(code, {
      title: title.trim(),
      ...(likelihood !== '' ? { inherent_likelihood: Number(likelihood) } : {}),
      ...(impact !== '' ? { inherent_impact: Number(impact) } : {}),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['control-risks', code] });
      void qc.invalidateQueries({ queryKey: ['risks-for-control-link'] });
      setRaiseOpen(false);
      setTitle('');
      setLikelihood('');
      setImpact('');
      toast({ type: 'success', title: 'Risk raised and linked' });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast({ type: 'error', title: detail || 'Could not create risk' });
    },
  });

  const pickerItems = (risksQ.data || [])
    .filter((r) => !linkedIds.has(Number(r.id)))
    .map((r) => ({
      value: String(r.id),
      label: r.title,
      subLabel: [r.status, r.owner_name].filter(Boolean).join(' · ') || undefined,
    }));

  const riskCodes = asCodeList(prompts?.risks);
  const threatCodes = asCodeList(prompts?.threats);
  const riskIfNot = prompts?.risk_if_not_implemented?.trim() || '';
  const hasPrompts = riskCodes.length > 0 || threatCodes.length > 0 || !!riskIfNot;

  return (
    <div className="space-y-4">
      <Panel
        title="Linked risks"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <InlineLinkPicker
              triggerLabel="Link existing"
              triggerClassName="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              items={pickerItems}
              isLoading={risksQ.isLoading}
              onSelect={(value) => link.mutate(Number(value))}
              searchPlaceholder="Search risks..."
              emptyText="No risks available"
            />
            <button
              type="button"
              onClick={() => setRaiseOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
            >
              Raise new
            </button>
            <span className="text-xs text-slate-500">{items.length}</span>
          </div>
        )}
      >
        {listQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : items.length ? (
          <ul className="divide-y divide-slate-100">
            {items.map((it) => {
              const stCls = RISK_STATUS_PILL[it.status] || 'bg-slate-100 text-slate-600 border-slate-200';
              return (
                <li key={it.link_id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/erm/risks/${it.risk_id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:text-primary-700"
                    >
                      {it.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${stCls}`}>
                        {(it.status || 'open').replace(/_/g, ' ')}
                      </span>
                      <span className="tabular-nums">
                        Inherent {it.inherent_score ?? '—'} · Residual {it.residual_score ?? '—'}
                      </span>
                      {it.owner_name && <span>Owner: {it.owner_name}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={unlink.isPending}
                    onClick={() => unlink.mutate(it.link_id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                  >
                    Unlink
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No risks linked yet.</p>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Control status is an indicator only — linking a risk does not recalculate residual score.
        </p>
      </Panel>

      {hasPrompts && (
        <Panel title="SCF catalogue references (prompts)">
          <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
            Verbatim SCF catalogue text — not live risk-register rows. Use them as prompts when raising or linking risks.
          </p>
          {riskCodes.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Risk codes</p>
              <div className="flex flex-wrap gap-1.5">
                {riskCodes.map((c) => (
                  <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">{c}</span>
                ))}
              </div>
            </div>
          )}
          {threatCodes.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Threat codes</p>
              <div className="flex flex-wrap gap-1.5">
                {threatCodes.map((c) => (
                  <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">{c}</span>
                ))}
              </div>
            </div>
          )}
          {riskIfNot && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Risk if not implemented</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{riskIfNot}</p>
            </div>
          )}
        </Panel>
      )}

      <AnimatedModal
        isOpen={raiseOpen}
        onClose={() => { if (!create.isPending) setRaiseOpen(false); }}
        title="Raise new risk"
        size="md"
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Risk title"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Inherent likelihood (1–5)</label>
              <select
                value={likelihood === '' ? '' : String(likelihood)}
                onChange={(e) => setLikelihood(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              >
                <option value="">Optional</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Inherent impact (1–5)</label>
              <select
                value={impact === '' ? '' : String(impact)}
                onChange={(e) => setImpact(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              >
                <option value="">Optional</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => setRaiseOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={create.isPending || !title.trim()}
              onClick={() => create.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create & link
            </button>
          </div>
        </div>
      </AnimatedModal>
    </div>
  );
}

interface LinkedControlAsset {
  link_id: number;
  asset_id: number;
  name: string;
  asset_type?: string | null;
  status?: string | null;
  criticality?: string | null;
  check_status?: string | null;
  check_detail?: string | null;
}

interface InScopeAsset {
  asset_id: number;
  name: string;
  asset_type?: string | null;
  status?: string | null;
  criticality?: string | null;
  in_scope_tag?: boolean;
}

interface ControlAssetsResponse {
  items: LinkedControlAsset[];
  in_scope?: InScopeAsset[];
  note?: string | null;
}

const CHECK_STATUS_PILL: Record<string, string> = {
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  passed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  not_run: 'bg-slate-100 text-slate-600 border-slate-200',
  unknown: 'bg-slate-100 text-slate-500 border-slate-200',
};

function checkStatusLabel(s?: string | null) {
  const key = (s || 'not_run').toLowerCase();
  if (key === 'passed') return 'Passed';
  if (key === 'failed') return 'Failed';
  if (key === 'partial') return 'Partial';
  if (key === 'not_run') return 'Not run';
  return (s || 'Unknown').replace(/_/g, ' ');
}

/** Linked IT assets for a common control (Stage F). */
function ControlAssetsPanel({ code }: { code: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const listQ = useQuery({
    queryKey: ['control-assets', code],
    queryFn: () => automationApi.listControlAssets(code).then((r) => r.data as ControlAssetsResponse),
  });
  const items = listQ.data?.items ?? [];
  const inScope = listQ.data?.in_scope ?? [];
  const linkedIds = new Set(items.map((i) => i.asset_id));

  const assetsQ = useQuery({
    queryKey: ['assets-for-control-link'],
    queryFn: () => assetsApi.getAll().then((r) => r.data as ITAsset[]),
  });

  const unlink = useMutation({
    mutationFn: (linkId: number) => automationApi.unlinkControlAsset(code, linkId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['control-assets', code] });
      toast({ type: 'success', title: 'Asset unlinked' });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast({ type: 'error', title: detail || 'Could not unlink asset' });
    },
  });

  const link = useMutation({
    mutationFn: (assetId: number) => automationApi.linkControlAsset(code, assetId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['control-assets', code] });
      toast({ type: 'success', title: 'Asset linked' });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast({ type: 'error', title: detail || 'Could not link asset' });
    },
  });

  const pickerItems = (assetsQ.data || [])
    .filter((a) => !linkedIds.has(Number(a.id)))
    .map((a) => ({
      value: String(a.id),
      label: a.name,
      subLabel: [a.asset_type, a.criticality].filter(Boolean).join(' · ') || undefined,
    }));

  const inScopeUnlinked = inScope.filter((a) => !linkedIds.has(a.asset_id));

  return (
    <div className="space-y-4">
      <Panel
        title="Linked assets"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <InlineLinkPicker
              triggerLabel="Link existing"
              triggerClassName="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              items={pickerItems}
              isLoading={assetsQ.isLoading || link.isPending}
              onSelect={(value) => link.mutate(Number(value))}
              searchPlaceholder="Search assets..."
              emptyText="No assets available"
            />
            <span className="text-xs text-slate-500">{items.length}</span>
          </div>
        )}
      >
        {listQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-3 font-semibold">Name</th>
                  <th className="pb-2 pr-3 font-semibold">Type</th>
                  <th className="pb-2 pr-3 font-semibold">Check</th>
                  <th className="pb-2 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => {
                  const st = (it.check_status || 'not_run').toLowerCase();
                  const stCls = CHECK_STATUS_PILL[st] || CHECK_STATUS_PILL.unknown;
                  return (
                    <tr key={it.link_id}>
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/assets/${it.asset_id}`}
                          className="font-medium text-slate-800 hover:text-primary-700"
                        >
                          {it.name}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 capitalize text-slate-500">{it.asset_type || '—'}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${stCls}`}>
                          {checkStatusLabel(it.check_status)}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          disabled={unlink.isPending}
                          onClick={() => unlink.mutate(it.link_id)}
                          className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                        >
                          Unlink
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No assets linked yet.</p>
        )}
      </Panel>

      {inScopeUnlinked.length > 0 && (
        <Panel title="In-scope assets" action={<span className="text-xs text-slate-500">{inScopeUnlinked.length}</span>}>
          <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
            Assets whose compliance scope overlaps this tenant&apos;s SCF frameworks (plus untagged).
          </p>
          <ul className="divide-y divide-slate-100">
            {inScopeUnlinked.map((a) => (
              <li key={a.asset_id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <HardDrive className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/assets/${a.asset_id}`}
                    className="block truncate text-sm font-medium text-slate-800 hover:text-primary-700"
                  >
                    {a.name}
                  </Link>
                  <p className="text-[11px] text-slate-400 capitalize">
                    {[a.asset_type, a.criticality].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={link.isPending}
                  onClick={() => link.mutate(a.asset_id)}
                  className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Link
                </button>
              </li>
            ))}
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
  const { toast } = useToast();
  const [viewing, setViewing] = useState<ControlArtifactRow | null>(null);
  const [creating, setCreating] = useState<ControlArtifactRow | null>(null);
  const [editing, setEditing] = useState<TenantArtifact | null>(null);
  const [assigningId, setAssigningId] = useState<number | null>(null);
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
  const people = useMemo(
    () => tenantUsers.map((u) => ({ value: String(u.id), label: u.label, subLabel: u.email || undefined })),
    [tenantUsers],
  );

  // same store as the Frameworks page, so its lists go stale too
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['control-artifacts', code] });
    qc.invalidateQueries({ queryKey: ['tenant-artifacts'] });
  };
  const create = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await apiClient.post('/artifacts', payload)).data,
    onSuccess: () => { setCreating(null); refresh(); },
  });
  const update = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TenantArtifact> }) =>
      (await artifactsApi.update(id, data)).data,
    onSuccess: () => { setEditing(null); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => artifactsApi.remove(id),
    onSuccess: refresh,
  });
  const assign = useMutation({
    mutationFn: async ({ id, userId }: { id: number; userId: number }) =>
      (await artifactsApi.assign(id, userId)).data,
    onSuccess: () => { setAssigningId(null); refresh(); toast({ type: 'success', title: 'Artifact assigned' }); },
    onError: (e) => toast({ type: 'error', title: 'Assign failed', message: errDetail(e) }),
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      (await artifactsApi.update(id, { status })).data,
    onSuccess: (_d, vars) => {
      refresh();
      toast({
        type: 'success',
        title: vars.status === 'approved' ? 'Approved' : vars.status === 'in_review' ? 'Sent for review' : 'Status updated',
      });
    },
    onError: (e) => toast({ type: 'error', title: 'Status update failed', message: errDetail(e) }),
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
                  <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                    <button onClick={() => setViewing(row)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      View
                    </button>
                    {a ? (
                      <>
                        {assigningId === a.id ? (
                          <div className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                            <MultiSelectDropdown
                              title="Assign"
                              items={people}
                              selectedValues={a.assigned_to_id != null ? [String(a.assigned_to_id)] : []}
                              onApply={(vals) => {
                                if (vals[0]) assign.mutate({ id: a.id, userId: Number(vals[0]) });
                                else setAssigningId(null);
                              }}
                              multiSelect={false}
                              autoApply
                              forceSearch
                              triggerVariant="input"
                              size="sm"
                              placeholder="Pick person…"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAssigningId(a.id)}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Assign
                          </button>
                        )}
                        {a.status !== 'in_review' && a.status !== 'approved' && (
                          <button
                            type="button"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: a.id, status: 'in_review' })}
                            className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                          >
                            Send for review
                          </button>
                        )}
                        {a.status === 'in_review' && (
                          <button
                            type="button"
                            disabled={setStatus.isPending}
                            onClick={() => setStatus.mutate({ id: a.id, status: 'approved' })}
                            className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        <ArtifactDownload artifact={a} label="Download" />
                        <button onClick={() => setEditing(a)}
                          className="rounded-md bg-primary-600 px-2 py-1 text-xs font-semibold text-white hover:bg-primary-700">
                          Edit &amp; review
                        </button>
                        <button onClick={() => { if (confirm(`Delete "${a.name}"?`)) remove.mutate(a.id); }}
                          disabled={remove.isPending}
                          className="rounded-md border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                          Delete
                        </button>
                      </>
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
  const router = useRouter();
  const backHref = '/automation/soc2-controls';
  const code = decodeURIComponent(String(params.code || ''));
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [runningAll, setRunningAll] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [implementsDraft, setImplementsDraft] = useState('');

  const controlsQ = useQuery({
    queryKey: ['automation-common'],
    queryFn: () => automationApi.listCommonControls().then((r) => r.data as { controls: CommonControl[] }),
  });

  const connectionsQ = useQuery({
    queryKey: ['automation', 'soc2-connections'],
    queryFn: () => automationApi.listConnections().then((r) => (r.data?.connections || []) as { id: number; name?: string }[]),
    staleTime: 60_000,
  });
  const awsConnectionId = useMemo(() => {
    const list = connectionsQ.data || [];
    return list.length ? list[0].id : null;
  }, [connectionsQ.data]);

  const controls = controlsQ.data?.controls ?? [];
  const listControl = controls.find((c) => c.control_id === code);

  // Requirement text lives in the framework libraries, not the crosswalk, so the
  // detail endpoint resolves it server-side. Fetched only when the tab is opened.
  const detailQ = useQuery({
    queryKey: ['automation-common-detail', code],
    // Statement, grouped tests, artifacts and attached evidence all come from the
    // detail endpoint, so it is needed on every tab rather than two of them.
    enabled: !!code,
    queryFn: () => automationApi.getCommonControl(code).then((r) => r.data as ControlDetail),
    retry: false,
  });
  const customDetailQ = useQuery({
    queryKey: ['scf-custom-control', code],
    enabled: !!code && (!!listControl?.custom || !!detailQ.data?.custom || detailQ.isError || (!listControl && !controlsQ.isLoading)),
    queryFn: () => scfApi.getCustomControl(code).then((r) => r.data),
    retry: false,
  });
  const reqGroupsFull = detailQ.data?.requirement_groups ?? [];
  // Same key as ControlEvidencePanel, so react-query shares one request between the
  // tab count and the panel; without it an upload left the tab reading 0.
  const attachedQ = useQuery({
    queryKey: ['control-evidence', code],
    enabled: !!code,
    queryFn: () => automationApi.listControlEvidence(code).then((r) => r.data as { items: { mapping_id: number }[] }),
  });
  const risksQ = useQuery({
    queryKey: ['control-risks', code],
    enabled: !!code,
    queryFn: () => automationApi.listControlRisks(code).then((r) => r.data as { items: { link_id: number }[] }),
  });
  const assetsTabQ = useQuery({
    queryKey: ['control-assets', code],
    enabled: !!code,
    queryFn: () => automationApi.listControlAssets(code).then((r) => r.data as { items: { link_id: number }[] }),
  });

  // Prefer automation list/detail; fall back to custom-control GET right after create
  // (or if the common list has not merged the tenant row yet).
  const control: CommonControl | undefined = listControl || (customDetailQ.data ? {
    control_id: customDetailQ.data.code,
    canonical_key: customDetailQ.data.code,
    title: customDetailQ.data.name || customDetailQ.data.code,
    description: customDetailQ.data.statement || '',
    category: customDetailQ.data.domain || 'Custom',
    domain: customDetailQ.data.domain || undefined,
    sub_type: customDetailQ.data.control_sub_type || null,
    frameworks: [],
    requirements: {},
    requirement_count: 0,
    checks_count: 0,
    overall_status: 'manual',
    checks: [],
    custom: true,
  } : undefined);
  const isCustom = !!(control?.custom || detailQ.data?.custom || customDetailQ.data?.custom);
  const bindingSource: BindingSource | undefined =
    detailQ.data?.binding_source || listControl?.binding_source || undefined;
  const boundCheckIds = useMemo(
    () => customDetailQ.data?.bound_check_ids
      || detailQ.data?.bound_check_ids
      || EMPTY_CHECK_IDS,
    [customDetailQ.data?.bound_check_ids, detailQ.data?.bound_check_ids],
  );

  useEffect(() => {
    const ids = customDetailQ.data?.implements_scf_ids
      || detailQ.data?.implements_scf_ids
      || [];
    setImplementsDraft(ids.join('\n'));
  }, [customDetailQ.data?.implements_scf_ids, detailQ.data?.implements_scf_ids]);

  const allReqCodes = (c?: CommonControl) =>
    c ? fwOrder(c.requirements).flatMap((f) => (c.requirements[f] || []).map((r) => `${f}:${r.code}`)) : [];

  // Requirement mappings grouped by framework (only frameworks with mappings).
  const reqGroups = useMemo(
    () => (control ? fwOrder(control.requirements)
      .map((f) => ({ fw: f, items: control.requirements[f] || [] })) : []),
    [control],
  );
  const totalReqs = reqGroups.reduce((n, g) => n + g.items.length, 0);

  const invalidateControl = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['automation-common'] }),
      qc.invalidateQueries({ queryKey: ['automation-common-detail', code] }),
      qc.invalidateQueries({ queryKey: ['scf-custom-control', code] }),
    ]);
  };

  const updateCustom = useMutation({
    mutationFn: async (v: CustomControlFormValues) => {
      await scfApi.updateCustomControl(code, {
        name: v.name || undefined,
        statement: v.statement || undefined,
        domain: v.domain || undefined,
        pptdf: v.pptdf || undefined,
        conformity_cadence: v.conformity_cadence || undefined,
        control_sub_type: v.control_sub_type || undefined,
      });
      if (v.implements_scf_ids) {
        await scfApi.updateCustomControlMappings(code, {
          implements_scf_ids: v.implements_scf_ids,
        });
      }
    },
    onSuccess: async () => {
      toast({ type: 'success', title: 'Control updated' });
      setEditOpen(false);
      await invalidateControl();
    },
    onError: (e) => toast({
      type: 'error',
      title: 'Update failed',
      message: errDetail(e),
    }),
  });

  const retireCustom = useMutation({
    mutationFn: () => scfApi.retireCustomControl(code),
    onSuccess: async () => {
      toast({ type: 'success', title: 'Control retired' });
      await qc.invalidateQueries({ queryKey: ['automation-common'] });
      router.push(backHref);
    },
    onError: (e) => toast({
      type: 'error',
      title: 'Retire failed',
      message: errDetail(e),
    }),
  });

  const saveMappings = useMutation({
    mutationFn: async () => {
      const implements_scf_ids = implementsDraft
        .split(/[\n,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      return scfApi.updateCustomControlMappings(code, { implements_scf_ids });
    },
    onSuccess: async () => {
      toast({ type: 'success', title: 'Mappings saved' });
      await invalidateControl();
    },
    onError: (e) => toast({
      type: 'error',
      title: 'Could not save mappings',
      message: errDetail(e),
    }),
  });

  const runTest = async () => {
    const ids = (control?.checks || []).map((c) => c.id).filter(Boolean) as number[];
    if (!ids.length) return;
    setRunningAll(true);
    for (const id of ids) {
      try {
        await automationApi.runCheck(id, awsConnectionId ?? undefined);
      } catch { /* surfaced per-row */ }
    }
    await invalidateControl();
    setRunningAll(false);
  };

  if (controlsQ.isLoading || (customDetailQ.isLoading && !listControl && !control)) {
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
    { id: 'risks', label: 'Risks', count: risksQ.data?.items.length ?? 0 },
    { id: 'assets', label: 'Assets', count: assetsTabQ.data?.items.length ?? 0 },
    { id: 'requirements', label: 'Requirements', count: totalReqs },
    { id: 'history', label: 'History' },
  ];

  const ownerId = detailQ.data?.owner_user_id ?? control.owner_user_id ?? null;
  const reviewerId = detailQ.data?.reviewer_user_id ?? control.reviewer_user_id ?? null;
  const assignedIds = detailQ.data?.assigned_user_ids ?? control.assigned_user_ids ?? null;
  const nextDueAt = detailQ.data?.next_due_at ?? control.next_due_at ?? null;

  const editInitial: Partial<CustomControlFormValues> = {
    code: control.control_id,
    name: customDetailQ.data?.name || control.title || '',
    statement: customDetailQ.data?.statement || detailQ.data?.description || control.description || '',
    domain: customDetailQ.data?.domain || control.domain || control.category || '',
    pptdf: customDetailQ.data?.pptdf || detailQ.data?.implementation?.pptdf || '',
    conformity_cadence: customDetailQ.data?.conformity_cadence
      || detailQ.data?.implementation?.conformity_cadence
      || 'Annual',
    control_sub_type: customDetailQ.data?.control_sub_type || control.sub_type || 'Manual',
    implements_scf_ids: customDetailQ.data?.implements_scf_ids || detailQ.data?.implements_scf_ids || [],
  };

  return (
    <div className="mx-auto max-w-[1200px] px-1 py-1">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href={backHref} className="text-slate-400 hover:text-slate-700">Controls</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="font-semibold text-slate-700">{control.control_id}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <CodeChip code={control.control_id} />
            {isCustom && <CustomBadge />}
            <ControlStatusPill status={control.overall_status} />
            {control.importance && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">{control.importance}</span>}
            {(detailQ.data?.owner_name || control.owner_name) && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                Owner: {detailQ.data?.owner_name || control.owner_name}
              </span>
            )}
          </div>
          <BindingSourceCaption source={bindingSource} />
          <h1 className="mt-1.5 text-2xl font-bold text-slate-900">{control.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500">
            {control.sub_type && (
              <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-slate-400" />{control.sub_type}</span>
            )}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{control.category}</span>
          </div>
          <OwnershipEditors
            code={code}
            ownerId={ownerId}
            reviewerId={reviewerId}
            assignedIds={assignedIds}
            nextDueAt={nextDueAt}
            onSaved={() => { void invalidateControl(); }}
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isCustom && (
            <>
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={retireCustom.isPending}
                onClick={() => {
                  if (confirm(`Retire custom control ${code}? It will leave the active library.`)) {
                    retireCustom.mutate();
                  }
                }}
                className="inline-flex items-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {retireCustom.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Retire'}
              </button>
            </>
          )}
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
              {(detailQ.data?.designation != null
                || detailQ.data?.inheritance_type
                || detailQ.data?.exception_id != null) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2 text-[12px] text-slate-600">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Assurance</span>
                  {detailQ.data.designation != null && (
                    <span>
                      Designation:{' '}
                      <span className="font-medium text-slate-800">
                        {String(detailQ.data.designation).replace(/_/g, ' ')}
                      </span>
                    </span>
                  )}
                  {detailQ.data.inheritance_type && (
                    <span>
                      Inherited from vendor
                      <span className="ml-1 font-medium text-slate-800">
                        ({detailQ.data.inheritance_type}
                        {detailQ.data.provider_vendor_id != null
                          ? ` · vendor #${detailQ.data.provider_vendor_id}`
                          : ''}
                        )
                      </span>
                    </span>
                  )}
                  {detailQ.data.exception_id != null && (
                    <span>
                      Exception #{detailQ.data.exception_id}
                      {detailQ.data.alternative_scf_id
                        ? ` · alt ${detailQ.data.alternative_scf_id}`
                        : ''}
                    </span>
                  )}
                </div>
              )}
              <Panel title="Control statement">
                {isCustom && (
                  <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-500">
                    SCF catalogue text stays read-only; write your own statement.
                  </p>
                )}
                {/* The list endpoint sends description: null for all 1,534 rows so the
                    table stays light; the detail endpoint carries the real text. */}
                {(detailQ.data?.description || customDetailQ.data?.statement || control.description) ? (
                  <p className="text-sm leading-relaxed text-slate-700">
                    {detailQ.data?.description || customDetailQ.data?.statement || control.description}
                  </p>
                ) : detailQ.isLoading ? (
                  <p className="text-sm text-slate-400">Loading…</p>
                ) : (
                  <p className="text-sm italic text-slate-400">No statement published for this control.</p>
                )}
                {detailQ.data?.control_question && !isCustom && (
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
              {isCustom && (
                <AttachedChecksPanel
                  code={code}
                  initialIds={boundCheckIds}
                  onSaved={() => { void invalidateControl(); }}
                />
              )}
              <Panel title="Automated tests">
                {(bindingSource === 'covers' || bindingSource === 'soc2_fallback') && (
                  <div className="mb-3"><BindingSourceCaption source={bindingSource} /></div>
                )}
                {control.checks?.length ? (
                  <ul className="space-y-2">
                    {control.checks.map((chk, i) => (
                      <CheckRow
                        key={i}
                        chk={chk}
                        connectionId={awsConnectionId}
                        onRan={() => { void invalidateControl(); }}
                      />
                    ))}
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
                connectionId={awsConnectionId}
                bindingSource={bindingSource}
                onRan={() => {
                  qc.invalidateQueries({ queryKey: ['automation-common-detail', code] });
                  qc.invalidateQueries({ queryKey: ['automation-common'] });
                }}
              />
            )
          )}

          {tab === 'artifacts' && <ControlArtifactsPanel code={code} />}

          {tab === 'risks' && <ControlRisksPanel code={code} />}

          {tab === 'assets' && <ControlAssetsPanel code={code} />}

          {tab === 'requirements' && (
            <>
              {isCustom && (
                <Panel title="Edit mappings" action={<span className="text-xs text-slate-400">SCF ids this control implements</span>}>
                  <p className="mb-2 text-[12px] leading-relaxed text-slate-500">
                    One SCF id per line (e.g. GOV-01). Requirement links from framework libraries appear below when the backend wires them.
                  </p>
                  <textarea
                    value={implementsDraft}
                    onChange={(e) => setImplementsDraft(e.target.value)}
                    rows={4}
                    placeholder={'GOV-01\nIAC-06'}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700 focus:border-primary-500 focus:outline-none"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={saveMappings.isPending}
                      onClick={() => saveMappings.mutate()}
                      className="inline-flex items-center rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {saveMappings.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save mappings'}
                    </button>
                  </div>
                </Panel>
              )}
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
                    {reqGroupsFull.map((g) => (
                      <RequirementGroup key={g.framework} g={g} defaultOpen={false} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    {isCustom
                      ? 'No framework requirements linked yet. Add SCF ids above; requirement rows appear when mappings resolve.'
                      : 'This control is in the catalog but no framework you have selected requires it.'}
                  </div>
                )}
              </Panel>
            </>
          )}

          {tab === 'evidence' && (
            <ControlEvidencePanel
              code={code}
              mode={detailQ.data?.assurance_mode}
              collected={evidence}
            />
          )}

          {tab === 'history' && <HistoryPanel code={code} />}
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-base font-bold text-slate-900">Status</h2>
            {(bindingSource === 'covers' || bindingSource === 'soc2_fallback') && (
              <div className="mb-2"><BindingSourceCaption source={bindingSource} /></div>
            )}
            <Fact label="Implementation" value={<ControlStatusPill status={control.overall_status} inline />} />
            <Fact label="Sub-type" value={control.sub_type || '—'} />
            <Fact label="Origin" value={isCustom ? 'Custom' : 'SCF'} />
            <Fact label="Checks" value={`${control.checks_count} linked`} />
            <Fact label="Last tested" value={lastTested ? new Date(lastTested).toLocaleDateString() : 'Not tested'} muted={!lastTested} />
            <Fact
              label="Owner"
              value={detailQ.data?.owner_name || control.owner_name || (ownerId != null ? `User ${ownerId}` : 'Unassigned')}
              muted={!ownerId}
            />
            <Fact
              label="Next due"
              value={nextDueAt ? new Date(nextDueAt).toLocaleDateString() : '—'}
              muted={!nextDueAt}
            />
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

      <AnimatedModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit custom control"
        size="lg"
      >
        <CustomControlForm
          key={editOpen ? 'open' : 'closed'}
          initial={editInitial}
          codeLocked
          showImplements
          submitLabel="Save changes"
          pending={updateCustom.isPending}
          onCancel={() => setEditOpen(false)}
          onSubmit={(v) => updateCustom.mutate(v)}
        />
      </AnimatedModal>
    </div>
  );
}
