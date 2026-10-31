'use client';

// Governance > Committees: where every committee stands now. Six numbers, the committees (a table; a card each below 768px) with the selected one's meetings
// and actions beside it, six months of progress and the people who close the most actions.
// On the design-system kit (components/ui/ds): PageHeader variant="page", SectionCard, RegisterTable + Pager, StatusPill, PersonChip, EmptyState / ErrorState,
// useReportedMutation for every write and useConfirm for the delete. Every number says what it rests on: a tile whose source cannot be set today (attendance,
// quorum, minutes, meetings held: no screen marks a meeting completed or enters attendance) says "Not recorded" and, from an (i), what is missing, instead of 0%
// (lib/committees.ts holds the rules and their tests). The score and its formulas are the server's (committees.py, GET /overview); this page only says how far
// the data behind them goes. Deleting a committee is still the server's hard delete, now asked in a dialog that names what goes with it:
// G4_committee_deactivation_plan.md is the plan for replacing it with Deactivate.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Calendar, CalendarPlus, CheckSquare, ClipboardList, Plus, Search, Trash2, TrendingUp, Trophy, UserCheck, Users, X, AlertTriangle, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { assetsApi, committeeApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { ScoreRing, scoreBand } from '@/components/dashboard/score-kit';
import {
  Button, EmptyState, ErrorState, FormField, IconButton, Pager, PersonChip, RegisterTable, SectionCard, Select, Skeleton, SkeletonLines, StatusPill, Textarea, TextInput,
  sortRows, type RegisterColumn, type SortState,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount, formatPercent, truncate } from '@/lib/format';
import { parseUtc } from '@/lib/serverTime';
import { pageRange } from '@/lib/pagerModel';
import { routeFor } from '@/lib/navRegistry';
import { TONE } from '@/lib/status';
import {
  NOT_RECORDED, actionsDoneReading, attendanceReading, committeeTypeLabel, deleteCommitteePlan, dueDay, dueRelative, formChanged, gradeTone, isOverdueAction, listOf,
  matchesCommittee, measureHasData, measureReason, meetingDay, meetingRelative, meetingsHeldReading, overdueReading, performanceReading, upcomingMeetings,
  type Overview, type OverviewCommittee, type OverviewMeeting, type OverviewMetric, type OverviewMonth,
} from '@/lib/committees';
import { ActionStatusPills, CommitteeActivity, DrawerFooter, FormProblem, NotRecorded, PickerField, StatTile } from './_ui';

interface ActionRow {
  id: number;
  title: string;
  status: string;
  is_overdue?: boolean;
  due_date?: string | null;
  committee_name?: string;
  assigned_to_name?: string;
}
interface TenantUserOption { id: number; display_name?: string; email?: string }

const COMMITTEE_TYPE_ITEMS = ['board', 'risk_committee', 'audit_committee', 'compliance_committee', 'it_steering', 'custom'].map((value) => ({ value, label: committeeTypeLabel(value, 'long') }));
const MEETING_TYPE_ITEMS = [
  { value: 'regular', label: 'Regular' },
  { value: 'special', label: 'Special' },
  { value: 'emergency', label: 'Emergency' },
];
const AGENDA_TYPE_ITEMS = [
  { value: 'discussion', label: 'Discussion' },
  { value: 'approval', label: 'Approval' },
  { value: 'information', label: 'Information' },
  { value: 'action_review', label: 'Action review' },
];
const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'ad_hoc', label: 'Ad hoc' },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key: string): string => MONTH_ABBR[(parseInt(key.split('-')[1], 10) || 1) - 1] || key;
const short = (name: string): string => truncate(name, 60).text;
const SUB_HEAD = 'text-ds-label text-ds-fg-muted';
const PAGE_SIZES = [10, 25, 50];

export default function CommitteesDashboardPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:committees:create');
  const canDelete = hasPermission('governance:committees:delete');
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [perfOpen, setPerfOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [committeeModalOpen, setCommitteeModalOpen] = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  // ── data (the same keys and requests as ever) ──
  const overviewQ = useQuery({
    queryKey: ['committee-overview'],
    queryFn: async () => (await committeeApi.getOverview()).data as Overview,
  });
  const overview = overviewQ.data;

  // the right-hand list: the selected committee's actions, else the overdue ones; `total` is the API's, the list is what it sent (capped at 100)
  const panelActionsQ = useQuery({
    queryKey: ['committee-panel-actions', selectedId],
    queryFn: async () => {
      const res = await committeeApi.getActions(selectedId ? { committee_id: selectedId } : { overdue_only: true });
      const { items, total } = listOf<Record<string, any>>(res.data);
      return {
        total,
        items: items.map((a) => ({
          id: a.id, title: a.title, status: a.status, is_overdue: a.is_overdue, due_date: a.due_date, committee_name: a.committee_name,
          assigned_to_name: a.assigned_to_name || a.assignee_name || '',
        })) as ActionRow[],
      };
    },
    enabled: !overviewQ.isLoading,
  });

  // the selected committee's own upcoming meetings, fetched per committee rather than cut from the overview's top six
  const panelMeetingsQ = useQuery({
    queryKey: ['committee-panel-meetings', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { items } = listOf<Record<string, any>>((await committeeApi.getMeetings(selectedId as number)).data);
      return upcomingMeetings(items.map((m) => ({
        id: m.id, title: m.title, committee_id: selectedId as number, committee_name: null, scheduled_date: m.scheduled_date, status: m.status,
      })) as OverviewMeeting[]);
    },
  });

  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['tenant-users-committee'],
    queryFn: async () => ((await assetsApi.getTenantUsers()).data || []) as TenantUserOption[],
  });

  const committees = useMemo(() => overview?.committees ?? [], [overview]);
  const selected = useMemo(() => committees.find((c) => c.id === selectedId) ?? null, [committees, selectedId]);
  const userItems = useMemo(
    () => tenantUsers.map((u) => ({ value: String(u.id), label: u.display_name || u.email || `User ${u.id}`, subLabel: u.email })),
    [tenantUsers],
  );
  const committeeItems = useMemo(() => committees.map((c) => ({ value: String(c.id), label: c.name })), [committees]);

  // a selected committee that is gone after a refetch (deleted elsewhere) clears the selection, so the panel cannot show a stale one
  useEffect(() => {
    if (selectedId != null && committees.length && !committees.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [committees, selectedId]);

  // ── the table: search, sort, page (all of the committees are already here: the overview sends every one) ──
  const rows = useMemo(() => {
    const found = committees.filter((c) => matchesCommittee(c, search));
    return sortRows(found, sort, (c, key) => (key === 'next' ? parseUtc(c.next_meeting_date) : c.name));
  }, [committees, search, sort]);
  const range = pageRange(page, pageSize, rows.length);
  const pageRows = rows.slice(range.from === 0 ? 0 : range.from - 1, range.to);

  // ── the delete: the server's hard delete, asked in a dialog that says what goes with it ──
  const del = useReportedMutation({
    mutationFn: (c: OverviewCommittee) => committeeApi.deleteCommittee(c.id),
    success: (_r, c) => `Deleted ${short(c.name)}`,
    failure: "Couldn't delete the committee",
    invalidate: [['committee-overview']],
    onSuccess: () => setSelectedId(null),
  });
  const askDelete = async (c: OverviewCommittee) => {
    const plan = deleteCommitteePlan(short(c.name));
    if (await confirm({ title: plan.title, message: plan.message, confirmLabel: plan.confirmLabel, tone: 'danger' })) del.mutate(c);
  };

  if (overviewQ.isLoading) {
    return (
      <div className="space-y-[16px]" aria-busy="true">
        <PageHeader variant="page" title={routeFor('/governance/committees')?.label ?? 'Committees'} />
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[104px]" />)}
        </div>
        <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px] lg:col-span-2"><SkeletonLines lines={6} label="Loading committees" /></div>
          <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={5} label="Loading the selected committee" /></div>
        </div>
      </div>
    );
  }

  const title = routeFor('/governance/committees')?.label ?? 'Committees';
  if (overviewQ.isError || !overview) {
    return (
      <div className="space-y-[16px]">
        <PageHeader variant="page" title={title} />
        <ErrorState title="Couldn't load the committees" message={errorMessage(overviewQ.error)} onRetry={() => { void overviewQ.refetch(); }} />
      </div>
    );
  }

  const k = overview.kpis;
  const isEmpty = k.total_committees === 0;
  const performance = performanceReading(k.performance);
  const actionsDone = actionsDoneReading(k);
  const overdue = overdueReading(k);
  const attendance = attendanceReading(k);
  const inactive = committees.filter((c) => !c.is_active).length;

  // Four columns, so the table fits the two-thirds it has beside the panel at 1280px: the type and the member count sit under the name (and are lines of the
  // card below 768px).
  const columns: RegisterColumn<OverviewCommittee>[] = [
    {
      key: 'name', header: 'Committee', isRowHeader: true, sortable: true,
      cell: (c) => (
        <>
          <Link href={`/governance/committees/${c.id}`} title={c.name} className="line-clamp-2 break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{c.name}</Link>
          <span className="block text-ds-label font-normal text-ds-fg-muted">{committeeTypeLabel(c.committee_type)} · {formatCount(c.members_count)} {c.members_count === 1 ? 'member' : 'members'}</span>
        </>
      ),
    },
    {
      key: 'next', header: 'Next meeting', sortable: true, width: 'w-[132px]', card: 'meta',
      cell: (c) => (c.next_meeting_date
        ? (<><span className="whitespace-nowrap">{meetingDay(c.next_meeting_date)}</span><span className="block text-ds-label text-ds-fg-muted">{meetingRelative(c.next_meeting_date)}</span></>)
        : <span className="text-ds-fg-muted">None scheduled</span>),
    },
    {
      key: 'actions', header: 'Actions', width: 'w-[148px]', card: 'meta',
      cell: (c) => (c.total_actions === 0
        ? <span className="text-ds-fg-muted">No actions</span>
        : (
          <span className="flex flex-wrap items-center gap-[4px]">
            {c.overdue_actions > 0 && <StatusPill size="sm" tone="danger" label={`${formatCount(c.overdue_actions)} overdue`} />}
            {c.open_actions + c.in_progress_actions > 0 && <StatusPill size="sm" tone="pending" label={`${formatCount(c.open_actions + c.in_progress_actions)} open`} />}
            {c.completed_actions > 0 && <StatusPill size="sm" tone="success" label={`${formatCount(c.completed_actions)} done`} />}
          </span>
        )),
    },
    { key: 'status', header: 'Status', width: 'w-[96px]', card: 'meta', cell: (c) => <CommitteeActivity size="sm" active={c.is_active} /> },
  ];

  return (
    <div className="space-y-[16px]">
      <PageHeader
        variant="page"
        title={title}
        info="Where every committee stands right now: its meetings, open actions and performance."
        meta={isEmpty ? undefined : `${formatCount(k.total_committees)} ${k.total_committees === 1 ? 'committee' : 'committees'}`}
        actions={(
          <>
            <Button href="/governance/committees/actions" leftIcon={<ClipboardList aria-hidden />}>All actions</Button>
            {canCreate && (
              <>
                <Button leftIcon={<CalendarPlus aria-hidden />} onClick={() => setMeetingModalOpen(true)} disabled={isEmpty}>New meeting</Button>
                <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCommitteeModalOpen(true)}>New committee</Button>
              </>
            )}
          </>
        )}
      />

      {isEmpty ? (
        <EmptyState
          kind="firstUse"
          icon={Users}
          title="No committees yet"
          description="Create a committee to track its meetings, oversight actions and performance."
          action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCommitteeModalOpen(true)}>Create the first committee</Button> : undefined}
        />
      ) : (
        <>
          {/* ── the six numbers: each says what it rests on ── */}
          <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Performance"
              icon={TrendingUp}
              value={performance.score == null ? null : String(Math.round(performance.score))}
              why={performance.why}
              visual={performance.score == null ? undefined : (
                <>
                  <ScoreRing score={performance.score} size={52} />
                  {performance.grade && <StatusPill tone={gradeTone(performance.grade)} label={performance.grade.charAt(0).toUpperCase() + performance.grade.slice(1)} />}
                </>
              )}
              note={performance.note && (
                <span className="inline-flex items-center gap-[4px]">{performance.note}<InfoTip text={performance.why} label="Which measures have no data" /></span>
              )}
              action={<Button variant="link" size="sm" onClick={() => setPerfOpen(true)}>How it is calculated</Button>}
            />
            <StatTile
              label="Committees"
              icon={Users}
              value={formatCount(k.active_committees)}
              note={`${formatCount(k.total_committees)} total · ${formatCount(k.charters_active)} active ${k.charters_active === 1 ? 'charter' : 'charters'}`}
            />
            <StatTile
              label="Meetings"
              icon={Calendar}
              value={formatCount(k.meetings_upcoming)}
              note={`upcoming · ${formatCount(k.meetings_this_quarter)} this quarter`}
            />
            <StatTile
              label="Actions done"
              icon={CheckSquare}
              value={actionsDone.value}
              why={actionsDone.why}
              tone="success"
              bar={actionsDone.value === null ? null : k.actions.pct_done}
              note={actionsDone.note}
            />
            <StatTile
              label="Overdue"
              icon={AlertTriangle}
              value={overdue.value}
              why={overdue.why}
              tone={k.actions.overdue > 0 ? 'danger' : 'default'}
              note={overdue.note}
            />
            <StatTile
              label="Attendance"
              icon={UserCheck}
              value={attendance.value}
              why={attendance.why}
              bar={attendance.value === null ? null : k.avg_attendance_pct}
              note={attendance.note}
            />
          </div>

          {/* ── the committees (left) and the selected one's meetings and actions (right) ── */}
          <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <SectionCard
                id="committees"
                title="Committees"
                info="Select a committee to see its upcoming meetings and its actions beside the list. Its name opens it."
                meta={inactive > 0 ? `${formatCount(committees.length)} · ${formatCount(inactive)} inactive` : formatCount(committees.length)}
                actions={(
                  <TextInput
                    type="search"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder="Search committees"
                    aria-label="Search committees"
                    leftAdornment={<Search aria-hidden />}
                    className="w-[220px] max-w-full"
                  />
                )}
              >
                <RegisterTable<OverviewCommittee>
                  caption="Committees"
                  columns={columns}
                  rows={pageRows}
                  getRowId={(c) => c.id}
                  sort={sort}
                  onSortChange={(next) => { setSort(next); setPage(1); }}
                  selectedId={selectedId}
                  onRowActivate={(c) => setSelectedId(c.id === selectedId ? null : c.id)}
                  cardTitle={(c) => (
                    <>
                      <Link href={`/governance/committees/${c.id}`} title={c.name} className="break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{c.name}</Link>
                      <span className="block text-ds-label font-normal text-ds-fg-muted">{committeeTypeLabel(c.committee_type)} · {formatCount(c.members_count)} {c.members_count === 1 ? 'member' : 'members'}</span>
                    </>
                  )}
                  empty={(
                    <EmptyState
                      kind="noMatches"
                      bare
                      title="No committee matches"
                      description={`Nothing named or typed “${truncate(search.trim(), 40).text}”.`}
                      onClearFilters={() => { setSearch(''); setPage(1); }}
                    />
                  )}
                  footer={rows.length > PAGE_SIZES[0] ? (
                    <Pager
                      page={range.page}
                      pageSize={pageSize}
                      total={rows.length}
                      onPage={setPage}
                      onPageSize={(n) => { setPageSize(n); setPage(1); }}
                      pageSizes={PAGE_SIZES}
                      noun="committees"
                    />
                  ) : undefined}
                />
              </SectionCard>
            </div>

            <aside className="min-w-0 lg:col-span-1">
              <div className="lg:sticky lg:top-4">
                <ContextPanel
                  selected={selected}
                  meetings={selected ? panelMeetingsQ : null}
                  allMeetings={overview.upcoming_meetings}
                  actions={panelActionsQ}
                  canDelete={canDelete}
                  deleting={del.isPending}
                  onDelete={askDelete}
                  onClear={() => setSelectedId(null)}
                />
              </div>
            </aside>
          </div>

          {/* ── six months, and who closes the most ── */}
          <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
            <ProgressChart data={overview.progress_over_time} held={meetingsHeldReading(k)} />
            <TopPerformers rows={overview.top_performers} />
          </div>

          <AnimatedModal
            isOpen={perfOpen}
            onClose={() => setPerfOpen(false)}
            size="lg"
            title="Committee performance"
            subtitle="Weighted mean of five formulas: the same score as the Governance overview"
          >
            <PerformanceDetail kpis={k} />
          </AnimatedModal>
        </>
      )}

      <CreateCommitteePanel
        open={committeeModalOpen}
        onClose={() => setCommitteeModalOpen(false)}
        userItems={userItems}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['committee-overview'] })}
      />
      <CreateMeetingPanel
        open={meetingModalOpen}
        onClose={() => setMeetingModalOpen(false)}
        committeeItems={committeeItems}
        defaultCommitteeId={selectedId}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['committee-overview'] })}
      />
      {confirmDialog}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance: each measure, its weight, its count and the exact formula, or why it has no data
// ─────────────────────────────────────────────────────────────────────────────
function MeasureRow({ m }: { m: OverviewMetric }) {
  const has = measureHasData(m);
  const band = scoreBand(m.score);
  return (
    <li className="px-[16px] py-[12px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[4px]">
        <span className="min-w-0 text-ds-body font-medium text-ds-fg">
          {m.label}
          <span className="ml-[8px] text-ds-label font-normal text-ds-fg-muted">weight {Math.round(m.weight * 100)}%</span>
        </span>
        <span className="flex items-baseline gap-[8px]">
          {has && <span className="text-ds-label tabular-nums text-ds-fg-muted">{formatCount(m.numerator)} of {formatCount(m.denominator)}</span>}
          {has ? <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{formatPercent(m.score)}</span> : <span className="text-ds-body text-ds-fg-muted">{NOT_RECORDED}</span>}
        </span>
      </div>
      <div aria-hidden className="mt-[8px] h-[8px] overflow-hidden rounded-full bg-ds-border">
        {has && <div className="h-full rounded-full" style={{ width: `${Math.max(m.score === 0 ? 3 : 0, Math.min(100, m.score as number))}%`, background: band.hex }} />}
      </div>
      <p className="mt-[6px] text-ds-label font-normal text-ds-fg-muted">{has ? `= ${m.formula}` : measureReason(m)}</p>
    </li>
  );
}

function PerformanceDetail({ kpis }: { kpis: Overview['kpis'] }) {
  const perf = performanceReading(kpis.performance);
  const metrics = kpis.performance?.metrics ?? [];
  if (!kpis.performance) return <p className="p-[20px] text-ds-body text-ds-fg-muted">{NOT_RECORDED}</p>;
  return (
    <div className="space-y-[16px] p-[20px]">
      <div className="flex items-center gap-[16px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[16px]">
        {perf.score == null ? <span className="text-ds-body text-ds-fg-muted">{NOT_RECORDED}</span> : <ScoreRing score={perf.score} size={72} />}
        <div className="min-w-0">
          {perf.grade && perf.score != null && <StatusPill tone={gradeTone(perf.grade)} label={perf.grade.charAt(0).toUpperCase() + perf.grade.slice(1)} />}
          <p className="mt-[6px] text-ds-label font-normal text-ds-fg-muted">
            {perf.score == null ? perf.why : `${perf.note || 'Every measure has data.'} A measure with no data is left out and the weights of the others are re-scaled.`}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border">
        {metrics.map((m) => <MeasureRow key={m.key} m={m} />)}
      </ul>
      {perf.score != null && (
        <p className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[14px] py-[10px] text-ds-label font-normal text-ds-fg-body">
          <span className="font-[600]">Score</span> = {metrics.filter((m) => m.score != null).map((m) => `${Math.round(m.score as number)}×${Math.round(m.weight * 100)}%`).join(' + ')} = <span className="font-[600]">{Math.round(perf.score)}</span>
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context panel: the selected committee's upcoming meetings and actions (else: what is coming and what is late)
// ─────────────────────────────────────────────────────────────────────────────
function ContextPanel({ selected, meetings, allMeetings, actions, canDelete, deleting, onDelete, onClear }: {
  selected: OverviewCommittee | null;
  meetings: { data?: OverviewMeeting[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown } | null;
  allMeetings: OverviewMeeting[];
  actions: { data?: { items: ActionRow[]; total: number }; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  canDelete?: boolean;
  deleting?: boolean;
  onDelete: (c: OverviewCommittee) => void;
  onClear: () => void;
}) {
  const shownMeetings = selected ? (meetings?.data ?? []) : allMeetings;
  const MEETINGS_SHOWN = 5;
  const ACTIONS_SHOWN = 8;
  const actionItems = actions.data?.items ?? [];
  const actionTotal = actions.data?.total ?? 0;
  return (
    <SectionCard
      id="committee-context"
      title={selected ? short(selected.name) : 'All committees'}
      info={selected ? 'The selected committee: its next meetings and its actions.' : 'The next meetings and the overdue actions of every committee. Select a committee to narrow it down.'}
      actions={selected ? (
        <>
          <Button href={`/governance/committees/${selected.id}`} variant="link" size="sm" rightIcon={<ArrowUpRight aria-hidden />}>Open committee</Button>
          {canDelete && <IconButton label={`Delete ${short(selected.name)}`} disabled={deleting} onClick={() => onDelete(selected)}><Trash2 aria-hidden /></IconButton>}
          <IconButton label="Clear selection" onClick={onClear}><X aria-hidden /></IconButton>
        </>
      ) : undefined}
    >
      <div className="space-y-[16px]">
        <div>
          <p className={SUB_HEAD}>Upcoming meetings</p>
          {selected && meetings?.isLoading ? (
            <div className="mt-[8px]"><SkeletonLines lines={2} label="Loading meetings" /></div>
          ) : selected && meetings?.isError ? (
            <ErrorState compact title="Couldn't load the meetings" message={errorMessage(meetings.error)} onRetry={() => { void meetings.refetch(); }} />
          ) : shownMeetings.length === 0 ? (
            <p className="mt-[8px] text-ds-body text-ds-fg-muted">No meetings scheduled yet.</p>
          ) : (
            <>
              <ul className="mt-[8px] space-y-[10px]">
                {shownMeetings.slice(0, MEETINGS_SHOWN).map((m) => (
                  <li key={m.id}>
                    <Link href={`/governance/committees/meetings/${m.id}`} className="group flex items-start justify-between gap-[8px] rounded-ds-control focus-visible:outline-none focus-visible:shadow-ds-ring">
                      <span className="min-w-0">
                        <span className="line-clamp-2 break-words text-ds-body text-ds-fg group-hover:underline" title={m.title}>{m.title}</span>
                        {!selected && m.committee_name && <span className="block truncate text-ds-label font-normal text-ds-fg-muted">{m.committee_name}</span>}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-ds-label font-normal text-ds-fg-muted">{meetingDay(m.scheduled_date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {shownMeetings.length > MEETINGS_SHOWN && selected && (
                <p className="mt-[8px]">
                  <Button href={`/governance/committees/${selected.id}?tab=meetings`} variant="link" size="sm">+{formatCount(shownMeetings.length - MEETINGS_SHOWN)} more meetings</Button>
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <p className={SUB_HEAD}>{selected ? 'Actions' : 'Needs attention (overdue)'}</p>
          {actions.isLoading ? (
            <div className="mt-[8px]"><SkeletonLines lines={3} label="Loading actions" /></div>
          ) : actions.isError ? (
            <ErrorState compact title="Couldn't load the actions" message={errorMessage(actions.error)} onRetry={() => { void actions.refetch(); }} />
          ) : actionItems.length === 0 ? (
            <p className="mt-[8px] text-ds-body text-ds-fg-muted">{selected ? 'No actions for this committee.' : 'Nothing is overdue.'}</p>
          ) : (
            <>
              <ul className="mt-[8px] space-y-[12px]">
                {actionItems.slice(0, ACTIONS_SHOWN).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-[8px]">
                    <span className="min-w-0">
                      <span className="line-clamp-2 break-words text-ds-body text-ds-fg" title={a.title}>{a.title}</span>
                      <span className="mt-[2px] flex flex-wrap items-center gap-x-[8px] text-ds-label font-normal text-ds-fg-muted">
                        <PersonChip name={a.assigned_to_name} size={20} />
                        {a.due_date && (
                          <span className={isOverdueAction(a) ? 'text-ds-danger' : undefined}>Due {dueDay(a.due_date)} · {dueRelative(a.due_date)}</span>
                        )}
                      </span>
                    </span>
                    <ActionStatusPills size="sm" action={a} />
                  </li>
                ))}
              </ul>
              {actionTotal > ACTIONS_SHOWN && (
                <p className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">
                  {ACTIONS_SHOWN} of {formatCount(actionTotal)} ·{' '}
                  <Link href="/governance/committees/actions" className="text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">All actions</Link>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress over time: actions completed per month; "meetings held" only while any meeting is marked completed
// ─────────────────────────────────────────────────────────────────────────────
function ProgressChart({ data, held }: { data: OverviewMonth[]; held: { recorded: boolean; why: string } }) {
  const anyActivity = data.some((d) => d.actions_completed > 0 || (held.recorded && d.meetings_held > 0));
  const rows = data.map((d) => ({ month: monthLabel(d.month), 'Meetings held': d.meetings_held, 'Actions completed': d.actions_completed }));
  return (
    <SectionCard
      id="progress"
      title="Progress over time"
      meta="Organisation-wide, last 6 months"
      actions={!held.recorded ? <span className="inline-flex items-center gap-[4px] text-ds-body text-ds-fg-muted">Meetings held: {NOT_RECORDED}<InfoTip text={held.why} label="Why meetings held is not recorded" /></span> : undefined}
    >
      {!anyActivity ? (
        <p className="py-[16px] text-center text-ds-body text-ds-fg-muted">{held.recorded ? 'No meetings or completed actions recorded yet.' : 'No completed actions recorded yet.'}</p>
      ) : (
        <>
          <div aria-hidden="true" className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" stroke="#e5e8ec" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#586472' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#586472' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RTooltip contentStyle={{ fontSize: 12, border: '1px solid #d1d7df', borderRadius: 8, color: '#1a1a1a' }} />
                {held.recorded && <Area type="monotone" dataKey="Meetings held" stroke={TONE.progress.dot} strokeWidth={2} fill={TONE.progress.tint} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />}
                <Area type="monotone" dataKey="Actions completed" stroke={TONE.success.dot} strokeWidth={2} fill={TONE.success.tint} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* the same numbers for a screen reader: the chart is a picture of this table */}
          <table className="sr-only">
            <caption>Progress over time, last 6 months</caption>
            <thead><tr><th scope="col">Month</th>{held.recorded && <th scope="col">Meetings held</th>}<th scope="col">Actions completed</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}><th scope="row">{r.month}</th>{held.recorded && <td>{r['Meetings held']}</td>}<td>{r['Actions completed']}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-[8px] flex flex-wrap items-center gap-x-[16px] gap-y-[4px] text-ds-label font-normal text-ds-fg-muted">
            <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: TONE.success.dot }} />Actions completed</span>
            {held.recorded && <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: TONE.progress.dot }} />Meetings held</span>}
          </p>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top performers
// ─────────────────────────────────────────────────────────────────────────────
function TopPerformers({ rows }: { rows: Overview['top_performers'] }) {
  return (
    <SectionCard id="top-performers" title="Top performers" meta="By action completion" actions={<Trophy aria-hidden className="h-[16px] w-[16px] text-ds-fg-muted" strokeWidth={1.75} />}>
      {rows.length === 0 ? (
        <p className="py-[16px] text-center text-ds-body text-ds-fg-muted">No action assignments yet.</p>
      ) : (
        <ol className="space-y-[12px]">
          {rows.map((r, i) => (
            <li key={r.user_id} className="flex items-start gap-[12px]">
              <span aria-hidden className="mt-[2px] grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-surface-hover text-ds-label tabular-nums text-ds-fg-body">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-[8px]">
                  <PersonChip name={r.name} size={24} />
                  <span className="shrink-0 text-ds-body font-[600] tabular-nums text-ds-fg">{formatPercent(r.completion_pct)}</span>
                </div>
                <div aria-hidden className="mt-[6px] h-[6px] overflow-hidden rounded-full bg-ds-border"><div className="h-full rounded-full bg-ds-primary" style={{ width: `${Math.min(100, r.completion_pct)}%` }} /></div>
                <span className="mt-[4px] block text-ds-label font-normal text-ds-fg-muted">{formatCount(r.completed)} of {formatCount(r.assigned)} done · {formatCount(r.on_time)} on time</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New committee (drawer)
// ─────────────────────────────────────────────────────────────────────────────
const NEW_COMMITTEE = { name: '', description: '', committee_type: 'custom', chair_id: '', secretary_id: '', meeting_frequency: 'quarterly' };

function CreateCommitteePanel({ open, onClose, userItems, onSaved }: {
  open: boolean; onClose: () => void;
  userItems: { value: string; label: string; subLabel?: string }[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState(NEW_COMMITTEE);
  const create = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createCommittee(data),
    success: (_r, data) => `Committee ${short(String(data.name))} created`,
    failure: "Couldn't create the committee",
    retryable: false,                                                   // a create is not safe to repeat blindly: the drawer stays open to try again
    onSuccess: () => { onSaved(); onClose(); setForm(NEW_COMMITTEE); },
  });
  const close = () => { create.reset(); onClose(); };
  const set = (patch: Partial<typeof NEW_COMMITTEE>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="New committee"
      dirty={formChanged(NEW_COMMITTEE, form)}
      footer={<DrawerFooter onCancel={close} form="create-committee-form" pending={create.isPending} label="Create committee" pendingLabel="Creating…" disabled={!form.name.trim()} />}
    >
      <form
        id="create-committee-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ ...form, chair_id: form.chair_id ? parseInt(form.chair_id, 10) : null, secretary_id: form.secretary_id ? parseInt(form.secretary_id, 10) : null });
        }}
        className="flex flex-col gap-[16px]"
      >
        {create.isError && <FormProblem message={errorMessage(create.error, 'The committee could not be created.')} />}
        <FormField label="Committee name" required>
          <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={255} required />
        </FormField>
        <FormField label="Description" optional>
          <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={2} />
        </FormField>
        <FormField label="Type">
          <Select value={form.committee_type} onChange={(e) => set({ committee_type: e.target.value })}>
            {COMMITTEE_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <PickerField label="Chair" optional>
            <MultiSelectDropdown title="Chair" items={userItems} selectedValues={form.chair_id ? [form.chair_id] : []}
              onApply={(v) => set({ chair_id: v[0] || '' })} multiSelect={false} autoApply triggerVariant="input" forceSearch placeholder="Select" size="sm" triggerClassName="w-full" />
          </PickerField>
          <PickerField label="Secretary" optional>
            <MultiSelectDropdown title="Secretary" items={userItems} selectedValues={form.secretary_id ? [form.secretary_id] : []}
              onApply={(v) => set({ secretary_id: v[0] || '' })} multiSelect={false} autoApply triggerVariant="input" forceSearch placeholder="Select" size="sm" triggerClassName="w-full" />
          </PickerField>
        </div>
        <FormField label="Meeting frequency">
          <Select value={form.meeting_frequency} onChange={(e) => set({ meeting_frequency: e.target.value })}>
            {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </FormField>
      </form>
    </RightSlidePanel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New meeting (drawer): one screen, details and an inline agenda
// ─────────────────────────────────────────────────────────────────────────────
interface AgendaDraft { title: string; item_type: string }
const NEW_MEETING = { committee_id: '', title: '', meeting_type: 'regular', scheduled_date: '', location: '', virtual_link: '', quorum_required: '' };

function CreateMeetingPanel({ open, onClose, committeeItems, defaultCommitteeId, onSaved }: {
  open: boolean; onClose: () => void;
  committeeItems: { value: string; label: string }[];
  defaultCommitteeId: number | null;
  onSaved: () => void;
}) {
  const blank = { ...NEW_MEETING, committee_id: defaultCommitteeId ? String(defaultCommitteeId) : '' };
  const [form, setForm] = useState(blank);
  const [agenda, setAgenda] = useState<AgendaDraft[]>([]);
  const [agendaDraft, setAgendaDraft] = useState<AgendaDraft>({ title: '', item_type: 'discussion' });
  // the meeting once created, so a retry after an agenda item failed never makes a SECOND meeting (cleared on open and on reset)
  const [createdMeetingId, setCreatedMeetingId] = useState<number | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  // the committee that was selected when the drawer opens is the one pre-chosen (the first useState ran at mount, when nothing was selected yet)
  useEffect(() => {
    if (open) {
      setForm((f) => ({ ...f, committee_id: defaultCommitteeId ? String(defaultCommitteeId) : f.committee_id }));
      setCreatedMeetingId(null);
      setWarn(null);
    }
  }, [open, defaultCommitteeId]);

  const reset = () => {
    setForm({ ...NEW_MEETING, committee_id: defaultCommitteeId ? String(defaultCommitteeId) : '' });
    setAgenda([]);
    setAgendaDraft({ title: '', item_type: 'discussion' });
    setCreatedMeetingId(null);
    setWarn(null);
  };
  const addAgendaItem = () => {
    const title = agendaDraft.title.trim();
    if (!title) return;
    setAgenda([...agenda, { ...agendaDraft, title }]);
    setAgendaDraft({ title: '', item_type: agendaDraft.item_type });
  };

  const create = useReportedMutation({
    mutationFn: async () => {
      setWarn(null);
      const committeeId = parseInt(form.committee_id, 10);
      let meetingId = createdMeetingId;
      if (meetingId == null) {
        const payload: Record<string, unknown> = { title: form.title.trim(), meeting_type: form.meeting_type, scheduled_date: new Date(form.scheduled_date).toISOString() };
        if (form.location.trim()) payload.location = form.location.trim();
        if (form.virtual_link.trim()) payload.virtual_link = form.virtual_link.trim();
        if (form.quorum_required) payload.quorum_required = parseInt(form.quorum_required, 10);
        const res = await committeeApi.createMeeting(committeeId, payload);
        meetingId = (res.data as { id?: number })?.id ?? null;
        setCreatedMeetingId(meetingId);
      }
      // the inline agenda items are best effort: a failed one is collected, not thrown, so one bad row cannot undo the meeting
      const failed: AgendaDraft[] = [];
      if (meetingId != null) {
        for (let i = 0; i < agenda.length; i++) {
          try {
            await committeeApi.addAgendaItem(meetingId, { title: agenda[i].title, item_type: agenda[i].item_type, item_number: i + 1 });
          } catch {
            failed.push(agenda[i]);
          }
        }
      }
      return { failed, title: form.title.trim() };
    },
    success: ({ failed, title }) => (failed.length
      ? { title: `Meeting ${short(title)} scheduled`, message: `${failed.length} agenda ${failed.length === 1 ? 'item' : 'items'} could not be added. They are still in the form: add them again.` }
      : `Meeting ${short(title)} scheduled`),
    failure: "Couldn't schedule the meeting",
    retryable: false,
    onSuccess: ({ failed }) => {
      onSaved();
      if (failed.length) {
        // the meeting is saved, some agenda items are not: the drawer stays open with only those, so they can be added again without a second meeting
        setAgenda(failed);
        setWarn(`Meeting saved. ${failed.length} agenda ${failed.length === 1 ? 'item' : 'items'} couldn't be added: you can add them again.`);
      } else {
        onClose();
        reset();
      }
    },
    onError: () => setCreatedMeetingId(null),                              // the meeting itself failed (nothing was saved): safe to try as it is
  });
  const close = () => { create.reset(); onClose(); };
  const set = (patch: Partial<typeof NEW_MEETING>) => setForm((f) => ({ ...f, ...patch }));
  const canSubmit = Boolean(form.committee_id && form.title.trim() && form.scheduled_date);

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title="New meeting"
      dirty={formChanged(blank, form) || agenda.length > 0 || Boolean(agendaDraft.title.trim())}
      footer={<DrawerFooter onCancel={close} form="create-meeting-form" pending={create.isPending} label="Schedule meeting" pendingLabel="Scheduling…" disabled={!canSubmit} />}
    >
      <form id="create-meeting-form" onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }} className="flex flex-col gap-[16px]">
        {create.isError && <FormProblem message={errorMessage(create.error, 'The meeting could not be scheduled.')} />}
        {warn && <p role="status" className="rounded-ds-control border border-ds-border bg-ds-warning-soft px-[12px] py-[8px] text-ds-body text-ds-fg">{warn}</p>}
        <FormField label="Committee" required>
          <Select value={form.committee_id} onChange={(e) => set({ committee_id: e.target.value })} placeholder="Select committee" required>
            {committeeItems.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Meeting title" required>
          <TextInput value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Q1 Risk Review" maxLength={500} required />
        </FormField>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <FormField label="Date & time" required>
            <TextInput type="datetime-local" value={form.scheduled_date} onChange={(e) => set({ scheduled_date: e.target.value })} required />
          </FormField>
          <FormField label="Type">
            <Select value={form.meeting_type} onChange={(e) => set({ meeting_type: e.target.value })}>
              {MEETING_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <FormField label="Location" optional>
            <TextInput value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Boardroom / online" maxLength={500} />
          </FormField>
          <FormField label="Quorum required" optional>
            <TextInput type="number" min={0} value={form.quorum_required} onChange={(e) => set({ quorum_required: e.target.value })} placeholder="e.g. 5" />
          </FormField>
        </div>
        <FormField label="Virtual link" optional>
          <TextInput value={form.virtual_link} onChange={(e) => set({ virtual_link: e.target.value })} placeholder="https://…" maxLength={1000} />
        </FormField>

        <fieldset className="min-w-0">
          <legend className="text-ds-label text-ds-fg">Agenda items <span className="font-normal text-ds-fg-muted">(optional)</span></legend>
          {agenda.length > 0 && (
            <ul className="mt-[8px] space-y-[6px]">
              {agenda.map((a, idx) => (
                <li key={idx} className="flex items-center justify-between gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[10px] py-[6px]">
                  <span className="min-w-0 break-words text-ds-body text-ds-fg-body">
                    <span className="mr-[6px] text-ds-label text-ds-fg-muted">{idx + 1}.</span>{a.title}
                    <span className="ml-[8px] text-ds-label font-normal text-ds-fg-muted">{AGENDA_TYPE_ITEMS.find((t) => t.value === a.item_type)?.label}</span>
                  </span>
                  <IconButton label={`Remove agenda item ${idx + 1}`} onClick={() => setAgenda(agenda.filter((_, i) => i !== idx))}><Trash2 aria-hidden /></IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
            <TextInput
              value={agendaDraft.title}
              onChange={(e) => setAgendaDraft({ ...agendaDraft, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && agendaDraft.title.trim()) { e.preventDefault(); addAgendaItem(); } }}
              placeholder="Add an agenda item, then Enter"
              aria-label="Agenda item title"
              maxLength={500}
              className="min-w-[160px] flex-1"
            />
            <Select aria-label="Agenda item type" value={agendaDraft.item_type} onChange={(e) => setAgendaDraft({ ...agendaDraft, item_type: e.target.value })} className="w-[140px]">
              {AGENDA_TYPE_ITEMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <IconButton label="Add agenda item" variant="secondary" onClick={addAgendaItem} disabled={!agendaDraft.title.trim()}><Plus aria-hidden /></IconButton>
          </div>
        </fieldset>
      </form>
    </RightSlidePanel>
  );
}
