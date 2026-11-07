'use client';

/**
 * Risk Management > Risk: the record workspace. A header with the title, status, level and SLA and the people who hold the risk; a strip of the figures that matter (scores, the reduction,
 * the owners, the next review); and tabs: Overview, Assessment (the scores, status, priority and owners edited IN PLACE), Controls, Linked records, Treatment, Quantification, History.
 * "Edit all fields" opens the full form over this page (it used to jump to the register's drawer and leave the record). Every write goes through a reported mutation: a refused link,
 * save or delete says so in words, with a Retry where one makes sense. The tab, and a deep link such as ?tab=controls, live in the address.
 *
 * Who may do what follows what the server enforces today and nothing more: saving the plan needs `risks:risk_treatment:edit` (the server checks it), linking a framework control
 * `erm:risks:edit` or `erm:risks:create` (checked), quantification `risks:risk_register:edit` (checked); the other writes the server leaves to any signed-in person, so the page keeps the
 * keys it always asked for (`risks:risk_register:edit|delete` for the links, `erm:risks:edit|delete` for the record, as the register does). The gaps are in the report to the user.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileEdit, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, FactList, Fact, Menu, PersonChip, SkeletonRows, StatusPill, Tabs, TabPanel, useConfirm, useNotify, useReportedMutation, useTabParam, type ReportedMutationConfig, type TabItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { CreateIssueButton } from '@/components/issue-management/CreateIssueButton';
import { RelatedIssuesPanel } from '@/components/issue-management/RelatedIssuesPanel';
import { usePermissions } from '@/hooks/usePermissions';
import { assetsApi, controlsApi, ermApi, evidenceApi, governanceApi, risksApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel, riskSla, riskStatus } from '@/lib/statuses/risk';
import QuantificationTab from './_components/QuantificationTab';
import LinkFrameworkRequirementModal from './_components/LinkFrameworkRequirementModal';
import { RiskModal } from '../_register/RiskForm';
import { assetsNotLinked, saveRiskForm } from '../_register/riskSave';
import { RISK_REFRESH, failureWords, useAppetite, usePendingReviews, useTenantUsers } from '../_register/riskData';
import { aboveAppetite, categoryKey, categoryLabel, levelOf, reviewOf, treatmentOf, type RiskRow } from '../_register/riskModel';
import { LinkPicker, type PickItem } from './_workspace/LinkPicker';
import { AssessmentPanel, ControlsPanel, HistoryPanel, LinksPanel, OverviewPanel, TreatmentPanel, type ActionRow, type LinkedDocument, type PageRisk, type QueryState } from './_workspace/Panels';
import { assessBody, assessmentOf, fieldsPatch, historyFeed, riskReduction, type Assessment } from './_workspace/riskPageModel';

const TABS = ['overview', 'assessment', 'controls', 'links', 'treatment', 'quantification', 'history'] as const;
type Tab = (typeof TABS)[number];
// the addresses that exist: the old tab names, and the register drawer's "Linked to" rows
const ALIASES: Record<string, Tab> = { details: 'overview', assets: 'links', evidence: 'links', governance: 'links', documents: 'links' };

type Picker = 'control' | 'asset' | 'evidence' | 'document' | null;

const asState = <T,>(q: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }): QueryState<T> => q;

/** A table read when a picker opens: the rows of a list answer or of its `items`. */
function useList(key: string, on: boolean, fn: () => Promise<unknown>) {
  return useQuery({ queryKey: [key], queryFn: async () => { const d = (await fn()) as { data?: unknown }; const x = d?.data as { items?: unknown[] } | unknown[] | undefined; return (Array.isArray(x) ? x : x?.items ?? []) as any[]; }, enabled: on, staleTime: 60_000 });
}

/** A mutation of the risk page: reported, and it refreshes the record and everything that reads it. */
function useRiskMutation<V>(riskId: number, config: { fn: (v: V) => Promise<unknown>; ok: ReportedMutationConfig<unknown, V>['success']; bad: string; extra?: ReadonlyArray<readonly unknown[]>; onDone?: () => void; toast?: 'always' | 'success' }) {
  return useReportedMutation<unknown, V>({
    mutationFn: config.fn,
    success: config.ok,
    failure: config.bad,
    toast: config.toast,
    invalidate: [['risk-detail', riskId], ['erm-risk-detail', riskId], ['risk-linked-documents', riskId], ...RISK_REFRESH, ...(config.extra ?? [])],
    onSuccess: config.onDone,
  });
}

export default function RiskPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const riskId = Number(params.id);
  const { hasPermission } = usePermissions();
  const canEditRecord = hasPermission('erm:risks:edit');
  const canDeleteRecord = hasPermission('erm:risks:delete');
  const canLink = hasPermission('risks:risk_register:edit');
  const canUnlink = hasPermission('risks:risk_register:delete');
  const canTreat = hasPermission('risks:risk_treatment:edit');
  const canLinkRequirement = hasPermission('erm:risks:edit') || hasPermission('erm:risks:create');
  const [tab, setTab] = useTabParam<Tab>('tab', TABS, { fallback: 'overview', aliases: ALIASES });

  const riskQ = useQuery({
    queryKey: ['risk-detail', riskId],
    queryFn: async () => (await risksApi.getDetail(riskId)).data as unknown as PageRisk,
    enabled: Number.isFinite(riskId) && riskId > 0,
    retry: (failures, e) => failures < 2 && canRetry(e),
  });
  const risk = riskQ.data;
  const users = useTenantUsers();
  const appetite = useAppetite();
  const reviews = usePendingReviews();
  const actionsQ = useQuery({ queryKey: ['erm-risk-actions', riskId], queryFn: async () => (await ermApi.mitigationActions.getAll(riskId)).data as unknown as ActionRow[], enabled: !!risk, retry: (f, e) => f < 2 && canRetry(e) });
  const docsQ = useQuery({
    queryKey: ['risk-linked-documents', riskId],
    queryFn: async () => ((await governanceApi.getDocumentsByRisk(riskId)).data as { documents?: LinkedDocument[] })?.documents ?? [],
    enabled: !!risk, retry: (f, e) => f < 2 && canRetry(e),
  });
  const historyOn = tab === 'history';
  const reviewsQ = useQuery({ queryKey: ['erm-risk-reviews', riskId], queryFn: async () => (await ermApi.reviews.getAll({ risk_id: riskId })).data as unknown as Array<Record<string, any>>, enabled: !!risk && historyOn, retry: (f, e) => f < 2 && canRetry(e) });
  const scoresQ = useQuery({ queryKey: ['erm-risk-score-history', riskId], queryFn: async () => (await ermApi.dependencies.getScoreHistory(riskId)).data as Array<Record<string, any>>, enabled: !!risk && historyOn, retry: (f, e) => f < 2 && canRetry(e) });
  const incidentsQ = useQuery({ queryKey: ['erm-risk-incidents', riskId], queryFn: async () => (await ermApi.incidents.getAll({ risk_id: riskId })).data as unknown as Array<Record<string, any>>, enabled: !!risk && historyOn, retry: (f, e) => f < 2 && canRetry(e) });

  // ── pickers: the tables are read when the sheet opens ──
  const [picker, setPicker] = useState<Picker>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const normalized = useList('all-normalized-controls', picker === 'control', () => controlsApi.getNormalized());
  const internal = useList('all-internal-controls-for-risk-link', picker === 'control', () => ermApi.internalControls.getAll());
  const assets = useList('all-assets', picker === 'asset', () => assetsApi.getAll());
  const evidence = useList('all-evidence', picker === 'evidence', () => evidenceApi.getAll());
  const objectives = useList('all-governance-objectives', picker === 'document', () => governanceApi.getObjectives());
  const documents = useList('all-governance-documents-for-risk-link', picker === 'document', () => governanceApi.getDocumentsBrief({ limit: 500 }));

  // ── mutations ──
  const link = useRiskMutation<{ kind: 'asset' | 'evidence' | 'internal' | 'control' | 'document' | 'objective'; id: number }>(riskId, {
    fn: async ({ kind, id }) => {
      if (kind === 'asset') return risksApi.linkAsset(riskId, { asset_id: id });
      if (kind === 'evidence') return risksApi.linkEvidence(riskId, { evidence_id: id });
      if (kind === 'internal') return ermApi.internalControls.linkRisk(id, { risk_id: riskId });
      if (kind === 'control') return risksApi.linkControl(riskId, { normalized_control_id: id });
      if (kind === 'objective') return risksApi.linkGovernance(riskId, { governance_objective_id: id, impact_level: 'medium' });
      return governanceApi.linkDocumentToRisk({ document_id: id, risk_id: riskId, link_type: 'mitigates' });
    },
    ok: (_d, v) => `${{ asset: 'Asset', evidence: 'Evidence', internal: 'Control', control: 'Control', document: 'Document', objective: 'Objective' }[v.kind]} linked`,
    bad: "Couldn't link it",
    onDone: () => setPending(null),
  });
  const pickItem = (value: string) => {
    const [prefix, id] = value.includes('-') ? [value.split('-')[0], Number(value.split('-')[1])] : [picker, Number(value)];
    setPending(value);
    const kind = prefix === 'i' ? 'internal' : prefix === 'n' ? 'control' : prefix === 'd' ? 'document' : prefix === 'o' ? 'objective' : (picker as 'asset' | 'evidence');
    link.mutate({ kind, id }, { onError: () => setPending(null) });
  };
  const unlinkInternal = useRiskMutation<{ controlId: number; linkId: number }>(riskId, { fn: ({ controlId, linkId }) => ermApi.internalControls.unlinkRisk(controlId, linkId), ok: 'Control unlinked', bad: "Couldn't unlink the control" });
  const unlinkControl = useRiskMutation<number>(riskId, { fn: (id) => risksApi.unlinkControl(riskId, id), ok: 'Control unlinked', bad: "Couldn't unlink the control" });
  const unlinkFramework = useRiskMutation<number>(riskId, { fn: (id) => risksApi.unlinkFrameworkControl(riskId, id), ok: 'Control unlinked', bad: "Couldn't unlink the control" });
  const unlinkRequirement = useRiskMutation<number>(riskId, { fn: (id) => risksApi.unlinkRequirement(riskId, id), ok: 'Control unlinked', bad: "Couldn't unlink the control" });
  const unlinkAsset = useRiskMutation<number>(riskId, { fn: (id) => risksApi.unlinkAsset(riskId, id), ok: 'Asset unlinked', bad: "Couldn't unlink the asset" });
  const unlinkEvidence = useRiskMutation<number>(riskId, { fn: (id) => risksApi.unlinkEvidence(riskId, id), ok: 'Evidence unlinked', bad: "Couldn't unlink the evidence" });
  const unlinkDocument = useRiskMutation<number>(riskId, { fn: (id) => governanceApi.unlinkDocumentFromRisk(id), ok: 'Document unlinked', bad: "Couldn't unlink the document" });
  const unlinkObjective = useRiskMutation<number>(riskId, { fn: (id) => risksApi.unlinkGovernance(riskId, id), ok: 'Objective unlinked', bad: "Couldn't unlink the objective" });
  const unlinking = [unlinkInternal, unlinkControl, unlinkFramework, unlinkRequirement, unlinkAsset, unlinkEvidence, unlinkDocument, unlinkObjective].some((m) => m.isPending);

  // the fields go to PUT /erm/risks/{id} and the scores to POST /erm/risks/{id}/assess (PUT has no score fields: it ignores them); a request that fails names itself
  const saveAssessment = useRiskMutation<{ was: Assessment; now: Assessment }>(riskId, {
    fn: async ({ was, now }) => {
      const fields = fieldsPatch(was, now);
      const scores = assessBody(was, now);
      if (Object.keys(fields).length > 0) await ermApi.risks.update(riskId, fields as never);
      if (scores) { try { await ermApi.risks.assess(riskId, scores); } catch (e) { if (Object.keys(fields).length > 0) notify.warning('The status, priority and owners were saved but the scores were not.', { title: 'Saved in part' }); throw e; } }
    },
    ok: { title: 'Assessment saved', message: 'The scores and owners are updated everywhere.' }, bad: "Couldn't save the changes", toast: 'success',
  });
  const savePlan = useRiskMutation<string>(riskId, { fn: (plan) => risksApi.updateTreatment(riskId, plan), ok: 'Treatment plan saved', bad: "Couldn't save the plan", toast: 'success' });
  const remove = useReportedMutation({
    mutationFn: () => ermApi.risks.delete(riskId),
    success: { title: 'Risk deleted', message: 'Its links, actions, reviews, indicators and incident records went with it.' },
    failure: "Couldn't delete the risk",
    invalidate: RISK_REFRESH,
    onSuccess: () => router.push('/erm/risks'),
  });
  const askDelete = async () => {
    if (!risk) return;
    const yes = await confirm({
      title: 'Delete this risk?',
      message: `“${risk.title.length > 120 ? `${risk.title.slice(0, 120)}…` : risk.title}” goes, with its links to controls, assets and evidence, its mitigation actions, reviews, indicators and incident records. It cannot be undone.`,
      confirmLabel: 'Delete risk', tone: 'danger',
    });
    if (yes) remove.mutate();
  };

  // ── the full form, over this page ──
  const [form, setForm] = useState<Record<string, unknown> | null>(null);
  const openForm = async () => {
    try { setForm(await qc.fetchQuery({ queryKey: ['erm-risk-detail', riskId], queryFn: async () => (await ermApi.risks.getDetail(riskId)).data as unknown as Record<string, unknown>, staleTime: 0 })); }
    catch (e) { notify.error(errorMessage(e), { title: 'The risk could not be opened for editing', retry: () => { void openForm(); } }); }
  };

  // ── what the page derives ──
  const now = useMemo(() => new Date(), []);
  const row = risk as unknown as RiskRow | undefined;
  const level = row ? levelOf(row) : 'none';
  const breach = row && appetite.limits.size > 0 && aboveAppetite({ ...row, category: risk?.category ?? 'operational' }, appetite.limits) ? { limit: appetite.limits.get(risk?.category || 'operational') as number } : null;
  const review = row ? reviewOf({ id: riskId, review_date: risk?.review_date ?? null }, reviews.index, now) : null;
  const reduction = risk ? riskReduction(risk.inherent_score, risk.residual_score) : null;
  const history = useMemo(() => historyFeed({
    created: risk?.created_at, reviews: reviewsQ.data as never, scores: scoresQ.data as never, actions: actionsQ.data as never, incidents: incidentsQ.data as never,
  }), [risk?.created_at, reviewsQ.data, scoresQ.data, actionsQ.data, incidentsQ.data]);
  const people = users.data ?? [];

  useEffect(() => { document.title = risk ? `${risk.title} · Risk` : 'Risk'; }, [risk]);

  // ── the pickers' lists ──
  const controlItems: PickItem[] = useMemo(() => {
    const linkedI = new Set((risk?.linked_internal_controls ?? []).map((c) => Number(c.id)));
    const linkedN = new Set((risk?.linked_controls ?? []).map((c) => Number(c.control_id)));
    const inner = (internal.data ?? []).filter((c) => !linkedI.has(Number(c.id))).map((c) => ({ value: `i-${c.id}`, label: c.name || c.title || 'A control', sub: c.control_id ? `Internal · ${c.control_id}` : 'Internal' }));
    const norm = (normalized.data ?? []).filter((c) => !linkedN.has(Number(c.id))).map((c) => {
      const code = c.scf_id || c.code || c.internal_id || null;
      const kind = c.custom || c.source === 'custom' ? 'Custom' : code ? 'SCF' : 'Library';
      return { value: `n-${c.id}`, label: c.name || (code ? `Control ${code}` : 'A control'), sub: code ? `${kind} · ${code}` : kind };
    });
    return [...inner, ...norm];
  }, [internal.data, normalized.data, risk?.linked_internal_controls, risk?.linked_controls]);
  const assetItems: PickItem[] = useMemo(() => { const have = new Set((risk?.linked_assets ?? []).map((a) => a.asset_id)); return (assets.data ?? []).filter((a) => !have.has(Number(a.id))).map((a) => ({ value: String(a.id), label: a.name, sub: a.asset_type || undefined })); }, [assets.data, risk?.linked_assets]);
  const evidenceItems: PickItem[] = useMemo(() => { const have = new Set((risk?.linked_evidence ?? []).map((e) => e.evidence_id)); return (evidence.data ?? []).filter((e) => !have.has(Number(e.id))).map((e) => ({ value: String(e.id), label: e.name || e.title || 'An evidence item', sub: e.evidence_type || e.status || undefined })); }, [evidence.data, risk?.linked_evidence]);
  const documentItems: PickItem[] = useMemo(() => {
    const haveD = new Set((docsQ.data ?? []).map((d) => Number(d.document_id ?? d.id)));
    const haveO = new Set((risk?.linked_governance ?? []).map((g) => g.governance_objective_id));
    return [
      ...(documents.data ?? []).filter((d) => !haveD.has(Number(d.id))).map((d) => ({ value: `d-${d.id}`, label: d.title || d.name || 'A document', sub: d.doc_type || d.status || 'Document' })),
      ...(objectives.data ?? []).filter((g) => !haveO.has(Number(g.id))).map((g) => ({ value: `o-${g.id}`, label: g.title || g.name || 'An objective', sub: g.category ? `Objective · ${g.category}` : 'Objective' })),
    ];
  }, [documents.data, objectives.data, docsQ.data, risk?.linked_governance]);
  const pickerView: Record<Exclude<Picker, null>, { title: string; search: string; items: PickItem[]; qs: Array<{ isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }>; empty: string }> = {
    control: { title: 'Link a control', search: 'Search controls', items: controlItems, qs: [normalized, internal], empty: 'Every control is already linked.' },
    asset: { title: 'Link an asset', search: 'Search assets', items: assetItems, qs: [assets], empty: 'Every asset is already linked.' },
    evidence: { title: 'Link evidence', search: 'Search evidence', items: evidenceItems, qs: [evidence], empty: 'Every evidence item is already linked.' },
    document: { title: 'Link a document or objective', search: 'Search documents and objectives', items: documentItems, qs: [documents, objectives], empty: 'Every document and objective is already linked.' },
  };
  const pv = picker ? pickerView[picker] : null;

  // ── states ──
  if (riskQ.isPending) return <div aria-busy="true" className="flex flex-col gap-[16px]"><SkeletonRows rows={1} columns={2} label="Loading the risk" /><SkeletonRows rows={8} columns={3} label="Loading the risk" /></div>;
  if (riskQ.isError || !risk) {
    return (
      <div className="flex flex-col gap-[16px]">
        <ErrorState {...failureWords(riskQ.error, 'this risk')} onRetry={canRetry(riskQ.error) ? () => { void riskQ.refetch(); } : undefined} />
        <div><Button href="/erm/risks">Back to the Risk Register</Button></div>
      </div>
    );
  }

  const treatment = treatmentOf({ has_plan: !!risk.treatment_plan?.trim(), status: risk.status });
  const openActions = risk.actions_open ?? 0;
  const tabs: TabItem[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'controls', label: 'Controls', count: (risk.linked_controls?.length ?? 0) + (risk.linked_internal_controls?.length ?? 0) + (risk.linked_framework_controls?.length ?? 0) + (risk.linked_framework_requirements?.length ?? 0) },
    { key: 'links', label: 'Linked records', count: (risk.linked_assets?.length ?? 0) + (risk.linked_evidence?.length ?? 0) + (risk.linked_governance?.length ?? 0) + (docsQ.data?.length ?? 0) },
    { key: 'treatment', label: 'Treatment', count: risk.actions_total || undefined },
    { key: 'quantification', label: 'Quantification' },
    { key: 'history', label: 'History' },
  ];
  const peopleFailed = users.isError;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={risk.title}
        back={{ href: '/erm/risks', label: 'Back to the Risk Register' }}
        meta={[categoryLabel(categoryKey(risk)), risk.register_type, risk.business_unit_name].filter(Boolean).join(' · ')}
        chips={(
          <>
            <StatusPill {...statusPill(riskStatus, risk.status || 'open')} />
            <StatusPill {...statusPill(riskLevel, level)} />
            {risk.sla?.state && risk.sla.state !== 'no_due_date' && risk.sla.state !== 'closed' && <StatusPill {...statusPill(riskSla, risk.sla.state)} />}
            {breach && <StatusPill tone="danger" label="Above appetite" />}
          </>
        )}
        actions={(
          <>
            {canEditRecord && <Button variant="primary" leftIcon={<FileEdit aria-hidden />} onClick={() => { void openForm(); }}>Edit all fields</Button>}
            <CreateIssueButton sourceType="risk" sourceId={risk.id} presetFields={{ title: risk.title, description: risk.description || undefined, category: 'operations', issue_type: 'audit_finding' }} />
            {canDeleteRecord && <Menu label="More actions" iconOnly items={[{ key: 'delete', label: 'Delete risk', icon: Trash2, danger: true, onSelect: () => { void askDelete(); } }]} />}
          </>
        )}
      />

      <FactList variant="boxed" min={150}>
        <Fact label="Inherent score">{risk.inherent_score != null ? `${Math.round(risk.inherent_score)} (likelihood ${risk.inherent_likelihood ?? '—'}, impact ${risk.inherent_impact ?? '—'})` : null}</Fact>
        <Fact label="Residual score">{risk.residual_score != null ? `${Math.round(risk.residual_score)} (likelihood ${risk.residual_likelihood ?? '—'}, impact ${risk.residual_impact ?? '—'})${reduction != null ? ` · ${reduction}% lower` : ''}` : null}</Fact>
        <Fact label="Risk owner" empty="Unassigned">{risk.owner_name ? <PersonChip name={risk.owner_name} /> : null}</Fact>
        <Fact label="Business owner" empty="Unassigned">{risk.business_owner_name ? <PersonChip name={risk.business_owner_name} /> : null}</Fact>
        <Fact label="Next review" empty={reviews.isError ? 'Not available' : 'Not scheduled'}>{review?.due ? `${formatDate(review.due)}${review.state === 'overdue' ? ' (overdue)' : ''}` : null}</Fact>
        <Fact label="Mitigation actions">{risk.actions_total ? `${risk.actions_total}${openActions ? ` (${openActions} open)` : ''}` : 'None'}</Fact>
      </FactList>

      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Risk sections" countFormat="exact">
        <TabPanel tabKey="overview">
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <OverviewPanel
              risk={risk}
              issues={(
                <div className="mt-[20px] border-t border-ds-border pt-[16px]">
                  <RelatedIssuesPanel sourceType="risk" sourceId={risk.id} title="Issues" createFields={{ title: risk.title, description: risk.description || undefined, category: 'operations', issue_type: 'audit_finding' }} />
                </div>
              )}
            />
          </div>
        </TabPanel>
        <TabPanel tabKey="assessment" lazy>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <AssessmentPanel
              risk={risk} start={assessmentOf(risk)} people={people} peopleFailed={peopleFailed} canEdit={canEditRecord} saving={saveAssessment.isPending}
              error={saveAssessment.isError ? errorMessage(saveAssessment.error) : null} aboveAppetite={breach}
              onSave={(was, now) => saveAssessment.mutate({ was, now })}
            />
          </div>
        </TabPanel>
        <TabPanel tabKey="controls" lazy>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <ControlsPanel
              risk={risk} canLink={canLink} canUnlink={canUnlink} canLinkRequirement={canLinkRequirement} busy={unlinking}
              onLinkControl={() => setPicker('control')} onLinkRequirement={() => setRequirementOpen(true)}
              onUnlinkInternal={(controlId, linkId) => unlinkInternal.mutate({ controlId, linkId })} onUnlinkControl={(id) => unlinkControl.mutate(id)}
              onUnlinkFramework={(id) => unlinkFramework.mutate(id)} onUnlinkRequirement={(id) => unlinkRequirement.mutate(id)}
            />
          </div>
        </TabPanel>
        <TabPanel tabKey="links" lazy>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <LinksPanel
              risk={risk} documents={asState(docsQ)} canLink={canLink} canUnlink={canUnlink} busy={unlinking}
              onLink={(kind) => setPicker(kind)} onUnlinkAsset={(id) => unlinkAsset.mutate(id)} onUnlinkEvidence={(id) => unlinkEvidence.mutate(id)}
              onUnlinkDocument={(id) => unlinkDocument.mutate(id)} onUnlinkObjective={(id) => unlinkObjective.mutate(id)}
            />
          </div>
        </TabPanel>
        <TabPanel tabKey="treatment" lazy>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <TreatmentPanel risk={risk} treatment={treatment} canEdit={canTreat} saving={savePlan.isPending} error={savePlan.isError ? errorMessage(savePlan.error) : null} actions={asState(actionsQ)} onSave={(plan) => savePlan.mutate(plan)} />
          </div>
        </TabPanel>
        <TabPanel tabKey="quantification" lazy>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <QuantificationTab riskId={riskId} canEdit={canLink} linkedControls={risk.linked_controls || []} />
          </div>
        </TabPanel>
        <TabPanel tabKey="history" lazy>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <HistoryPanel
              items={history}
              feeds={[
                { label: 'Reviews', state: asState(reviewsQ) }, { label: 'Score history', state: asState(scoresQ) },
                { label: 'Mitigation actions', state: asState(actionsQ) }, { label: 'Incidents', state: asState(incidentsQ) },
              ]}
            />
          </div>
        </TabPanel>
      </Tabs>

      {pv && (
        <LinkPicker
          open
          onClose={() => { setPicker(null); setPending(null); }}
          title={pv.title}
          searchLabel={pv.search}
          items={pv.items}
          loading={pv.qs.some((q) => q.isPending)}
          error={pv.qs.find((q) => q.isError)?.error}
          onRetry={() => pv.qs.forEach((q) => { void q.refetch(); })}
          onPick={pickItem}
          pending={pending}
          empty={pv.empty}
        />
      )}

      <LinkFrameworkRequirementModal
        isOpen={requirementOpen}
        riskId={riskId}
        linkedControlIds={risk.linked_framework_requirements?.map((c) => c.parsed_control_id) || []}
        preferredFrameworkId={risk.linked_framework_requirements?.[0]?.framework_id}
        onClose={() => setRequirementOpen(false)}
        onLinked={() => {
          RISK_REFRESH.concat([['risk-detail', riskId]]).forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });
          setRequirementOpen(false);
          notify.success('Framework control linked');
        }}
      />

      {form && (
        <RiskModal
          isOpen
          risk={form as never}
          onClose={() => setForm(null)}
          isLoading={false}
          initialRegisterType={(risk.register_type as string) || ''}
          nextOneLinkSeq={1}
          onSubmit={async (payload) => {
            const saved = await saveRiskForm(riskId, payload, form as never);
            RISK_REFRESH.concat([['risk-detail', riskId], ['erm-risk-detail', riskId]]).forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });
            setForm(null);
            notify.success('The changes are saved.', { title: 'Risk updated' });
            const missed = assetsNotLinked(saved.failedAssets);
            if (missed) notify.warning(missed, { title: 'Some assets were not linked' });
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}

