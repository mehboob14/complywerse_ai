'use client';

/**
 * The tab panels of the risk page: Overview, Assessment (edited in place), Controls, Linked records, Treatment and History. Each draws what the server returned and keeps nothing of
 * its own but a draft: every save goes through the page's reported mutations (the page owns them), so a refused link or save says so in words, and a request that failed is said where
 * its rows would be, never drawn as an empty list. A record somebody linked is a row with a link to it and an "Unlink <name>" button (a real, named, 44px-on-a-phone target).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Building2, FileText, Link2, Plus, Save, Shield, Target, Unlink, X } from 'lucide-react';
import {
  Button, ClampedText, ErrorState, Fact, FactList, FormField, IconButton, Notice, ReadOnlyNote, Select, SkeletonRows, StatusPill, Textarea, TitleLink,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EMPTY, formatDate, formatDateTime } from '@/lib/format';
import { statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { controlIndicator, riskActionStatus, riskLevel, riskTreatment } from '@/lib/statuses/risk';
import { BUCKET_LABEL, STATUS_BUCKETS, type Band } from '../../_register/riskModel';
import { registerFields } from '../../_register/RiskDrawer';
import { assessmentProblem, draftScores, riskReduction, sameAssessment, type Assessment, type HistoryItem } from './riskPageModel';

// ── the record, as the page reads it ─────────────────────────────────────────────────────────────────────────────────────

export interface PageRisk {
  id: number;
  title: string;
  description?: string | null;
  category?: string | null;
  risk_category?: string | null;
  risk_sub_category?: string | null;
  register_type?: string | null;
  status?: string | null;
  priority?: string | null;
  effective_priority?: string | null;
  owner_id?: number | null;
  owner_name?: string | null;
  business_owner_id?: number | null;
  business_owner_name?: string | null;
  business_unit_name?: string | null;
  inherent_likelihood?: number | null; inherent_impact?: number | null; inherent_score?: number | null;
  residual_likelihood?: number | null; residual_impact?: number | null; residual_score?: number | null;
  risk_appetite?: string | null;
  treatment_plan?: string | null;
  root_cause?: string | null; consequences?: string | null; recommendations?: string | null;
  due_date?: string | null; review_date?: string | null; created_at: string; updated_at: string;
  source_label?: string | null; source_type?: string | null;
  template_fields?: Record<string, unknown> | null;
  sla?: { state?: string | null; days_overdue?: number | null; due_in_days?: number | null } | null;
  actions_total?: number; actions_open?: number;
  linked_controls?: Array<{ id: number; control_id: number; code: string; name: string; control_status?: string | null; custom?: boolean; scf_id?: string | null }>;
  linked_internal_controls?: Array<{ id: number; name?: string; title?: string; status?: string; link_id: number; control_id?: string }>;
  linked_framework_controls?: Array<{ id: number; framework_control_id: number; code: string; name: string; mitigation_effectiveness?: string; notes?: string }>;
  linked_framework_requirements?: Array<{ id: number; framework_id: number; framework_name: string | null; parsed_control_id: number; code: string; title: string | null; domain: string | null; mitigation_effectiveness?: string; notes?: string | null }>;
  linked_assets?: Array<{ id: number; asset_id: number; name: string; asset_type: string }>;
  linked_evidence?: Array<{ id: number; evidence_id: number; name: string; status: string }>;
  linked_governance?: Array<{ id: number; governance_objective_id: number; name: string; impact_level: string }>;
}

export interface QueryState<T> { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

const LIST = 'm-0 list-none p-0';
const ROW = 'flex min-h-[52px] items-center gap-[8px] border-b border-ds-border py-[6px] last:border-b-0';

function Section({ title, count, actions, children }: { title: string; count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-[20px] last:mb-0">
      <div className="mb-[4px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">{title}{count != null && <span className="ml-[6px] font-normal text-ds-fg-muted">{count}</span>}</h3>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-[8px]">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function None({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-ds-control border border-dashed border-ds-border-strong px-[12px] py-[12px] text-ds-body text-ds-fg-muted">{children}</p>;
}

/** One linked record: its name (a link when it has a page), a line under it, a badge, and Unlink for the person who may. */
function LinkRow({ href, icon: Icon, title, sub, badge, onUnlink, busy }: { href?: string; icon: React.ElementType; title: string; sub?: ReactNode; badge?: ReactNode; onUnlink?: () => void; busy?: boolean }) {
  return (
    <li className={ROW}>
      <Icon aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-[8px]">
          {href ? <TitleLink href={href} title={title} lines={2} tone="title" size="body" /> : <span dir="auto" className="min-w-0 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{title}</span>}
          {badge}
        </div>
        {sub && <div className="text-ds-label text-ds-fg-muted">{sub}</div>}
      </div>
      {onUnlink && <IconButton label={`Unlink ${title}`} disabled={busy} onClick={onUnlink}><Unlink aria-hidden /></IconButton>}
    </li>
  );
}

const effectiveness = (v?: string | null): string => (v ? `${statusLabel(v)} mitigation` : '');

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function OverviewPanel({ risk, issues }: { risk: PageRisk; issues: ReactNode }) {
  const fields = registerFields(risk.template_fields);
  const text = (title: string, value?: string | null) => (value ? <Section title={title}><ClampedText text={value} lines={6} /></Section> : null);
  return (
    <div>
      <Section title="Description">{risk.description ? <ClampedText text={risk.description} lines={6} /> : <None>No description yet. Edit the risk to add one.</None>}</Section>
      {text('Root cause', risk.root_cause)}
      {text('Consequences', risk.consequences)}
      {text('Recommendations', risk.recommendations)}
      {fields.length > 0 && (
        <Section title={`${risk.register_type ? `${risk.register_type} register` : 'Register'} fields`}>
          <FactList min={220}>{fields.map((f) => <Fact key={f.label} label={f.label}>{f.value}</Fact>)}</FactList>
        </Section>
      )}
      <Section title="Dates and source">
        <FactList min={160}>
          <Fact label="Due">{risk.due_date ? formatDate(risk.due_date) : null}</Fact>
          <Fact label="Review date" empty="Not scheduled">{risk.review_date ? formatDate(risk.review_date) : null}</Fact>
          <Fact label="Added">{formatDate(risk.created_at)}</Fact>
          <Fact label="Last changed">{formatDate(risk.updated_at)}</Fact>
          <Fact label="Source">{risk.source_label}</Fact>
          <Fact label="Business unit" empty="Not set">{risk.business_unit_name}</Fact>
        </FactList>
      </Section>
      {issues}
    </div>
  );
}

// ── Assessment ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const SCALE = [1, 2, 3, 4, 5];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

export interface AssessmentProps {
  risk: PageRisk;
  start: Assessment;
  people: Array<{ id: number; display_name: string; email?: string }>;
  peopleFailed: boolean;
  canEdit: boolean;
  saving: boolean;
  error: string | null;
  aboveAppetite: { limit: number } | null;
  onSave: (was: Assessment, now: Assessment) => void;
}

function ScoreSelects({ label, l, i, onL, onI, disabled, open }: { label: string; l: string; i: string; onL: (v: string) => void; onI: (v: string) => void; disabled: boolean; open: boolean }) {
  // a score that is set can be changed but not cleared (the server has no way to unset one): the "Not scored" choice is offered only while there is none
  const none = open ? 'Not scored' : undefined;
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-[4px] p-0 text-ds-body font-[600] text-ds-fg">{label}</legend>
      <div className="grid grid-cols-2 gap-[8px]">
        <FormField label="Likelihood"><Select value={l} disabled={disabled} onChange={(e) => onL(e.target.value)} placeholder={none}>{SCALE.map((n) => <option key={n} value={String(n)}>{n}</option>)}</Select></FormField>
        <FormField label="Impact"><Select value={i} disabled={disabled} onChange={(e) => onI(e.target.value)} placeholder={none}>{SCALE.map((n) => <option key={n} value={String(n)}>{n}</option>)}</Select></FormField>
      </div>
    </fieldset>
  );
}

export function AssessmentPanel({ risk, start, people, peopleFailed, canEdit, saving, error, aboveAppetite, onSave }: AssessmentProps) {
  const [draft, setDraft] = useState<Assessment>(start);
  // what the server holds changed under the form (a save, a review): the draft starts again from it, unless the person is mid-edit
  const [seen, setSeen] = useState(start);
  if (!sameAssessment(seen, start)) { setSeen(start); setDraft(start); }
  const dirty = !sameAssessment(draft, start);
  const problem = assessmentProblem(draft, start);
  const scores = draftScores(draft);
  const reduction = riskReduction(scores.inherent, scores.residual);
  const set = (patch: Partial<Assessment>) => setDraft((d) => ({ ...d, ...patch }));
  const statusOptions = useMemo(() => {
    const words: string[] = STATUS_BUCKETS.slice();
    if (draft.status && !words.includes(draft.status)) words.push(draft.status);
    return words;
  }, [draft.status]);
  const peopleOptions = people.map((p) => <option key={p.id} value={String(p.id)}>{p.display_name || p.email}</option>);
  return (
    <div>
      {!canEdit && <div className="mb-[12px]"><ReadOnlyNote>View only</ReadOnlyNote></div>}
      {aboveAppetite && (
        <Notice tone="warning" title="Above the risk appetite" className="mb-[12px]">
          The residual score is over the limit of {aboveAppetite.limit} set for this category.
        </Notice>
      )}
      <div className="grid gap-[16px] md:grid-cols-2">
        <ScoreSelects label="Inherent score" l={draft.inherentL} i={draft.inherentI} onL={(v) => set({ inherentL: v })} onI={(v) => set({ inherentI: v })} disabled={!canEdit} open={start.inherentL === ''} />
        <ScoreSelects label="Residual score" l={draft.residualL} i={draft.residualI} onL={(v) => set({ residualL: v })} onI={(v) => set({ residualI: v })} disabled={!canEdit} open={start.residualL === ''} />
      </div>
      <p className="mb-0 mt-[8px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-body text-ds-fg-body" aria-live="polite">
        <span>Inherent <b className="tabular-nums">{scores.inherent ?? EMPTY}</b></span>
        <span>Residual <b className="tabular-nums">{scores.residual ?? EMPTY}</b></span>
        {reduction != null && <span>Reduced by <b className="tabular-nums">{reduction}%</b></span>}
        <StatusPill size="sm" {...statusPill(riskLevel, scores.band as Band)} />
      </p>
      <div className="mt-[16px] grid gap-[12px] md:grid-cols-2">
        <FormField label="Status"><Select value={draft.status} disabled={!canEdit} onChange={(e) => set({ status: e.target.value })}>{statusOptions.map((w) => <option key={w} value={w}>{BUCKET_LABEL[w as keyof typeof BUCKET_LABEL] ?? statusLabel(w)}</option>)}</Select></FormField>
        <FormField label="Priority" hint="Auto follows the score band."><Select value={draft.priority} disabled={!canEdit} onChange={(e) => set({ priority: e.target.value })} placeholder="Auto">{PRIORITIES.map((p) => <option key={p} value={p}>{statusLabel(p)}</option>)}</Select></FormField>
        <FormField label="Risk owner" hint="Counts toward the Ownership score." error={peopleFailed ? 'The list of people could not be loaded.' : undefined}>
          <Select value={draft.ownerId} disabled={!canEdit} onChange={(e) => set({ ownerId: e.target.value })} placeholder="Unassigned">{peopleOptions}</Select>
        </FormField>
        <FormField label="Business owner"><Select value={draft.businessOwnerId} disabled={!canEdit} onChange={(e) => set({ businessOwnerId: e.target.value })} placeholder="Unassigned">{peopleOptions}</Select></FormField>
      </div>
      {(problem || error) && <Notice tone="danger" className="mt-[12px]" title={problem ? 'Not saved yet' : 'The changes were not saved'}>{problem || error}</Notice>}
      {canEdit && (
        <div className="mt-[16px] flex flex-wrap items-center gap-[8px]">
          <Button variant="primary" leftIcon={<Save aria-hidden />} loading={saving} disabled={!dirty || !!problem} onClick={() => onSave(start, draft)}>Save changes</Button>
          <Button disabled={!dirty || saving} onClick={() => setDraft(start)}>Discard</Button>
          {dirty && <span role="status" className="text-ds-label text-ds-fg-muted">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ControlsProps {
  risk: PageRisk;
  canLink: boolean;
  canUnlink: boolean;
  canLinkRequirement: boolean;
  busy: boolean;
  onLinkControl: () => void;
  onLinkRequirement: () => void;
  onUnlinkInternal: (controlId: number, linkId: number) => void;
  onUnlinkControl: (linkId: number) => void;
  onUnlinkFramework: (linkId: number) => void;
  onUnlinkRequirement: (linkId: number) => void;
}

export function ControlsPanel(p: ControlsProps) {
  const { risk } = p;
  const internal = risk.linked_internal_controls ?? [];
  const scf = risk.linked_controls ?? [];
  const legacy = risk.linked_framework_controls ?? [];
  const reqs = risk.linked_framework_requirements ?? [];
  const none = internal.length + scf.length + legacy.length + reqs.length === 0;
  const href = (c: { control_id: number; scf_id?: string | null }) => (c.scf_id ? `/automation/soc2-controls/${encodeURIComponent(c.scf_id)}` : `/control-library/${c.control_id}`);
  return (
    <div>
      <div className="mb-[12px] flex flex-wrap gap-[8px]">
        {p.canLink && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={p.onLinkControl}>Link a control</Button>}
        {p.canLinkRequirement && <Button leftIcon={<Link2 aria-hidden />} onClick={p.onLinkRequirement}>Link a framework control</Button>}
      </div>
      {none && <None>No controls are linked. Link the controls that treat this risk to see how well it is covered.</None>}
      {internal.length > 0 && (
        <Section title="Internal controls" count={internal.length}>
          <ul className={LIST}>
            {internal.map((c) => (
              <LinkRow key={`i-${c.link_id}`} href={`/erm/internal-controls/${c.id}`} icon={Shield} title={c.name || c.title || 'A control'} sub={[c.control_id || '', c.status ? statusLabel(c.status) : ''].filter(Boolean).join(' · ')}
                onUnlink={p.canUnlink ? () => p.onUnlinkInternal(Number(c.id), c.link_id) : undefined} busy={p.busy} />
            ))}
          </ul>
        </Section>
      )}
      {scf.length > 0 && (
        <Section title="Controls from the library" count={scf.length}>
          <ul className={LIST}>
            {scf.map((c) => (
              <LinkRow key={`n-${c.id}`} href={href(c)} icon={Shield} title={c.name} sub={c.scf_id || c.code}
                badge={<>{c.custom && <StatusPill size="sm" tone="neutral" label="Custom" />}{c.control_status && <StatusPill size="sm" {...statusPill(controlIndicator, c.control_status)} />}</>}
                onUnlink={p.canUnlink ? () => p.onUnlinkControl(c.id) : undefined} busy={p.busy} />
            ))}
          </ul>
          <p className="mb-0 mt-[4px] text-ds-label text-ds-fg-muted">A control&apos;s status is an indicator. It does not change the residual score.</p>
        </Section>
      )}
      {reqs.length > 0 && (
        <Section title="Framework controls" count={reqs.length}>
          <ul className={LIST}>
            {reqs.map((c) => (
              <LinkRow key={`r-${c.id}`} icon={Shield} title={c.title || c.code} sub={[c.framework_name ? `${c.framework_name} · ${c.code}` : c.code, effectiveness(c.mitigation_effectiveness), c.notes || ''].filter(Boolean).join(' · ')}
                onUnlink={p.canLinkRequirement ? () => p.onUnlinkRequirement(c.id) : undefined} busy={p.busy} />
            ))}
          </ul>
        </Section>
      )}
      {legacy.length > 0 && (
        <Section title="Older framework controls" count={legacy.length}>
          <ul className={LIST}>
            {legacy.map((c) => (
              <LinkRow key={`f-${c.id}`} icon={Shield} title={c.name} sub={[c.code, effectiveness(c.mitigation_effectiveness)].filter(Boolean).join(' · ')} onUnlink={p.canUnlink ? () => p.onUnlinkFramework(c.id) : undefined} busy={p.busy} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ── Linked records: assets, evidence, documents ──────────────────────────────────────────────────────────────────────────

export interface LinkedDocument { link_id?: number; id?: number; document_id?: number; title?: string; document_title?: string; name?: string; doc_type?: string; document_type?: string; link_type?: string }

export interface LinksProps {
  risk: PageRisk;
  documents: QueryState<LinkedDocument[]>;
  canLink: boolean;
  canUnlink: boolean;
  busy: boolean;
  onLink: (kind: 'asset' | 'evidence' | 'document') => void;
  onUnlinkAsset: (linkId: number) => void;
  onUnlinkEvidence: (linkId: number) => void;
  onUnlinkDocument: (linkId: number) => void;
  onUnlinkObjective: (linkId: number) => void;
}

export function LinksPanel(p: LinksProps) {
  const { risk } = p;
  const assets = risk.linked_assets ?? [];
  const evidence = risk.linked_evidence ?? [];
  const objectives = risk.linked_governance ?? [];
  const docs = p.documents.data ?? [];
  const add = (kind: 'asset' | 'evidence' | 'document', label: string) => (p.canLink ? <Button leftIcon={<Plus aria-hidden />} onClick={() => p.onLink(kind)}>{label}</Button> : undefined);
  return (
    <div>
      <Section title="Assets" count={assets.length} actions={add('asset', 'Link an asset')}>
        {assets.length === 0 ? <None>No assets are linked. Link the IT assets this risk affects.</None> : (
          <ul className={LIST}>{assets.map((a) => <LinkRow key={a.id} href={`/assets/${a.asset_id}`} icon={Building2} title={a.name} sub={a.asset_type} onUnlink={p.canUnlink ? () => p.onUnlinkAsset(a.id) : undefined} busy={p.busy} />)}</ul>
        )}
      </Section>
      <Section title="Evidence" count={evidence.length} actions={add('evidence', 'Link evidence')}>
        {evidence.length === 0 ? <None>No evidence is linked. Link what supports this assessment.</None> : (
          <ul className={LIST}>{evidence.map((e) => <LinkRow key={e.id} href={`/evidence/${e.evidence_id}`} icon={FileText} title={e.name} badge={<StatusPill size="sm" tone="neutral" label={statusLabel(e.status)} />} onUnlink={p.canUnlink ? () => p.onUnlinkEvidence(e.id) : undefined} busy={p.busy} />)}</ul>
        )}
      </Section>
      <Section title="Documents and objectives" count={docs.length + objectives.length} actions={add('document', 'Link a document')}>
        {p.documents.isError && !p.documents.data && <ErrorState compact title="Couldn't load the linked documents" message={errorMessage(p.documents.error)} onRetry={canRetry(p.documents.error) ? () => { void p.documents.refetch(); } : undefined} />}
        {p.documents.isPending && <SkeletonRows rows={2} columns={2} label="Loading the linked documents" />}
        {!p.documents.isPending && !(p.documents.isError && !p.documents.data) && docs.length + objectives.length === 0 && <None>No documents are linked. Link the policies and procedures that treat this risk.</None>}
        {docs.length + objectives.length > 0 && (
          <ul className={LIST}>
            {docs.map((d) => (
              <LinkRow key={`d-${d.link_id ?? d.id}`} href={`/governance/documents/${d.document_id ?? d.id}`} icon={FileText} title={d.title || d.document_title || d.name || 'A document'}
                sub={[statusLabel(d.doc_type || d.document_type || 'document'), d.link_type ? statusLabel(d.link_type) : ''].filter(Boolean).join(' · ')}
                onUnlink={p.canUnlink ? () => p.onUnlinkDocument((d.link_id ?? d.id) as number) : undefined} busy={p.busy} />
            ))}
            {objectives.map((o) => <LinkRow key={`o-${o.id}`} icon={Target} title={o.name} sub={`Impact: ${statusLabel(o.impact_level)}`} onUnlink={p.canUnlink ? () => p.onUnlinkObjective(o.id) : undefined} busy={p.busy} />)}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ── Treatment ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ActionRow { id: number; title: string; status: string; priority?: string; owner_name?: string | null; due_date?: string | null; completed_at?: string | null }

export interface TreatmentProps {
  risk: PageRisk;
  treatment: 'not_started' | 'in_progress' | 'completed';
  canEdit: boolean;
  saving: boolean;
  error: string | null;
  actions: QueryState<ActionRow[]>;
  onSave: (plan: string) => void;
}

export function TreatmentPanel({ risk, treatment, canEdit, saving, error, actions, onSave }: TreatmentProps) {
  const saved = risk.treatment_plan ?? '';
  const [plan, setPlan] = useState(saved);
  const [seen, setSeen] = useState(saved);
  const [editing, setEditing] = useState(false);
  if (seen !== saved) { setSeen(saved); setPlan(saved); }          // a plan emptied elsewhere empties here too (it used to keep the old text)
  useEffect(() => { if (!saving && !error && editing && plan === saved) setEditing(false); }, [saving, error, editing, plan, saved]);
  const rows = actions.data ?? [];
  return (
    <div>
      <Section
        title="Treatment plan"
        actions={<><StatusPill size="sm" {...statusPill(riskTreatment, treatment)} />{canEdit && !editing && <Button onClick={() => setEditing(true)}>{saved ? 'Edit the plan' : 'Write the plan'}</Button>}</>}
      >
        {editing ? (
          <div className="flex flex-col gap-[8px]">
            <FormField label="Plan"><Textarea rows={8} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="What will be done, by whom and by when" /></FormField>
            {error && <Notice tone="danger" title="The plan was not saved">{error}</Notice>}
            <div className="flex flex-wrap gap-[8px]">
              <Button variant="primary" leftIcon={<Save aria-hidden />} loading={saving} onClick={() => onSave(plan)}>Save the plan</Button>
              <Button disabled={saving} leftIcon={<X aria-hidden />} onClick={() => { setPlan(saved); setEditing(false); }}>Cancel</Button>
            </div>
          </div>
        ) : saved ? <ClampedText text={saved} lines={8} /> : <None>{canEdit ? 'No treatment plan yet.' : 'No treatment plan yet. You can read the plan but not write one.'}</None>}
      </Section>

      <Section
        title="Mitigation actions"
        count={rows.length || undefined}
        actions={<TitleLink href={`/erm/mitigation-actions`} title="Manage actions" lines={1} tone="text" size="body" />}
      >
        {actions.isPending && <SkeletonRows rows={3} columns={3} label="Loading the mitigation actions" />}
        {actions.isError && !actions.data && <ErrorState compact title="Couldn't load the mitigation actions" message={errorMessage(actions.error)} onRetry={canRetry(actions.error) ? () => { void actions.refetch(); } : undefined} />}
        {!actions.isPending && !(actions.isError && !actions.data) && rows.length === 0 && <None>No mitigation actions yet. Add them on the Mitigation Actions page.</None>}
        {rows.length > 0 && (
          <ul className={LIST}>
            {rows.map((a) => (
              <li key={a.id} className={ROW}>
                <Activity aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <span dir="auto" className="block break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{a.title}</span>
                  <span className="text-ds-label text-ds-fg-muted">{[a.owner_name ? `Owner ${a.owner_name}` : 'Unassigned', a.due_date ? `due ${formatDate(a.due_date)}` : 'no due date'].join(' · ')}</span>
                </div>
                <StatusPill size="sm" {...statusPill(riskActionStatus, a.status)} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HistoryProps {
  items: HistoryItem[];
  /** the requests that feed it, each with its own state */
  feeds: Array<{ label: string; state: QueryState<unknown> }>;
}

const KIND: Record<HistoryItem['kind'], { label: string; tone: 'progress' | 'pending' | 'success' | 'warning' | 'neutral' }> = {
  score: { label: 'Score', tone: 'progress' }, review: { label: 'Review', tone: 'pending' }, action: { label: 'Action', tone: 'success' }, incident: { label: 'Incident', tone: 'warning' }, created: { label: 'Added', tone: 'neutral' },
};

export function HistoryPanel({ items, feeds }: HistoryProps) {
  const failed = feeds.filter((f) => f.state.isError && !f.state.data);
  const loading = feeds.some((f) => f.state.isPending);
  return (
    <div>
      {failed.map((f) => (
        <Notice key={f.label} tone="warning" title={`${f.label} could not be loaded`} className="mb-[8px]" action={canRetry(f.state.error) ? <Button onClick={() => { void f.state.refetch(); }}>Retry</Button> : undefined}>
          {errorMessage(f.state.error)} What it holds is not in this list.
        </Notice>
      ))}
      {loading && items.length === 0 && <SkeletonRows rows={5} columns={3} label="Loading the history" />}
      {items.length > 0 && (
        <ol className={LIST}>
          {items.map((it) => (
            <li key={it.key} className={`${ROW} items-start`}>
              <span className="mt-[2px] w-[76px] shrink-0"><StatusPill size="sm" tone={KIND[it.kind].tone} label={KIND[it.kind].label} /></span>
              <div className="min-w-0 flex-1">
                <span dir="auto" className="block break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{it.title}</span>
                {it.detail && <span className="block break-words text-ds-label text-ds-fg-muted">{it.detail}</span>}
              </div>
              <time className="shrink-0 whitespace-nowrap text-ds-label text-ds-fg-muted" dateTime={it.at}>{formatDateTime(it.at)}</time>
            </li>
          ))}
        </ol>
      )}
      {!loading && failed.length === 0 && items.length === 0 && <None>Nothing has been recorded for this risk yet.</None>}
    </div>
  );
}

