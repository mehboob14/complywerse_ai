'use client';

/**
 * Assessments > All assessments: every assessment of the organization on the facet explorer (AssessmentExplorer configured by registerConfig.ts). One complete request holds every assessment
 * (the server's true total says when it was cut), the board's score of each (`GET /overview`, joined by id) and what waits for the signed-in person (`GET /my-work`), so every count, facet
 * number and the export are over all of them. A row opens its details panel (a plain click) or the assessment's own page (a modified click, "Open assessment"). The filters, sort, view and the
 * assessment open live in the address (?category= ?type= ?status= ?owner= ?due= ?subject= ?grade= ?quick= ?q= ?sort= ?view= ?open=); the old addresses of the type pages, the NCA and Cyber
 * Security hubs and Pending Approvals forward here (assessments/_forward). No write is made here: an assessment is changed in its own page.
 */
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Fact, FactList, Menu, Notice, SidePanel, StatusPill, useAddressState, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { NOT_SET, formatCount, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { grade, lifecycle, lifecycleOf } from '@/lib/statuses/assessments';
import { gradeOf } from '@/components/assessments/workspace/workspaceModel';
import { DayCell, OwnerCell, PeekTitle, StepButtons, rowOf } from '../../bcm/_register/bits';
import { schemaFor } from '../../bcm/_register/registerModel';
import { AssessmentTabs } from '../_tabs/AssessmentTabs';
import { AREA } from '../_tabs/tabsModel';
import { StartMenu } from '../_types/StartMenu';
import { useBoard, useMeId, useMyWork, useRegisterList, WORK_LIMIT } from '../_data/assessmentData';
import { AssessmentExplorer, type RegisterQuery } from './AssessmentExplorer';
import { DueCell, GapsCell, ScoreCell, scoreText } from './cells';
import { REGISTER, isDone, joinRows, sublineOf, subjectName, typeLabel, type RegisterRow } from './registerConfig';

const SCHEMA = schemaFor(REGISTER);
const MUTED = 'text-ds-fg-muted';

const FIT: Record<'status' | 'score' | 'gaps' | 'due' | 'owner', Omit<FitColumn, 'key'>> = {
  status: { px: 128 },
  score: { px: 168, dropRank: 2 },
  gaps: { px: 112, dropRank: 1 },
  due: { px: 150, dropRank: 3 },
  owner: { px: 68, dropRank: 4, wide: { px: 176, titleMin: 420 } },
};

const recordHref = (id: number) => `/assessments/a/${id}`;
const subline = sublineOf;

interface Env { now: number; onPeek: (id: number) => void }

function columnsFor(env: Env): RecordColumn<RegisterRow>[] {
  return [
    {
      key: 'name', header: 'Assessment', sortKey: 'name',
      cell: (row) => <RowLead row={row}><PeekTitle href={recordHref(row.record.id)} title={row.record.name} onPeek={() => env.onPeek(row.record.id)} sub={subline(row.record)} /></RowLead>,
    },
    { key: 'status', header: 'Status', sortKey: 'status', fit: FIT.status, cell: (row) => <StatusPill size="sm" {...statusPill(lifecycle, lifecycleOf(row.record))} /> },
    { key: 'score', header: 'Score', sortKey: 'score', firstDir: 'desc', fit: FIT.score, cell: (row) => <ScoreCell r={row.record} /> },
    { key: 'gaps', header: 'Gaps', sortKey: 'gaps', firstDir: 'desc', fit: FIT.gaps, cell: (row) => <GapsCell r={row.record} /> },
    { key: 'due', header: 'Due', sortKey: 'due', fit: FIT.due, cell: (row) => <DueCell r={row.record} now={env.now} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: FIT.owner, cell: (row, look) => <OwnerCell name={row.record.owner_name} withName={look.wide} /> },
  ];
}

function AssessmentCard({ row, now }: { row: RecordRow<RegisterRow>; now: number }) {
  const r = row.record;
  const late = !isDone(r) && r.due_date ? new Date(r.due_date).getTime() < now : false;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.name}</span>
      {subline(r) && <span className={`truncate text-ds-label ${MUTED}`}>{subline(r)}</span>}
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusPill size="sm" {...statusPill(lifecycle, lifecycleOf(r))} />
        <ScoreCell r={r} />
        {r.due_date && <span className={`text-ds-label ${late ? 'font-[600] text-ds-danger' : MUTED}`}>{`Due ${formatDate(r.due_date, { calendar: true })}${late ? ' · overdue' : ''}`}</span>}
        <span className="ml-auto"><OwnerCell name={r.owner_name} /></span>
      </span>
    </div>
  );
}

function BoardCard({ r }: { r: RegisterRow }) {
  return (
    <span className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.name}</span>
      {subline(r) && <span className={`truncate text-ds-label ${MUTED}`}>{subline(r)}</span>}
      <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]"><ScoreCell r={r} /></span>
    </span>
  );
}

function Details({ r, now }: { r: RegisterRow; now: number }) {
  const g = r.entry ? gradeOf(r.entry.content) : null;
  const c = r.entry?.sla_counts;
  const total = r.total_items ?? 0;
  const answered = total - (r.in_progress_count ?? 0);
  return (
    <div className="flex flex-col gap-[16px] p-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill size="md" {...statusPill(lifecycle, lifecycleOf(r))} />
        {r.entry && g && <StatusPill size="md" {...statusPill(grade, g)} label={`Score ${scoreText(r.entry.content as number)} · ${grade.label(g)}`} />}
        {(c?.overdue ?? 0) > 0 && <StatusPill size="md" tone="danger" label={`${formatCount(c?.overdue)} ${c?.overdue === 1 ? 'gap' : 'gaps'} overdue`} />}
        {r.waiting && <StatusPill size="md" tone="pending" label="Waiting for you" />}
      </div>
      <FactList min={150}>
        <Fact label="Type">{typeLabel(r)}</Fact>
        <Fact label="Category">{r.category}</Fact>
        {r.scope_model && <Fact label="Subject">{subjectName(r)}</Fact>}
        <Fact label="Owner" empty="Unassigned">{r.owner_name ? <OwnerCell name={r.owner_name} withName /> : null}</Fact>
        <Fact label="Assessor" empty={NOT_SET}>{r.assessor}</Fact>
        <Fact label="Due" empty={NOT_SET}>{r.due_date ? <DayCell value={r.due_date} now={now} noun="Due" late={!isDone(r)} /> : null}</Fact>
        {r.started_at && <Fact label="Started">{formatDate(r.started_at)}</Fact>}
        <Fact label="Controls">{total > 0 ? `${formatCount(answered)} of ${formatCount(total)} answered` : null}</Fact>
        <Fact label="Remediation SLA">{r.entry?.sla != null ? scoreText(r.entry.sla) : null}</Fact>
        <Fact label="Open gaps">{c ? formatCount(c.open ?? 0) : null}</Fact>
      </FactList>
      {!r.entry && r.boardKnown && <p className={`m-0 text-ds-label ${MUTED}`}>The board does not score this assessment yet: a draft being scoped, an uploaded workbook or a questionnaire already started from is not counted.</p>}
    </div>
  );
}

export function AssessmentsRegister() {
  const router = useRouter();
  const [address, setAddress] = useAddressState(SCHEMA);
  const list = useRegisterList();
  const board = useBoard();
  const work = useMyWork(WORK_LIMIT);
  const me = useMeId();

  const rows = useMemo(() => (list.data ? joinRows(list.data.rows, board.data, work.data) : undefined), [list.data, board.data, work.data]);
  const query: RegisterQuery = { rows, total: list.data?.total, truncated: list.data?.truncated, isPending: list.isPending, isError: list.isError, error: list.error, refetch: list.refetch };
  const now = useMemo(() => Date.now(), [rows]);                           // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: number) => router.push(recordHref(id));
  const rowMenu = (r: RegisterRow) => {
    const items: MenuItem[] = [
      { key: 'peek', label: 'Open details', icon: Eye, onSelect: () => setAddress({ open: r.id }) },
      { key: 'open', label: 'Open assessment', icon: ArrowUpRight, onSelect: () => open(r.id) },
    ];
    return <Menu iconOnly label={`Actions for ${truncate(r.name, 60).text}`} items={items} />;
  };

  // what could not be joined to the list: said, with Retry, never a quiet empty column
  const cut = work.data && (work.data.counts.assigned > work.data.assigned_items.length || work.data.counts.to_scope > work.data.scoping.length || work.data.counts.to_approve > work.data.approvals.length);
  const notices = list.data ? (
    <>
      {board.isError && (
        <ErrorState compact title="Scores couldn't be loaded" message={`${errorMessage(board.error)} The Score and Gaps columns show a dash until they load.`} onRetry={canRetry(board.error) ? () => { void board.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
      )}
      {work.isError && (
        <ErrorState compact title="What waits for you couldn't be loaded" message={`${errorMessage(work.error)} "Waiting for me" is empty until it loads.`} onRetry={canRetry(work.error) ? () => { void work.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
      )}
      {cut && <Notice tone="info" title="Only part of what waits for you is listed">{`The server lists up to ${WORK_LIMIT} of each kind of work, so "Waiting for me" may miss an assessment. The counts on the Overview are whole.`}</Notice>}
    </>
  ) : null;

  const head = (meta?: string) => (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={AREA}
        info="Every assessment of the organization in one list: what kind it is, what it is of, how it scores and who owns it. A row opens the assessment."
        meta={meta}
        actions={<StartMenu />}
      />
      <AssessmentTabs />
    </div>
  );

  return (
    <AssessmentExplorer
      address={address}
      setAddress={setAddress}
      query={query}
      me={me}
      head={(_fit, meta) => head(meta)}
      columns={columnsFor({ now, onPeek: (id) => setAddress({ open: id }) })}
      card={(row) => <AssessmentCard row={row} now={now} />}
      rowMenu={rowMenu}
      boardCard={(r) => <BoardCard r={r} />}
      notices={notices}
      firstUse={(
        <EmptyState
          kind="firstUse" bare title="No assessments yet"
          description="Start one for an application, a function or a system, or upload a workbook from Types."
          action={<div className="flex flex-wrap justify-center gap-[8px]"><StartMenu /><Button href="/assessments/types">Upload a workbook</Button></div>}
        />
      )}
      drawer={({ row, onClose, onStep, hasPrev, hasNext }) => (
        <SidePanel
          open={!!row}
          onClose={onClose}
          title={<span dir="auto" className="line-clamp-3 break-words" title={row?.name}>{row?.name}</span>}
          subtitle={row ? (subline(row) || row.category) : undefined}
          dockFrom={Infinity}
          width="md"
          restoreFocus={rowOf(row?.id ?? null)}
          actions={row && <StepButtons noun="assessment" hasPrev={hasPrev} hasNext={hasNext} onStep={onStep} />}
          footer={row && (
            <div className="flex flex-wrap items-center gap-[8px]">
              <Button variant="primary" rightIcon={<ArrowUpRight aria-hidden />} onClick={() => open(row.id)}>Open assessment</Button>
            </div>
          )}
        >
          {row && <Details r={row} now={now} />}
        </SidePanel>
      )}
    />
  );
}
