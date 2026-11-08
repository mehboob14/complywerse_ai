'use client';

/**
 * Risk Management > Risk Assessments > an assessment (manual): the workspace. A head with the name, stage and who leads it; the steps of its life (draft, in progress, under review, approved,
 * closed) with the one next action beside them; a counters band (how many risks are critical, high, medium, low, not scored: each a filter, the SAME function as the rows); and tabs:
 * Risks (the table, scored in place), Insights (the old Analytics page), Details and the approval record.
 *
 * The scores are cells you change where they are and each change is saved at once, with the row saying "Saving", "Saved" or "Not saved. Try again". The tiles, the rows, the Insights
 * and the rating written on a save are one function (assessmentModel.ratingOf), on the register's score bands. Who may do what follows what the server enforces today (any reader may write:
 * see useAssessmentRights); an approved or closed assessment keeps the cells read-only, as it always did.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, FilterChips, Menu, PersonChip, SkeletonRows, StatusPill, TabPanel, Tabs, TextInput, useAddressState, useConfirm, useNotify, useReportedMutation, useTabParam,
  type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { useContainerWidth } from '@/components/records/useContainerWidth';
import { useNarrow } from '@/components/overview/useNarrow';
import { ermApi, riskAssessmentApi } from '@/lib/api';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { assessmentStatus } from '@/lib/statuses/riskAssessments';
import { riskLevel } from '@/lib/statuses/risk';
import { failureWords } from '../../risks/_register/riskData';
import { ASSESSMENT_REFRESH, REGISTER_KEY, useAssessmentRights } from '../_register/assessmentData';
import { BANDS, STEPS, applyPatch, isEditable, movesFrom, patchBody, stageOf, summarise, type AssessedRisk, type Band, type Move, type RowPatch } from '../_register/assessmentModel';
import { AddRisksSheet } from './_workspace/AddRisksSheet';
import { EditSheet } from './_workspace/EditSheet';
import { DetailsPanel, HistoryPanel, InsightsPanel } from './_workspace/Panels';
import { RiskDrawer } from './_workspace/RiskDrawer';
import { RiskRowsTable, type SaveState } from './_workspace/RiskRows';
import { assessmentKey, sortRisks, useAssessment, visibleRisks, type AssessmentDetail, type RiskSort } from './_workspace/workspaceData';
import { riskAddress } from './_workspace/workspaceAddress';

const TABS = ['risks', 'insights', 'details', 'history'] as const;
type Tab = (typeof TABS)[number];
const MOVE_DONE: Record<string, { title: string; message: string }> = {
  'Start assessment': { title: 'Assessment started', message: 'Score the risks, then submit it for review.' },
  'Submit for review': { title: 'Submitted for review', message: 'A reviewer can approve it or send it back.' },
  Approve: { title: 'Assessment approved', message: 'Its scores are now read-only.' },
  'Send back': { title: 'Sent back', message: 'It is in progress again, so the scores can change.' },
  Close: { title: 'Assessment closed', message: 'It stays in the list for reference.' },
};
const CONFIRM: Record<string, { title: string; message: string }> = {
  Approve: { title: 'Approve this assessment?', message: 'Once it is approved the scores can no longer be changed. You can still close it afterwards.' },
  Close: { title: 'Close this assessment?', message: 'A closed assessment is kept for reference and cannot be changed.' },
};

export default function AssessmentWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const id = Number(params.id);
  const { canWrite, ready } = useAssessmentRights();
  const narrow = useNarrow();
  const box = useRef<HTMLDivElement>(null);
  const room = useContainerWidth(box);
  const [tab, setTab] = useTabParam<Tab>('tab', TABS, { fallback: 'risks', aliases: { analytics: 'insights', scores: 'risks', overview: 'details' } });
  const [address, setAddress] = useAddressState(riskAddress);

  const q = useAssessment(id);
  const a = q.data;
  const rows: readonly AssessedRisk[] = useMemo(() => a?.assessed_risks ?? [], [a]);
  const editable = !!a && canWrite && isEditable(a.status);

  // ── the scores, saved in place ──
  const editsRef = useRef<Record<number, RowPatch>>({});
  const inflight = useRef<Record<number, number>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [edits, setEdits] = useState<Record<number, RowPatch>>({});
  const [saveState, setSaveState] = useState<Record<number, SaveState>>({});
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const saveRow = useCallback(async (row: AssessedRisk, patch: RowPatch): Promise<boolean> => {
    const before = editsRef.current[row.id] ?? {};
    const merged = { ...before, ...patch };
    editsRef.current = { ...editsRef.current, [row.id]: merged };
    setEdits(editsRef.current);
    setSaveState((s) => ({ ...s, [row.id]: 'saving' }));
    clearTimeout(timers.current[row.id]);
    inflight.current[row.id] = (inflight.current[row.id] ?? 0) + 1;
    try {
      const body = patchBody(applyPatch(row, before), patch);
      const res = await riskAssessmentApi.updateRisk(id, row.id, body);
      inflight.current[row.id] -= 1;
      if (inflight.current[row.id] === 0) {
        const { [row.id]: _gone, ...rest } = editsRef.current;
        void _gone;
        editsRef.current = rest;
        setEdits(rest);
        qc.setQueryData<AssessmentDetail>([...assessmentKey(id)], (old) => (old ? { ...old, assessed_risks: old.assessed_risks.map((r) => (r.id === row.id ? { ...r, ...(res.data as Partial<AssessedRisk>) } : r)) } : old));
        setSaveState((s) => ({ ...s, [row.id]: 'saved' }));
        timers.current[row.id] = setTimeout(() => setSaveState((s) => { const { [row.id]: _x, ...r } = s; void _x; return r; }), 2500);
        void qc.invalidateQueries({ queryKey: [...REGISTER_KEY] });
      }
      return true;
    } catch (e) {
      inflight.current[row.id] -= 1;
      setSaveState((s) => ({ ...s, [row.id]: 'failed' }));
      notify.error(errorMessage(e), { title: `"${truncate(row.risk_title ?? 'The risk', 50).text}" was not saved`, retry: canRetry(e) ? () => { void saveRow(row, {}); } : undefined });
      return false;
    }
  }, [id, qc, notify]);

  // ── the lifecycle ──
  const move = useReportedMutation<unknown, Move>({
    mutationFn: async (m) => {
      try { return await riskAssessmentApi.updateStatus(id, { status: m.to }); } catch (e) {
        if (statusOf(e) === 400) throw new Error('This assessment is no longer at that stage. Reload the page to see where it is.');
        throw e;
      }
    },
    success: (_d, m) => MOVE_DONE[m.label] ?? { title: 'Assessment updated', message: '' },
    failure: "Couldn't move the assessment",
    invalidate: [[...assessmentKey(id)], ...ASSESSMENT_REFRESH],
  });
  const doMove = async (m: Move) => {
    const ask = CONFIRM[m.label];
    if (ask && !(await confirm({ ...ask, confirmLabel: m.label }))) return;
    move.mutate(m);
  };

  const remove = useReportedMutation({
    mutationFn: () => ermApi.riskAssessments.delete(id),
    success: { title: 'Assessment deleted', message: 'The risks stay in the Risk Register.' },
    failure: "Couldn't delete the assessment",
    invalidate: ASSESSMENT_REFRESH,
    onSuccess: () => router.push('/erm/risk-assessments'),
  });
  const askDelete = async () => {
    if (!a) return;
    const yes = await confirm({
      title: `Delete “${truncate(a.name, 80).text}”?`,
      message: `${rows.length ? `Its ${formatCount(rows.length)} assessed ${rows.length === 1 ? 'risk' : 'risks'}, with their scores and links, go with it. ` : ''}The risks themselves stay in the Risk Register. It cannot be undone.`,
      confirmLabel: 'Delete assessment', tone: 'danger',
    });
    if (yes) remove.mutate();
  };

  // ── what the page derives ──
  const [search, setSearch] = useState('');
  const [levels, setLevels] = useState<Band[]>([]);
  const [sort, setSort] = useState<RiskSort>({ key: 'order', dir: 'asc' });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const live = useMemo(() => rows.map((r) => (edits[r.id] ? applyPatch(r, edits[r.id]) : r)), [rows, edits]);
  const summary = useMemo(() => summarise(live), [live]);
  const shown = useMemo(() => sortRisks(visibleRisks(rows.map((r) => (edits[r.id] ? applyPatch(r, edits[r.id]) : r)), search, levels), sort).map((r) => rows.find((x) => x.id === r.id) as AssessedRisk), [rows, edits, search, levels, sort]);
  const openRow = address.risk ? rows.find((r) => r.id === address.risk) ?? null : null;
  const toggleLevel = (b: Band) => setLevels((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  const onSort = (key: RiskSort['key']) => setSort((s) => (s.key !== key ? { key, dir: key === 'title' ? 'asc' : 'desc' } : s.dir === 'desc' && key !== 'title' ? { key, dir: 'asc' } : s.dir === 'asc' && key === 'title' ? { key, dir: 'desc' } : { key: 'order', dir: 'asc' }));

  useEffect(() => { document.title = a ? `${a.name} · Risk assessment` : 'Risk assessment'; }, [a]);

  const bandChips: FilterChip[] = [
    { key: 'all', label: 'All risks', count: rows.length, active: levels.length === 0 },
    ...BANDS.map((b) => ({ key: b, label: riskLevel.label(b), count: summary.byBand[b], active: levels.includes(b) })),
  ];

  // ── the states of the whole page ──
  if (q.isPending) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={5} label="Loading the assessment" /></div>;
  if (q.isError || !a) {
    return <ErrorState {...failureWords(q.error, 'this assessment')} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  }

  const moves = ready && canWrite ? movesFrom(a.status) : [];
  const more: MenuItem[] = [{ key: 'delete', label: 'Delete assessment', icon: Trash2, danger: true, hidden: !canWrite, onSelect: () => { void askDelete(); } }];
  const stage = stageOf('manual', a.status);
  const stepAt = STEPS.findIndex((s) => s.stage === stage);
  // the table needs ~640px of fixed columns plus a title worth reading (240); with the treatment and controls columns ~940. Under 880 each risk is a card.
  const roomy = room == null || room >= 1180;
  const cards = narrow || (room != null && room < 880);

  return (
    <div ref={box} className="flex min-w-0 flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={a.name}
        back={{ href: '/erm/risk-assessments', label: 'Back to assessments' }}
        chips={(
          <>
            <StatusPill {...statusPill(assessmentStatus, a.status)} />
            {a.lead_assessor_name ? <PersonChip name={a.lead_assessor_name} /> : <span className="text-ds-body text-ds-fg-muted">No lead assessor</span>}
            {(a.assessment_period_start || a.assessment_period_end) && <span className="text-ds-body text-ds-fg-muted">{formatDate(a.assessment_period_start, { calendar: true })} to {formatDate(a.assessment_period_end, { calendar: true })}</span>}
            {a.approved_at && <span className="text-ds-body text-ds-fg-muted">Approved{a.approver_name ? ` by ${a.approver_name}` : ''}, {formatDate(a.approved_at)}</span>}
          </>
        )}
        actions={ready && canWrite ? (
          <>
            {moves.map((m) => (
              <Button key={m.label} variant={m.primary ? 'primary' : 'secondary'} loading={move.isPending && move.variables?.label === m.label} disabled={move.isPending} onClick={() => { void doMove(m); }}>{m.label}</Button>
            ))}
            <Menu label="More actions" iconOnly items={more} />
          </>
        ) : undefined}
      />

      <ol aria-label="Where the assessment is" className="m-0 flex list-none flex-wrap items-center gap-x-[6px] gap-y-[4px] p-0">
        {STEPS.map((s, i) => (
          <li key={s.stage} aria-current={i === stepAt ? 'step' : undefined} className={`flex items-center gap-[6px] text-ds-label ${i === stepAt ? 'font-[600] text-ds-primary-text' : i < stepAt ? 'text-ds-fg-body' : 'text-ds-fg-muted'}`}>
            <span aria-hidden className={`h-[8px] w-[8px] rounded-full ${i === stepAt ? 'bg-ds-primary' : i < stepAt ? 'bg-ds-fg-muted' : 'border border-ds-border-strong'}`} />
            {s.label}{i === stepAt && <span className="sr-only"> (now)</span>}
            {i < STEPS.length - 1 && <span aria-hidden className="ml-[2px] text-ds-border-strong">›</span>}
          </li>
        ))}
      </ol>

      <section aria-label="Counters" className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
        <FilterChips label="Risks by level" chips={bandChips} onToggle={(key) => { if (key === 'all') setLevels([]); else toggleLevel(key as Band); setTab('risks'); }} />
        {summary.avgInherent != null && (
          <span className="text-ds-body text-ds-fg-muted">
            Average score {summary.avgInherent}{summary.avgResidual != null && <> → {summary.avgResidual}</>}
            <span className="sr-only"> (inherent{summary.avgResidual != null ? ', then residual' : ''})</span>
          </span>
        )}
      </section>

      <Tabs<Tab> ariaLabel="Assessment sections" countFormat="exact" tabs={[{ key: 'risks', label: 'Risks', count: rows.length }, { key: 'insights', label: 'Insights' }, { key: 'details', label: 'Details' }, { key: 'history', label: 'Approval record' }]} value={tab} onChange={setTab}>
        <TabPanel tabKey="risks">
          <div className="flex flex-col gap-[12px] pt-[12px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the risks of this assessment" placeholder="Search risks" autoComplete="off" className="min-w-[160px] max-w-[320px] flex-1" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} />
              {(search || levels.length > 0) && <span className="text-ds-body text-ds-fg-muted">{formatCount(shown.length)} of {formatCount(rows.length)}</span>}
              {editable && <Button className="ml-auto" variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add risks</Button>}
            </div>
            {rows.length === 0 ? (
              <div className="rounded-ds-card border border-ds-border bg-ds-surface">
                <EmptyState kind="firstUse" bare title="No risks in this assessment yet" description={editable ? 'Choose the risks from the Risk Register that this assessment covers, then score them here.' : 'Nothing was added to it.'} action={editable ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add risks</Button> : undefined} />
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState kind="noMatches" bare title="No risks match" description="Loosen the level or search for other words." onClearFilters={() => { setSearch(''); setLevels([]); }} /></div>
            ) : (
              <RiskRowsTable
                rows={shown}
                edits={edits}
                state={saveState}
                editable={editable}
                narrow={cards}
                roomy={roomy}
                sort={sort}
                onSort={onSort}
                onChange={(row, patch) => { void saveRow(row, patch); }}
                onRetry={(row) => { void saveRow(row, {}); }}
                onOpen={(row) => setAddress({ risk: row.id })}
                activeId={openRow?.id ?? null}
              />
            )}
            {!editable && rows.length > 0 && <p className="m-0 text-ds-label text-ds-fg-muted">{canWrite ? 'The scores can change while the assessment is a draft or in progress.' : 'You can read this assessment but not change it.'}</p>}
          </div>
        </TabPanel>
        <TabPanel tabKey="insights" lazy><div className="pt-[12px]"><InsightsPanel rows={live} onLevel={(b) => { setLevels([b]); setTab('risks'); }} /></div></TabPanel>
        <TabPanel tabKey="details" lazy><div className="pt-[12px]"><DetailsPanel a={a} editable={ready && canWrite && isEditable(a.status)} onEdit={() => setEditing(true)} /></div></TabPanel>
        <TabPanel tabKey="history" lazy><div className="pt-[12px]"><HistoryPanel a={a} /></div></TabPanel>
      </Tabs>

      <RiskDrawer assessmentId={id} row={openRow} editable={editable} onClose={() => setAddress({ risk: 0 })} onSave={saveRow} saving={!!openRow && saveState[openRow.id] === 'saving'} />
      <AddRisksSheet assessmentId={id} open={adding} onClose={() => setAdding(false)} />
      <EditSheet assessment={a} open={editing} onClose={() => setEditing(false)} />
      {confirmDialog}
    </div>
  );
}

