'use client';

// SOC 2 control detail — faithful to the Verity reference control-detail-page:
// breadcrumb, header (code · status · sub-type · category + Run test), tabbed
// body (Overview / Evidence / Tests / Requirements / History) and a right rail
// (Status facts · Framework mappings · Related controls). Tests + Run test are
// wired live to /automation/soc2 (the GitHub/AWS checks actually execute here).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ChevronDown, ChevronRight, Clock, FileText, FolderTree, HardDrive, Loader2, Play,
  RefreshCw, X,
} from 'lucide-react';
import {
  apiClient, artifactsApi, assetsApi, automationApi, certificationsApi, risksApi, scfApi,
  type ControlRecordLink, type CustomControlProfile, type ScfHistoryEntry,
} from '@/lib/api';
import {
  ArtifactDownload, CreateArtifactModal, EditArtifactModal, ViewArtifactModal,
  type CatalogItem, type TenantArtifact, type TenantUser,
} from '@/components/compliance/ArtifactsTab';
import {
  CodeChip, ControlStatusPill, CONTROL_STATUS, FrameworkBadge, CustomBadge, frameworkColor,
  type BindingSource, type LinkedCheck,
} from '@/components/soc2/ui';
import { CustomControlForm, toWriteBody, type CustomControlFormValues } from '@/components/soc2/CustomControlForm';
import { RecordLinker, RecordTypeIcon, groupByType, type LinkedRecord } from '@/components/soc2/RecordLinker';
import { AnimatedModal, MultiSelectDropdown, useToast } from '@/components/ui';
import InlineLinkPicker from '@/components/ui/InlineLinkPicker';
import AssuranceTab from './_assurance/AssuranceTab';
import { DetailPanel, SummaryCard, Tally } from './_assurance/cards';
import EvidenceWorkspace from './_assurance/EvidenceWorkspace';
import AutomatedTests, { type TestGroup } from './_assurance/AutomatedTests';
import { LEVELS, MaturityMeter, MaturityPanel } from './_assurance/Maturity';
import type { Objective } from './_assurance/types';
import type { ITAsset, Risk } from '@/types';

type Tab = 'overview' | 'assurance' | 'evidence' | 'tests' | 'artifacts' | 'risks' | 'assets' | 'links' | 'requirements' | 'history';
const TAB_IDS: Tab[] = ['overview', 'assurance', 'evidence', 'tests', 'artifacts', 'risks', 'assets', 'links', 'requirements', 'history'];

const EMPTY_CHECK_IDS: string[] = [];

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
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
  title: string;
  category?: string | null;
  domain?: string | null;
  sub_type?: string | null;
  checks?: LinkedCheck[];
  checks_count?: number;
  overall_status?: string;
  is_material?: boolean;
  conformity_cadence?: string | null;
  /** The tenant's in-scope frameworks; requirement_groups holds only these when set. */
  scope_frameworks?: { key: string; label: string }[];
  description?: string | null;
  control_question?: string | null;
  custom?: boolean;
  implements_scf_ids?: string[];
  bound_check_ids?: string[];
  binding_source?: BindingSource;
  /** The SCF objective tokens, or SOC 2 criteria, the tests reach this control through. */
  binding_via?: string[];
  test_groups?: TestGroup[];
  related?: {
    family: { control_id: string; title: string | null }[];
    by_requirements: { control_id: string; title: string | null; shared: number; score: number; requirements?: string[] }[];
  };
  artifacts?: ControlArtifact[];
  /** SCF assessment objectives, verbatim. */
  objectives?: Objective[];
  coverage?: Coverage;
  assurance_mode?: 'automated' | 'manual' | 'hybrid';
  implementation?: {
    target_maturity: string | null;
    maturity_levels: Record<string, string>;
    solutions: Record<string, string>;
    conformity_cadence: string | null;
    pptdf: string | null;
    /** Custom controls: the SCF control the criteria above are published for. */
    maturity_from?: string | null;
    /** Custom controls: what the tenant wrote. */
    objective?: string | null;
    guidance?: string | null;
    testing_guidance?: string | null;
    authored?: boolean;
  };
  evidence?: {
    automated: { check_id: string; connector: string; title: string | null }[];
    manual: EvidenceItem[];
    automated_count: number;
    manual_count: number;
    from_frameworks: number;
    consolidated?: ConsolidatedArtifact[] | null;
    consolidated_from?: number | null;
    /** In scope: each in-scope framework's own evidence asks, named once. */
    required?: { key: string; name: string; description: string; filetype: string | null; type: string;
      collection_method: 'automated' | 'hybrid' | 'manual'; required_by: string[]; references: string[] }[];
    /** Custom controls: the evidence the author said this control produces. */
    authored?: { key: string; name: string; description: string; filetype: string | null; type: string;
      collection_method: 'automated' | 'hybrid' | 'manual'; required_by: string[]; references: string[] }[];
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
  /** SCR-CMM 0–5, rated by the organisation; the target falls back to the scope default. */
  cmm_actual?: number | null;
  cmm_target?: number | null;
  cmm_target_default?: number;
  inheritance_type?: string | null;
  exception_id?: number | null;
  alternative_scf_id?: string | null;
  provider_vendor_id?: number | null;
  /** Custom controls: the register fields, work fields and link counts. */
  profile?: CustomControlProfile | null;
  link_counts?: Record<string, number>;
  implements_titles?: Record<string, string | null>;
  priority?: string | null;
  is_key_control?: boolean;
  implementation_status?: string | null;
  design_effectiveness?: string | null;
  operating_effectiveness?: string | null;
  last_tested_at?: string | null;
  next_test_date?: string | null;
  objectives_note?: string | null;
}

type TenantUserRow = { id: number; display_name?: string; email?: string; username?: string };

function userLabel(u: TenantUserRow) {
  return u.display_name || u.username || u.email || `User ${u.id}`;
}

function errDetail(e: unknown, fallback = 'Request failed') {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

/** One row of properties under the header: who owns the control, who reviews
 *  it, who works on it, and the facts people look for first. People save as
 *  soon as they are picked. */
function PropertiesBar({
  code,
  ownerId,
  reviewerId,
  assignedIds,
  nextDueAt,
  facts,
  onSaved,
}: {
  code: string;
  ownerId?: number | null;
  reviewerId?: number | null;
  assignedIds?: number[] | null;
  nextDueAt?: string | null;
  facts: { label: string; value: React.ReactNode; muted?: boolean }[];
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
    mutationFn: async (next: { owner: string[]; reviewer: string[]; assignees: string[] }) => {
      const scopeId = scopeQ.data?.id;
      if (!scopeId) throw new Error('No default scope');
      return scfApi.setOwnership(scopeId, code, {
        owner_user_id: next.owner[0] ? Number(next.owner[0]) : null,
        reviewer_user_id: next.reviewer[0] ? Number(next.reviewer[0]) : null,
        assigned_user_ids: next.assignees.map(Number),
      });
    },
    onSuccess: () => onSaved(),
    onError: (e) => toast({ type: 'error', title: 'Could not save ownership', message: errDetail(e) }),
  });
  const pick = (patch: Partial<{ owner: string[]; reviewer: string[]; assignees: string[] }>) => {
    const next = { owner, reviewer, assignees, ...patch };
    setOwner(next.owner); setReviewer(next.reviewer); setAssignees(next.assignees);
    save.mutate(next);
  };

  const dueLabel = nextDueAt
    ? new Date(nextDueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const dueOverdue = nextDueAt ? new Date(nextDueAt).getTime() < Date.now() : false;
  const disabled = !scopeQ.data?.id;

  const label = (text: string) => <p className="mb-1 text-[11px] font-medium text-slate-500">{text}</p>;

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="w-44">
        {label('Owner')}
        <MultiSelectDropdown title="Owner" items={people} selectedValues={owner} onApply={(v) => pick({ owner: v })}
          multiSelect={false} autoApply forceSearch triggerVariant="input" size="sm" placeholder="Unassigned"
          className="w-full" triggerClassName="w-full" />
      </div>
      <div className="w-44">
        {label('Reviewer')}
        <MultiSelectDropdown title="Reviewer" items={people} selectedValues={reviewer} onApply={(v) => pick({ reviewer: v })}
          multiSelect={false} autoApply forceSearch triggerVariant="input" size="sm" placeholder="Unassigned"
          className="w-full" triggerClassName="w-full" />
      </div>
      <div className="w-52">
        {label('Assignees')}
        <MultiSelectDropdown title="Assignees" items={people} selectedValues={assignees} onApply={(v) => pick({ assignees: v })}
          multiSelect forceSearch triggerVariant="input" size="sm" placeholder="Add people…"
          className="w-full" triggerClassName="w-full" />
      </div>
      <div className="flex h-8 items-center">
        {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {disabled && !scopeQ.isLoading && <span className="text-[11px] text-slate-400">Scope not set up</span>}
      </div>
      <div className="ml-auto flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          {label('Next review')}
          <p className={`flex h-8 items-center text-[13px] font-medium ${dueOverdue ? 'text-rose-600' : dueLabel ? 'text-slate-800' : 'text-slate-400'}`}>
            {dueLabel ? `${dueLabel}${dueOverdue ? ' · overdue' : ''}` : 'Not scheduled'}
          </p>
        </div>
        {facts.map((f) => (
          <div key={f.label}>
            {label(f.label)}
            <div className={`flex h-8 items-center text-[13px] font-medium ${f.muted ? 'text-slate-400' : 'text-slate-800'}`}>{f.value}</div>
          </div>
        ))}
      </div>
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
      const raw = (await scfApi.getControlHistory(scopeQ.data!.id, code)).data as
        ScfHistoryEntry[] | { items?: ScfHistoryEntry[]; events?: ScfHistoryEntry[] };
      return Array.isArray(raw) ? raw : (raw?.events || raw?.items || []);
    },
  });
  const items = histQ.data || [];

  return (
    <Panel title="History" action={<span className="text-xs text-slate-400">Ownership, applicability, testing &amp; evidence audit</span>}>
      {histQ.isLoading || scopeQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : histQ.isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">
          Couldn&apos;t load history.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No changes recorded for this control yet.
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
/** Everything this control is linked to, across every module. Adding or removing
 *  writes into the target module's own link table, so the record's own page
 *  shows the control back. */
function LinkedRecordsPanel({ code }: { code: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const linksQ = useQuery({
    queryKey: ['control-links', code],
    queryFn: async () => (await automationApi.listControlLinks(code)).data.items,
  });
  const typesQ = useQuery({
    queryKey: ['control-link-types'],
    queryFn: async () => (await automationApi.listLinkTypes()).data.types,
    staleTime: 60 * 60_000,
  });
  const links = useMemo(() => linksQ.data ?? [], [linksQ.data]);
  const order = (typesQ.data ?? []).map((t) => t.key);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['control-links', code] });
    void qc.invalidateQueries({ queryKey: ['automation-common-detail', code] });
    void qc.invalidateQueries({ queryKey: ['control-risks', code] });
    void qc.invalidateQueries({ queryKey: ['control-assets', code] });
  };

  // The picker hands back the whole selection; the difference against what is
  // stored is the one link to write or remove.
  const apply = async (next: LinkedRecord[]) => {
    const before = new Map(links.map((r) => [r.type + ':' + r.id, r]));
    const after = new Map(next.map((r) => [r.type + ':' + r.id, r]));
    const added = next.find((r) => !before.has(r.type + ':' + r.id));
    const removed = links.find((r) => !after.has(r.type + ':' + r.id));
    const target = added || removed;
    if (!target) return;
    setBusy(target.type + ':' + target.id);
    try {
      if (added) {
        await automationApi.linkControlRecord(code, { type: added.type, record_id: added.id });
        toast({ type: 'success', title: 'Linked ' + added.type_label.toLowerCase() });
      } else if (removed) {
        await automationApi.unlinkControlRecord(code, removed.type, removed.id);
        toast({ type: 'success', title: 'Unlinked ' + removed.type_label.toLowerCase() });
      }
      refresh();
    } catch (e) {
      toast({ type: 'error', title: 'Could not save the link', message: errDetail(e) });
    } finally {
      setBusy(null);
    }
  };

  const groups = groupByType(links, order);
  return (
    <div className="space-y-4">
      <Panel title="Link a record" action={<span className="text-xs text-slate-400">Searched across the platform</span>}>
        <RecordLinker selected={links} onChange={(next) => { void apply(next); }} busyKey={busy} label="" />
      </Panel>

      <Panel title="Linked records" action={<span className="text-xs text-slate-400">{links.length} linked</span>}>
        {linksQ.isLoading ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : links.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Nothing linked yet. Attach the risks this control mitigates, the assets it covers, the documents that
            define it, or the issues it failed.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(([type, rows]) => (
              <div key={type}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {(typesQ.data ?? []).find((t) => t.key === type)?.plural || type.replace(/_/g, ' ')} &middot; {rows.length}
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {rows.map((row) => (
                    <li key={row.type + ':' + row.id} className="flex items-center gap-2.5 px-3 py-2">
                      <RecordTypeIcon type={row.type} className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <Link href={row.url} className="block truncate text-[13px] font-medium text-slate-800 hover:text-primary-700">
                          {row.code ? <span className="mr-1.5 font-mono text-[11px] text-slate-500">{row.code}</span> : null}
                          {row.label}
                        </Link>
                        {row.subtitle && <p className="truncate text-[11px] capitalize text-slate-400">{row.subtitle}</p>}
                      </div>
                      {row.status && (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium capitalize text-slate-600">
                          {String(row.status).replace(/_/g, ' ')}
                        </span>
                      )}
                      <button type="button" aria-label={'Unlink ' + row.label}
                        onClick={() => { void apply(links.filter((r) => !(r.type === row.type && r.id === row.id))); }}
                        disabled={busy === row.type + ':' + row.id}
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50">
                        {busy === row.type + ':' + row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

const LIFECYCLE_STYLES: Record<string, string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-600',
  pending_approval: 'border-amber-200 bg-amber-50 text-amber-700',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  inactive: 'border-slate-200 bg-slate-100 text-slate-500',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
};

/** The register's approval workflow: draft -> pending approval -> active.
 *  Whoever submitted a control cannot approve it. */
function LifecycleActions({ code, profile, onDone }: {
  code: string; profile?: CustomControlProfile | null; onDone: () => void;
}) {
  const { toast } = useToast();
  const status = profile?.lifecycle_status || 'draft';
  const act = useMutation({
    mutationFn: async (action: string) => scfApi.setCustomControlLifecycle(code, { action }),
    onSuccess: (_d, action) => { toast({ type: 'success', title: 'Control ' + action + 'd' }); onDone(); },
    onError: (e) => toast({ type: 'error', title: 'Could not change the status', message: errDetail(e) }),
  });
  const actions: [string, string][] = status === 'pending_approval'
    ? [['approve', 'Approve'], ['reject', 'Reject']]
    : status === 'active'
      ? [['deactivate', 'Deactivate']]
      : [['submit', 'Submit for approval']];
  return (
    <>
      <span title={'Register status: ' + status.replace(/_/g, ' ')}
        className={'inline-flex h-8 items-center rounded-lg border px-2.5 text-[11px] font-semibold uppercase tracking-wide ' + (LIFECYCLE_STYLES[status] || LIFECYCLE_STYLES.draft)}>
        {status.replace(/_/g, ' ')}
      </span>
      {actions.map(([action, label]) => (
        <button key={action} type="button" disabled={act.isPending} onClick={() => act.mutate(action)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {act.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{label}
        </button>
      ))}
    </>
  );
}

/** The register fields, for a control the tenant wrote. */
function RegisterCard({ d }: { d: ControlDetail }) {
  const p = d.profile || {};
  const date = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : null);
  const rows: [string, React.ReactNode][] = [
    ['Category', [p.category, p.sub_category].filter(Boolean).join(' \u00b7 ') || null],
    ['Control type', p.control_type ? p.control_type[0].toUpperCase() + p.control_type.slice(1) : null],
    ['Operates', p.operating_frequency ? p.operating_frequency.replace(/_/g, ' ') : null],
    ['Department', p.department_name],
    ['Backup owner', p.backup_owner_name],
    ['Regulatory source', p.regulatory_source],
    ['Effective', date(p.effective_date)],
    ['Next review', date(p.review_date)],
    ['Priority', d.priority ? d.priority[0].toUpperCase() + d.priority.slice(1) : null],
  ];
  const filled = rows.filter(([, v]) => v);
  return (
    <SummaryCard title="Control register" meta={d.is_key_control ? 'Key control' : undefined}>
      {filled.length ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {filled.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10.5px] uppercase tracking-wide text-slate-400">{label}</dt>
              <dd className="truncate text-[12.5px] capitalize text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-slate-500">No register fields recorded yet. Use Edit to add them.</p>
      )}
      {p.submitted_at && (
        <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          Submitted {p.submitted_by_name ? 'by ' + p.submitted_by_name + ' ' : ''}{new Date(p.submitted_at).toLocaleDateString()}
          {p.approved_at ? ' \u00b7 approved ' + (p.approved_by_name ? 'by ' + p.approved_by_name + ' ' : '') + new Date(p.approved_at).toLocaleDateString() : ''}
        </p>
      )}
    </SummaryCard>
  );
}

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


interface LinkedEvidence {
  evidence_id: number; mapping_id: number; name: string; description: string | null;
  file_name: string | null; file_type: string | null; evidence_type: string | null;
  status: string; uploaded_at: string | null; expiry_date: string | null;
  is_stale: boolean; coverage_type: string;
}

/** Evidence a person attaches: the manual and hybrid half no collector produces. */
function ControlEvidencePanel({ code, mode, collected, workspace = false }: {
  code: string; mode?: string; collected: LinkedCheck[];
  /** SCF controls: linked and required evidence side by side, as on the Frameworks page. */
  workspace?: boolean;
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
      {workspace && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <EvidenceWorkspace code={code} />
        </section>
      )}
      {!workspace && acceptsUploads && (
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

      {!workspace && <Panel title="Attached evidence" action={<span className="text-xs text-slate-500">{items.length}</span>}>
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
      </Panel>}

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
}

const RISK_STATUS_PILL: Record<string, string> = {
  open: 'bg-rose-50 text-rose-700 border-rose-200',
  in_treatment: 'bg-amber-50 text-amber-700 border-amber-200',
  mitigating: 'bg-amber-50 text-amber-700 border-amber-200',
  mitigated: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accepted: 'bg-primary-50 text-primary-700 border-primary-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** The register risks this control treats: link existing ones or raise a new one. */
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


/** The row the header and tabs read: built from the detail payload, or from the
 *  custom-control record right after one is created. */
interface ControlView {
  control_id: string;
  title: string;
  description: string;
  category: string;
  sub_type: string | null;
  checks: LinkedCheck[];
  checks_count: number;
  overall_status: string;
}

// Requirement codes in reading order: 6.3.2 before 11.2.
const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const METHOD_DOT: Record<string, string> = { automated: 'bg-indigo-500', hybrid: 'bg-violet-500', manual: 'bg-slate-400' };

type OverviewPanel = 'statement' | 'evidence' | 'implement' | 'related';

export default function ControlDetailPage() {
  const params = useParams();
  const router = useRouter();
  const backHref = '/automation/soc2-controls';
  const code = decodeURIComponent(String(params.code || ''));
  const qc = useQueryClient();
  const { toast } = useToast();
  // ?tab= lets another page send someone straight to a section (Connections → Tests)
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = searchParams.get('tab') as Tab | null;
    return wanted && TAB_IDS.includes(wanted) ? wanted : 'overview';
  });
  const [panel, setPanel] = useState<OverviewPanel | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [implementsDraft, setImplementsDraft] = useState('');

  const connectionsQ = useQuery({
    queryKey: ['automation', 'soc2-connections'],
    queryFn: () => automationApi.listConnections().then((r) => (r.data?.connections || []) as { id: number; name?: string }[]),
    staleTime: 60_000,
  });
  const awsConnectionId = useMemo(() => {
    const list = connectionsQ.data || [];
    return list.length ? list[0].id : null;
  }, [connectionsQ.data]);

  // The detail endpoint carries the whole control, in scope or not. The page used
  // to download the entire in-scope list to find this one row, which was slow and
  // reported any out-of-scope control as "not found".
  const detailQ = useQuery({
    queryKey: ['automation-common-detail', code],
    enabled: !!code,
    queryFn: () => automationApi.getCommonControl(code).then((r) => r.data as ControlDetail),
    retry: false,
  });
  const d = detailQ.data;
  const customDetailQ = useQuery({
    queryKey: ['scf-custom-control', code],
    enabled: !!code && (!!d?.custom || detailQ.isError),
    queryFn: () => scfApi.getCustomControl(code).then((r) => r.data),
    retry: false,
  });
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
  const artifactsTabQ = useQuery({
    queryKey: ['control-artifacts', code],
    enabled: !!code,
    queryFn: () => automationApi.listControlArtifacts(code).then((r) => r.data as { items: unknown[] }),
  });
  const assetsTabQ = useQuery({
    queryKey: ['control-assets', code],
    enabled: !!code,
    queryFn: () => automationApi.listControlAssets(code).then((r) => r.data as { items: { link_id: number }[] }),
  });
  const linksQ = useQuery({
    queryKey: ['control-links', code],
    enabled: !!code,
    queryFn: async () => (await automationApi.listControlLinks(code)).data.items,
  });

  const custom = customDetailQ.data;
  const control: ControlView | undefined = d ? {
    control_id: d.control_id,
    title: d.title,
    description: d.description || '',
    category: d.category || (d.custom ? 'Custom' : ''),
    sub_type: d.sub_type ?? null,
    checks: d.checks || [],
    checks_count: d.checks_count ?? 0,
    overall_status: d.overall_status || 'manual',
  } : custom ? {
    control_id: custom.code,
    title: custom.name || custom.code,
    description: custom.statement || '',
    category: custom.domain || 'Custom',
    sub_type: custom.control_sub_type || null,
    checks: [],
    checks_count: 0,
    overall_status: 'manual',
  } : undefined;
  const isCustom = !!(d?.custom || custom?.custom || (!d && custom));
  const bindingSource: BindingSource | undefined = d?.binding_source || undefined;
  const boundCheckIds = useMemo(
    () => custom?.bound_check_ids || d?.bound_check_ids || EMPTY_CHECK_IDS,
    [custom?.bound_check_ids, d?.bound_check_ids],
  );
  const reqGroups = d?.requirement_groups ?? [];
  const scopeFws = d?.scope_frameworks ?? [];

  useEffect(() => {
    const ids = custom?.implements_scf_ids || d?.implements_scf_ids || [];
    setImplementsDraft(ids.join('\n'));
  }, [custom?.implements_scf_ids, d?.implements_scf_ids]);

  const invalidateControl = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['automation-common'] }),
      qc.invalidateQueries({ queryKey: ['automation-common-detail', code] }),
      qc.invalidateQueries({ queryKey: ['scf-custom-control', code] }),
      qc.invalidateQueries({ queryKey: ['control-links', code] }),
    ]);
  };

  const updateCustom = useMutation({
    // One call: the control's own fields, its register profile, owner and
    // priority, its SCF mappings and its links. Link types that were present
    // before the edit are sent even when now empty, so removals apply.
    mutationFn: async (v: CustomControlFormValues) =>
      scfApi.updateCustomControl(code, toWriteBody(v, Array.from(new Set(linkedRecords.map((r) => r.type))))),
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

  if (detailQ.isLoading || (detailQ.isError && customDetailQ.isLoading)) {
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

  const lastTested = control.checks
    .map((c) => c.last_run?.started_at)
    .filter(Boolean)
    .sort()
    .pop();
  const evidence = control.checks.filter((c) => c.last_run);
  const linkedRecords: LinkedRecord[] = linksQ.data ?? [];
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'assurance', label: 'Assurance' },
    { id: 'evidence', label: 'Evidence', count: evidence.length + (attachedQ.data?.items.length ?? 0) },
    { id: 'tests', label: 'Tests', count: d?.test_groups?.length ?? control.checks.length },
    { id: 'artifacts', label: 'Artifacts', count: artifactsTabQ.data?.items.length ?? 0 },
    { id: 'risks', label: 'Risks', count: risksQ.data?.items.length ?? 0 },
    { id: 'assets', label: 'Assets', count: assetsTabQ.data?.items.length ?? 0 },
    { id: 'links', label: 'Linked records', count: linkedRecords.length },
    { id: 'requirements', label: 'Requirements', count: d?.requirement_count ?? 0 },
    { id: 'history', label: 'History' },
  ];

  const cadence = d?.conformity_cadence || d?.implementation?.conformity_cadence || custom?.conformity_cadence;
  const designation = d?.designation && d.designation !== 'not_assessed' ? d.designation.replace(/_/g, ' ') : null;
  const scopeNames = scopeFws.map((f) => f.label).join(', ');
  const statement = d?.description || custom?.statement || control.description;
  const question = d?.control_question || '';

  // Related controls, each with the reason it is related.
  const related = d?.related && !Array.isArray(d.related) ? d.related : null;
  const relatedRows = [
    ...(related?.family ?? []).map((c) => ({ id: c.control_id, title: c.title, why: 'Same control family' })),
    ...(related?.by_requirements ?? []).map((c) => ({
      id: c.control_id, title: c.title,
      why: c.requirements?.length ? `Shares ${c.requirements.join(', ')}` : `Shares ${c.shared} requirement${c.shared === 1 ? '' : 's'}`,
    })),
  ];

  // What to collect: the in-scope frameworks' own asks; with nothing in scope,
  // the consolidated set across frameworks.
  const ev = d?.evidence;
  const collect = ev?.required
    ? ev.required.map((a) => ({ name: a.name, method: a.collection_method }))
    : ev?.consolidated?.length
      ? ev.consolidated.map((a) => ({ name: a.name, method: a.collection_method }))
      : (ev?.manual ?? []).map((m) => ({ name: m.name || 'Evidence', method: 'manual' }));

  const cmmActual = d?.cmm_actual ?? null;
  const cmmTarget = d?.cmm_target ?? d?.cmm_target_default ?? 3;
  const targetCriteria = Object.entries(d?.implementation?.maturity_levels ?? {})
    .find(([k]) => new RegExp(`Level\\s*${cmmTarget}\\b`).test(k))?.[1] ?? '';
  const methodCount = collect.reduce<Record<string, number>>((acc, a) => { acc[a.method] = (acc[a.method] || 0) + 1; return acc; }, {});

  const checkCounts = control.checks.reduce<Record<string, number>>((acc, c) => {
    const s = c.last_run?.status || 'not_run'; acc[s] = (acc[s] || 0) + 1; return acc;
  }, {});
  const cov = d?.coverage;

  const profile = d?.profile || (custom?.profile as CustomControlProfile | undefined);
  const dateOnly = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
  const editInitial: Partial<CustomControlFormValues> = {
    code: control.control_id,
    name: custom?.name || control.title || '',
    statement: custom?.statement || d?.description || control.description || '',
    domain: custom?.domain || d?.domain || '',
    pptdf: custom?.pptdf || d?.implementation?.pptdf || '',
    conformity_cadence: custom?.conformity_cadence
      || d?.implementation?.conformity_cadence
      || 'Annual',
    control_sub_type: custom?.control_sub_type || control.sub_type || 'Manual',
    implements_scf_ids: custom?.implements_scf_ids || d?.implements_scf_ids || [],
    category: profile?.category || '',
    sub_category: profile?.sub_category || '',
    control_type: profile?.control_type || '',
    operating_frequency: profile?.operating_frequency || '',
    department_id: profile?.department_id ?? null,
    backup_owner_id: profile?.backup_owner_id ?? null,
    owner_user_id: d?.owner_user_id ?? null,
    reviewer_user_id: d?.reviewer_user_id ?? null,
    priority: d?.priority || 'medium',
    is_key_control: !!d?.is_key_control,
    regulatory_source: profile?.regulatory_source || '',
    effective_date: dateOnly(profile?.effective_date),
    review_date: dateOnly(profile?.review_date),
    objective: (custom?.objective as string | undefined) || d?.implementation?.objective || '',
    implementation_guidance: (custom?.implementation_guidance as string | undefined)
      || d?.implementation?.guidance || '',
    testing_guidance: (custom?.testing_guidance as string | undefined)
      || d?.implementation?.testing_guidance || '',
    recommended_evidence: ((custom?.recommended_evidence as CustomControlFormValues['recommended_evidence'])
      || (d?.evidence?.authored as CustomControlFormValues['recommended_evidence'])
      || []),
    links: linkedRecords,
  };

  return (
    <div className="mx-auto max-w-[1400px] px-1 py-1">
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs">
        <Link href={backHref} className="text-slate-400 hover:text-slate-700">Common controls</Link>
        <ChevronRight className="h-3 w-3 text-slate-300" />
        <span className="font-medium text-slate-600">{control.control_id}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CodeChip code={control.control_id} />
            {isCustom && <CustomBadge />}
            <ControlStatusPill status={control.overall_status} />
            {d?.is_material && (
              <span title="SCF weights this as a material control" className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Material
              </span>
            )}
          </div>
          <h1 className="mt-1.5 text-xl font-bold leading-snug text-slate-900 sm:text-2xl">{control.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-slate-500">
            {control.category && (
              <span className="inline-flex items-center gap-1.5"><FolderTree className="h-3.5 w-3.5 text-slate-400" />{control.category}</span>
            )}
            {control.sub_type && (
              <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-slate-400" />{control.sub_type}</span>
            )}
            {cadence && (
              <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 text-slate-400" />Reassess {String(cadence).toLowerCase()}</span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              {lastTested ? `Tested ${new Date(lastTested).toLocaleDateString()}` : 'Not tested yet'}
            </span>
            {reqGroups.map((g) => (
              <button key={g.framework} type="button" onClick={() => setTab('requirements')}
                title={`${g.count} ${g.label} requirement${g.count === 1 ? '' : 's'}`}
                className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: frameworkColor(g.framework) }} />
                {g.label}
                <span className="tabular-nums text-slate-400">{g.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isCustom && (
            <>
              <LifecycleActions code={code} profile={d?.profile} onDone={() => { void invalidateControl(); }} />
              <button type="button" onClick={() => setEditOpen(true)}
                className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Edit
              </button>
              <button type="button" disabled={retireCustom.isPending}
                onClick={() => { if (confirm(`Retire custom control ${code}? It will leave the active library.`)) retireCustom.mutate(); }}
                className="inline-flex h-8 items-center rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                {retireCustom.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Retire'}
              </button>
            </>
          )}
          {control.checks.length > 0 && (
            <button onClick={runTest} disabled={runningAll} title="Run every automated test linked to this control"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {runningAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run tests
            </button>
          )}
        </div>
      </header>

      <div className="mt-3">
        <PropertiesBar
          code={code}
          ownerId={d?.owner_user_id ?? null}
          reviewerId={d?.reviewer_user_id ?? null}
          assignedIds={d?.assigned_user_ids ?? null}
          nextDueAt={d?.next_due_at ?? null}
          onSaved={() => { void qc.invalidateQueries({ queryKey: ['automation-common'] }); }}
          facts={[
            { label: 'Assurance', value: <span className="capitalize">{designation || 'Not assessed'}</span>, muted: !designation },
            { label: 'Automated checks', value: control.checks_count ? `${control.checks_count} linked` : 'None', muted: !control.checks_count },
            { label: 'Origin', value: isCustom ? 'Custom' : `SCF ${d?.release ?? ''}`.trim() },
          ]}
        />
      </div>

      <nav aria-label="Sections" role="tablist" className="mb-4 mt-3 flex gap-0.5 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)}
              className={`relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[13px] font-medium transition-colors ${active ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}>
              {t.label}
              {!!t.count && (
                <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${active ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'}`}>
                  {t.count}
                </span>
              )}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-600" />}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 space-y-4">
        {tab === 'overview' && (
          <>
            {(d?.inheritance_type || d?.exception_id != null) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2 text-[12px] text-slate-600">
                {d?.inheritance_type && (
                  <span>
                    Inherited from vendor
                    <span className="ml-1 font-medium text-slate-800">
                      ({d.inheritance_type}{d.provider_vendor_id != null ? ` · vendor #${d.provider_vendor_id}` : ''})
                    </span>
                  </span>
                )}
                {d?.exception_id != null && (
                  <span>
                    Exception #{d.exception_id}
                    {d.alternative_scf_id ? ` · alternative ${d.alternative_scf_id}` : ''}
                  </span>
                )}
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <SummaryCard title="Control statement" className="md:col-span-2"
                action={statement && (statement.length > 320 || question.length > 140) ? 'Read in full' : undefined}
                onAction={() => setPanel('statement')}>
                {statement ? (
                  <p className="line-clamp-4 text-sm leading-relaxed text-slate-700">{statement}</p>
                ) : (
                  <p className="text-sm italic text-slate-400">No statement published for this control.</p>
                )}
                {question && (
                  <p className="mt-2.5 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[13px] italic leading-relaxed text-slate-500">{question}</p>
                )}
                {reqGroups.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {reqGroups.map((g) => (
                      <span key={g.framework} className="inline-flex min-w-0 items-center gap-1">
                        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: frameworkColor(g.framework) }} />
                        <span className="font-medium text-slate-700">{g.label}</span>
                        <span className="truncate font-mono text-[10px]">
                          {[...g.items].sort((a, b) => byCode(a.code, b.code)).slice(0, 6).map((i) => i.code).join(' · ')}
                          {g.items.length > 6 ? ` +${g.items.length - 6}` : ''}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </SummaryCard>

              <SummaryCard title="Related controls" meta={relatedRows.length ? String(relatedRows.length) : undefined}
                action={relatedRows.length > 4 ? `View all ${relatedRows.length}` : undefined} onAction={() => setPanel('related')}>
                {relatedRows.length ? (
                  <ul className="space-y-2">
                    {relatedRows.slice(0, 4).map((c) => (
                      <li key={c.id} className="min-w-0">
                        <Link href={`/automation/soc2-controls/${c.id}`} className="group flex items-center gap-2">
                          <CodeChip code={c.id} className="shrink-0 group-hover:bg-primary-600 group-hover:text-white" />
                          <span className="min-w-0 truncate text-[12px] text-slate-700 group-hover:text-slate-900">{c.title}</span>
                        </Link>
                        <p className="mt-0.5 truncate text-[10px] text-slate-400">{c.why}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] leading-relaxed text-slate-500">
                    {scopeFws.length ? `No other in-scope control shares ${scopeNames} requirements with this one.` : 'No related controls.'}
                  </p>
                )}
              </SummaryCard>

              <SummaryCard title="What to collect" meta={collect.length ? String(collect.length) : undefined}
                action={collect.length ? 'View evidence list' : undefined} onAction={() => setPanel('evidence')}>
                {collect.length ? (
                  <>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <Tally n={methodCount.manual || 0} label=" uploaded by hand" dot={METHOD_DOT.manual} />
                      <Tally n={methodCount.hybrid || 0} label=" hybrid" dot={METHOD_DOT.hybrid} />
                      <Tally n={methodCount.automated || 0} label=" from a collector" dot={METHOD_DOT.automated} />
                    </div>
                    <ul className="mt-2.5 space-y-1.5">
                      {collect.slice(0, 4).map((a, i) => (
                        <li key={`${a.name}-${i}`} className="flex items-center gap-2 text-[12px] text-slate-700">
                          <span className={`size-1.5 shrink-0 rounded-full ${METHOD_DOT[a.method] || METHOD_DOT.manual}`} />
                          <span className="min-w-0 truncate">{a.name}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-slate-500">
                    {scopeFws.length ? `${scopeNames} name no specific evidence for this control.` : 'No evidence is defined for this control.'}
                  </p>
                )}
              </SummaryCard>

              <SummaryCard title="Automated testing"
                meta={control.checks.length ? `${control.checks.length} test${control.checks.length === 1 ? '' : 's'}` : undefined}
                action={control.checks.length ? 'Open tests' : cov?.state === 'connect_one' ? 'See sources and tests' : undefined}
                onAction={() => setTab('tests')}>
                {control.checks.length ? (
                  <>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <Tally n={checkCounts.passed || 0} label=" passing" dot="bg-emerald-500" />
                      <Tally n={checkCounts.failed || 0} label=" failing" dot="bg-rose-500" />
                      <Tally n={(checkCounts.not_run || 0) + (checkCounts.error || 0) + (checkCounts.collection_failed || 0)} label=" not run" dot="bg-slate-300" />
                    </div>
                    {cov?.satisfied_by?.length ? (
                      <p className="mt-2.5 text-[12px] text-slate-600">Evidenced by {cov.satisfied_by.join(', ')}</p>
                    ) : null}
                    <div className="mt-2"><BindingSourceCaption source={bindingSource} /></div>
                  </>
                ) : cov?.state === 'connect_one' ? (
                  <p className="text-[13px] leading-relaxed text-slate-600">
                    Automatable. Connect any <span className="font-semibold">one</span> of {cov.provider_count} sources and its results count here.
                  </p>
                ) : cov?.state === 'unbound' ? (
                  <p className="text-[13px] leading-relaxed text-slate-600">
                    A machine could assess this control, but no check reaches it yet. That is a gap in what is built, not a manual control.
                  </p>
                ) : (
                  <p className="text-[13px] leading-relaxed text-slate-600">
                    Manual control. No collector can prove it, so evidence is uploaded by hand.
                  </p>
                )}
              </SummaryCard>

              {isCustom && d && <RegisterCard d={d} />}

              <SummaryCard title="How to implement" meta={d?.implementation ? `Target: level ${cmmTarget}` : undefined}
                action={d?.implementation ? 'Rate maturity and read guidance' : undefined} onAction={() => setPanel('implement')}>
                {d?.implementation ? (
                  <>
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="text-slate-500">Operates at</span>
                      <span className={cmmActual == null ? 'text-slate-400' : 'font-semibold text-slate-800'}>
                        {cmmActual == null ? 'Not rated' : `Level ${cmmActual} · ${LEVELS[cmmActual]?.name}`}
                      </span>
                    </div>
                    <div className="mt-1.5"><MaturityMeter current={cmmActual} target={cmmTarget} /></div>
                    {targetCriteria && (
                      <p className="mt-2.5 line-clamp-3 text-[12px] leading-relaxed text-slate-600">
                        <span className="font-medium text-slate-700">Level {cmmTarget} means: </span>
                        {targetCriteria.split('\n')[0]}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-slate-500">No maturity guidance published for this control.</p>
                )}
              </SummaryCard>
            </div>

            {isCustom && (
              <AttachedChecksPanel code={code} initialIds={boundCheckIds} onSaved={() => { void invalidateControl(); }} />
            )}

            <DetailPanel open={panel === 'statement'} onClose={() => setPanel(null)} title="Control statement" subtitle={control.control_id}>
              <p className="text-sm leading-relaxed text-slate-700">{statement}</p>
              {question && (
                <p className="mt-4 border-l-2 border-slate-200 pl-3 text-[13px] italic leading-relaxed text-slate-500">{question}</p>
              )}
            </DetailPanel>
            <DetailPanel open={panel === 'related'} onClose={() => setPanel(null)} title="Related controls"
              subtitle={scopeFws.length ? `In-scope controls only · ${scopeNames}` : undefined}>
              <ul className="divide-y divide-slate-100">
                {relatedRows.map((c) => (
                  <li key={c.id} className="py-2.5">
                    <Link href={`/automation/soc2-controls/${c.id}`} className="group flex items-center gap-2">
                      <CodeChip code={c.id} className="shrink-0 group-hover:bg-primary-600 group-hover:text-white" />
                      <span className="min-w-0 truncate text-[13px] font-medium text-slate-800 group-hover:text-primary-700">{c.title}</span>
                    </Link>
                    <p className="mt-1 text-[11px] text-slate-500">{c.why}</p>
                  </li>
                ))}
              </ul>
            </DetailPanel>
            <DetailPanel open={panel === 'evidence'} onClose={() => setPanel(null)} title="What to collect" wide
              subtitle={scopeFws.length ? `What ${scopeNames} ask for, and what is already linked` : undefined}>
              <EvidenceWorkspace code={code} />
            </DetailPanel>
            <DetailPanel open={panel === 'implement'} onClose={() => setPanel(null)} title="How to implement" wide
              subtitle={d?.implementation?.maturity_from && isCustom
                ? `Written for this control, with the capability criteria published for ${d.implementation.maturity_from}.`
                : 'SCF capability maturity: where this control operates today, where it should be, and what each level takes.'}>
              {(d?.implementation?.guidance || d?.implementation?.testing_guidance) && (
                <div className="mb-4 space-y-3">
                  {d?.implementation?.guidance && (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Implementation guidance</p>
                      <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{d.implementation.guidance}</p>
                    </div>
                  )}
                  {d?.implementation?.testing_guidance && (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Testing guidance</p>
                      <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{d.implementation.testing_guidance}</p>
                    </div>
                  )}
                </div>
              )}
              {d?.implementation && (
                <MaturityPanel code={code} levels={d.implementation.maturity_levels} solutions={d.implementation.solutions}
                  cadence={d.implementation.conformity_cadence} pptdf={d.implementation.pptdf}
                  cmmActual={cmmActual} cmmTarget={d.cmm_target ?? null} targetDefault={d.cmm_target_default ?? 3}
                  designation={d.designation} />
              )}
            </DetailPanel>
          </>
        )}

        {tab === 'tests' && (
          <AutomatedTests
            code={code}
            groups={d?.test_groups ?? []}
            connectionId={awsConnectionId}
            bindingSource={bindingSource}
            bindingVia={d?.binding_via ?? []}
            onRan={() => {
              qc.invalidateQueries({ queryKey: ['automation-common-detail', code] });
              qc.invalidateQueries({ queryKey: ['automation-common'] });
            }}
          />
        )}

        {tab === 'artifacts' && <ControlArtifactsPanel code={code} />}

        {tab === 'risks' && <ControlRisksPanel code={code} />}

        {tab === 'assets' && <ControlAssetsPanel code={code} />}

        {tab === 'links' && <LinkedRecordsPanel code={code} />}

        {tab === 'requirements' && (
          <>
            {isCustom && (
              <Panel title="Edit mappings" action={<span className="text-xs text-slate-400">SCF ids this control implements</span>}>
                <p className="mb-2 text-[12px] leading-relaxed text-slate-500">
                  One SCF id per line (e.g. GOV-01). This control then discharges those controls&rsquo; framework
                  requirements, and inherits their capability criteria and deliverables.
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
            <Panel
              title="Requirements"
              action={<span className="text-xs text-slate-400">{scopeFws.length ? `What ${scopeNames} require of this control` : 'Every framework obligation this control discharges'}</span>}
            >
              {reqGroups.length ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-700">{d?.requirement_count}</span> requirement{d?.requirement_count === 1 ? '' : 's'} across{' '}
                    <span className="font-semibold tabular-nums text-slate-700">{d?.framework_count}</span> {scopeFws.length ? 'in-scope ' : ''}framework{d?.framework_count === 1 ? '' : 's'}
                    <span className="text-slate-400"> · crosswalked via SCF {d?.release}</span>
                  </p>
                  {!scopeFws.length && (d?.framework_count ?? 0) > 10 && (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                      This control appears in <span className="font-semibold text-slate-700">{d?.framework_count}</span> frameworks
                      because many of them restate the same underlying obligation. A high count is crosswalk breadth,
                      not extra assurance. Choose your frameworks under Scope to see only the ones you are assessed against.
                    </p>
                  )}
                  {reqGroups.map((g) => (
                    <RequirementGroup key={g.framework} g={g} defaultOpen={reqGroups.length <= 2} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  {isCustom
                    ? 'No framework requirements yet. Add the SCF ids this control implements above, or map it to framework controls directly.'
                    : scopeFws.length
                      ? `None of your in-scope frameworks (${scopeNames}) require this control.`
                      : 'No framework requirement maps to this control.'}
                </div>
              )}
            </Panel>
          </>
        )}

        {tab === 'evidence' && (
          <ControlEvidencePanel
            code={code}
            mode={d?.assurance_mode}
            collected={evidence}
            workspace
          />
        )}

        {tab === 'assurance' && <AssuranceTab code={code} objectives={d?.objectives ?? []} note={d?.objectives_note} />}

        {tab === 'history' && <HistoryPanel code={code} />}
      </div>

      <AnimatedModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit custom control"
        subtitle={`${control.control_id} · ${control.title}`}
        size="3xl"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setEditOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" form="edit-custom-control" disabled={updateCustom.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50">
              {updateCustom.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {updateCustom.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      >
        <CustomControlForm
          key={editOpen ? 'open' : 'closed'}
          formId="edit-custom-control"
          hideActions
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
