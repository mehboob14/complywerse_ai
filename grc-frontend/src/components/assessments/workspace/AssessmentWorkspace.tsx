'use client';

/**
 * ONE workspace for every assessment (`/assessments/a/<id>`): the heading (name, kind, where it stands, who and when), the score and the Remediation clock numbers the board shows, and
 * tabs: Controls (the built-in list with its drawer, or the lens made for the type), Remediation, the lens tabs, and for a scoped assessment Scope, People and Plan. It replaces three
 * detail screens (the board's in-place detail, /compliance/assessments/<id>, /cyber-security/assessments/<id>). What the person may do follows `compliance:assessments:edit`
 * (readOnly); approving evidence stays on the Pending Approvals page. The lens contract is lens.ts; the lenses are lensRegistry.tsx.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/ui/ds/PageHeading';
import { Button, EmptyState, Menu, Notice, StatTile, StatusPill, TabPanel, Tabs, useConfirm, useNotify, useReportedMutation, useTabParam, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount, formatDate, orEmpty, UNASSIGNED } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { grade as gradeWords, lifecycle as lifecycleWords } from '@/lib/statuses/assessments';
import { stageState } from '@/components/compliance/scoping/scopingModel';
import { DetailsDialog } from './DetailsDialog';
import { ItemsTab } from './ItemsTab';
import { normaliseItem } from './itemModel';
import { kindOf } from './kinds';
import { resolveLenses } from './lens';
import { LENSES } from './lensRegistry';
import { RemediationTab, useSlaDays } from './RemediationTab';
import { ScopeTab, type StageKey } from './ScopeTab';
import type { AssessmentDetail } from './types';
import { useScoping } from './useScoping';
import { KEYS, refreshWorkspaceCaches, workspaceApi, type ReuploadPreview, type ReuploadResult } from './workspaceApi';
import { actionsFor, BACK, defaultTabFor, entryOf, headFacts, readOnlyFor, scoreView, tabsFor } from './workspaceModel';

const SHELL = 'mx-auto flex max-w-7xl flex-col gap-[16px]';
const STAGES: StageKey[] = ['scope', 'people', 'plan'];

/** A file the browser keeps: the workbook of the assessment. */
function download(blob: Blob, name: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export function AssessmentWorkspace({ detail }: { detail: AssessmentDetail }) {
  const id = detail.id;
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const readOnly = readOnlyFor(hasPermission('compliance:assessments:edit'));
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);

  const scopeQ = useQuery({ queryKey: KEYS.scope(id), queryFn: () => workspaceApi.scope(id), staleTime: 15_000 });
  const scoreQ = useQuery({ queryKey: KEYS.score(id), queryFn: () => workspaceApi.score(id), staleTime: 15_000 });
  const { days } = useSlaDays();

  const scoped = !!detail.scope_model;
  const phase = detail.phase;
  const kind = kindOf(detail.assessment_format);
  const facts = headFacts(detail);
  const items = useMemo(() => detail.items.map(normaliseItem), [detail.items]);
  const entry = entryOf(scoreQ.data, id);
  const score = scoreView(entry);
  const lenses = useMemo(() => resolveLenses(LENSES, { format: detail.assessment_format, scoped, phase }), [detail.assessment_format, scoped, phase]);
  const tabs = tabsFor({ scoped, phase, totalItems: detail.total_items ?? items.length, openGaps: entry?.sla_counts?.open ?? null, controls: lenses.controls, lensTabs: lenses.tabs });
  const [tab, setTab] = useTabParam('tab', tabs.filter((t) => !t.disabled).map((t) => t.key), { fallback: defaultTabFor({ scoped, phase }) });
  const actions = actionsFor({ phase, status: detail.status, scoped, readOnly, format: detail.assessment_format });
  const refresh = () => refreshWorkspaceCaches(qc, id);

  const scoping = useScoping(id, scopeQ.data, { onStarted: () => setTab('controls') });

  // a draft opens on the first stage that still needs something, once, unless the address already names a tab
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !scopeQ.data || !scoped || phase !== 'scoping') return;
    opened.current = true;
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tab')) return;
    const first = STAGES.find((s) => stageState(scopeQ.data, s).missing > 0);
    if (first && first !== 'scope') setTab(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeQ.data]);

  const setStatus = useReportedMutation({
    mutationFn: (status: string) => workspaceApi.updateDetails(id, { status }),
    success: (_, status) => (status === 'completed' ? 'Assessment marked completed' : 'Assessment reopened'),
    failure: "Couldn't change the assessment",
    onSuccess: refresh,
  });
  const remove = useReportedMutation({
    mutationFn: () => workspaceApi.deleteAssessment(id),
    success: 'Assessment deleted',
    failure: "Couldn't delete the assessment",
    onSuccess: () => { refresh(); router.push(BACK.href); },
  });
  const exportFile = useReportedMutation({
    mutationFn: async () => { download(await workspaceApi.exportWorkbook(id), `${(detail.name || 'assessment').replace(/[\\/:*?"<>|]+/g, ' ').trim()}_export.xlsx`); },
    failure: "Couldn't export the assessment",
    toast: 'errors',
  });
  const apply = useReportedMutation({
    mutationFn: (file: File) => workspaceApi.reupload<ReuploadResult>(id, file, false),
    success: (r) => `${formatCount(r.updated_count ?? 0)} ${(r.updated_count ?? 0) === 1 ? 'control' : 'controls'} updated, ${formatCount(r.added_count ?? 0)} added`,
    failure: "Couldn't refresh the assessment from the file",
    retryable: false,
    onSuccess: refresh,
  });

  const askDelete = async () => {
    const yes = await confirm({ title: `Delete “${detail.name}”?`, message: `All ${formatCount(items.length)} controls, their answers and their links to evidence are removed. This cannot be undone.`, confirmLabel: 'Delete assessment', tone: 'danger' });
    if (yes) remove.mutate();
  };
  const askDiscard = async () => {
    const yes = await confirm({ title: `Discard the draft “${detail.name}”?`, message: 'Nothing was copied yet. The subject and the scope entered so far are removed.', confirmLabel: 'Discard draft', tone: 'danger' });
    if (yes) scoping.discard();
  };
  /** Read the chosen workbook, say what it would change, and change it only when the person agrees. */
  const onFile = async (file: File) => {
    setReading(true);
    try {
      const p = await workspaceApi.reupload<ReuploadPreview>(id, file, true);
      if (p.changed_count === 0 && p.added_count === 0) { notify.info('Nothing in the file differs from the assessment.', { title: 'No changes' }); return; }
      const named = p.changed_controls.slice(0, 5).map((c) => c.item_number).filter(Boolean);
      const yes = await confirm({
        title: 'Refresh from this file?',
        message: (
          <span className="block space-y-[6px]">
            <span className="block">{formatCount(p.changed_count)} of {formatCount(p.updated_count)} matching {p.updated_count === 1 ? 'control' : 'controls'} would change{p.added_count ? `, and ${formatCount(p.added_count)} new ${p.added_count === 1 ? 'control' : 'controls'} would be added` : ''}.</span>
            {named.length > 0 && <span className="block">Among them: {named.join(', ')}{p.changed_count > named.length ? ' and more' : ''}.</span>}
            <span className="block">Whatever the file holds for a control replaces what is here. Nothing is saved until you agree.</span>
          </span>
        ),
        confirmLabel: 'Refresh from the file',
      });
      if (yes) apply.mutate(file);
    } catch (e) {
      notify.error(e, { title: "Couldn't read the file" });
    } finally {
      setReading(false);
    }
  };

  const menu: MenuItem[] = [
    { key: 'details', label: 'Edit details', icon: Pencil, hidden: !actions.editDetails, onSelect: () => setEditing(true) },
    { key: 'complete', label: 'Mark completed', icon: CheckCircle2, hidden: !actions.complete, onSelect: () => setStatus.mutate('completed') },
    { key: 'reopen', label: 'Reopen', icon: RotateCcw, hidden: !actions.reopen, onSelect: () => setStatus.mutate('in_progress') },
    { key: 'export', label: 'Export workbook', icon: Download, hidden: !actions.exportFile, onSelect: () => exportFile.mutate() },
    { key: 'refresh', label: 'Refresh from a workbook…', icon: FileUp, hidden: !actions.refresh, disabled: reading || apply.isPending, onSelect: () => fileInput.current?.click() },
    { key: 'delete', label: 'Delete assessment', icon: Trash2, danger: true, hidden: !actions.remove, onSelect: () => void askDelete() },
  ];

  const sv = scopeQ.data;
  const subject = sv?.primary_asset?.name ?? sv?.scope.function ?? sv?.scope.system ?? null;
  const owner = sv?.owner?.name ?? null;
  const life = statusPill(lifecycleWords, facts.lifecycle);
  const scoreError = scoreQ.isError ? { title: "Couldn't load the score", message: errorMessage(scoreQ.error), onRetry: canRetry(scoreQ.error) ? () => { void scoreQ.refetch(); } : undefined } : null;
  const draft = scoped && phase === 'scoping';
  const sla = entry?.sla_counts;

  return (
    <div className={SHELL}>
      <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Choose the workbook to refresh from" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      <PageHeading
        title={detail.name} back={BACK}
        meta={[subject, owner ? `Owner ${owner}` : null, detail.assessor ? `Assessor ${detail.assessor}` : null].filter(Boolean).join(' · ') || undefined}
        chips={<><StatusPill {...life} /><StatusPill tone="neutral" label={facts.kind} />{facts.category !== facts.kind && <StatusPill tone="neutral" label={facts.category} />}</>}
        actions={(
          <>
            {actions.discard && <Button leftIcon={<Trash2 aria-hidden />} loading={scoping.discarding} onClick={() => void askDiscard()}>Discard draft</Button>}
            {actions.start && <Button variant="primary" leftIcon={<Play aria-hidden />} loading={scoping.starting} disabled={!scopeQ.data?.readiness?.ready} onClick={scoping.start}>Start assessment</Button>}
            <Menu label="Actions" items={menu} />
          </>
        )}
      />
      {reading && <p role="status" className="text-ds-label text-ds-fg-muted">Reading the file…</p>}
      {draft && !scopeQ.data?.readiness?.ready && scopeQ.data && <Notice tone="info" title="This assessment has not started">Fill in the scope and the people; the questions open when you press Start.</Notice>}

      {!draft && (
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
          <StatTile
            label="Score" value={score.score === null ? null : formatCount(Math.round(score.score))} unit={score.score === null ? undefined : 'of 100'} progress={score.score}
            info={score.counted ? 'The share of applicable controls that comply, weighted by how the type of assessment is scored. Nothing is scored until controls are answered.' : 'The board counts an assessment once it has answers; a plain upload or an unanswered questionnaire is not scored.'}
            loading={scoreQ.isPending} error={scoreError} tone={score.grade === 'poor' ? 'danger' : score.grade === 'excellent' ? 'success' : 'default'}
          >
            {score.grade && <StatusPill {...statusPill(gradeWords, score.grade)} size="sm" className="mt-[8px]" />}
          </StatTile>
          <StatTile
            label="Remediation score" value={score.sla === null ? null : formatCount(Math.round(score.sla))} unit={score.sla === null ? undefined : 'of 100'} progress={score.sla}
            info="How well the gaps are closed on time. It is separate from the score and is empty while there is no gap to close."
            loading={scoreQ.isPending} error={scoreError}
          />
          <StatTile
            label="Open gaps" value={sla && typeof sla.open === 'number' ? formatCount(sla.open) : null} unit={sla?.open === 1 ? 'gap' : 'gaps'}
            note={sla && typeof sla.overdue === 'number' ? `${formatCount(sla.overdue)} overdue` : undefined} tone={sla?.overdue ? 'danger' : 'default'}
            loading={scoreQ.isPending} error={scoreError} link={{ href: `?tab=remediation`, label: 'Open gaps. See the Remediation tab' }}
          />
          <StatTile
            label="Due" value={detail.due_date ? formatDate(detail.due_date, { calendar: true }) : 'Not set'}
            note={<>{orEmpty(owner ?? detail.assessor, UNASSIGNED)}{items.length ? ` · ${formatCount(items.length)} ${items.length === 1 ? 'control' : 'controls'}` : ''}</>}
          />
        </div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Assessment sections" className="flex flex-col gap-[16px]">
        <TabPanel tabKey="controls">
          <div className="pt-[16px]">
            {draft ? (
              <EmptyState kind="firstUse" bare title="The questions open when you start" description="Fill in the scope and the people, then press Start assessment." />
            ) : lenses.controls ? (
              <lenses.controls.Component assessmentId={id} readOnly={readOnly} onChanged={refresh} />
            ) : (
              <ItemsTab assessmentId={id} assessmentName={detail.name} items={items} days={days} readOnly={readOnly} structuredRemarks={kind.structuredRemarks} onChanged={refresh} />
            )}
          </div>
        </TabPanel>
        <TabPanel tabKey="remediation" lazy>
          <div className="pt-[16px]">
            <RemediationTab items={items} days={days} entry={entry} score={{ loading: scoreQ.isPending, error: scoreQ.error, retry: () => { void scoreQ.refetch(); } }} />
          </div>
        </TabPanel>
        {lenses.tabs.map((l) => (
          <TabPanel key={l.key} tabKey={l.key} lazy>
            <div className="pt-[16px]"><l.Component assessmentId={id} readOnly={readOnly} onChanged={refresh} /></div>
          </TabPanel>
        ))}
        {scoped && STAGES.map((s) => (
          <TabPanel key={s} tabKey={s} lazy>
            <div className="pt-[16px]">
              {scopeQ.data ? <ScopeTab stage={s} view={scopeQ.data} scoping={scoping} onJump={(to) => setTab(to)} />
                : scopeQ.isError ? <Notice tone="danger" title="Couldn't load the scope" action={<Button size="sm" onClick={() => { void scopeQ.refetch(); }}>Try again</Button>}>{errorMessage(scopeQ.error)}</Notice>
                : <p role="status" className="text-ds-body text-ds-fg-muted">Loading the scope…</p>}
            </div>
          </TabPanel>
        ))}
      </Tabs>
      {editing && <DetailsDialog detail={detail} onClose={() => setEditing(false)} onSaved={refresh} />}
      {confirmDialog}
    </div>
  );
}
