'use client';

// Governance > Committees > Oversight Actions: every committee's actions in one register, paged. Views with their TRUE totals (All, Overdue, Due this week, Later: the three groups
// of the Committees home's Needs action lane, so the numbers are the same), the four totals of the overview, filters (the status, the committee and "Assigned to me" go to the API,
// so they work on every action; the search reads the page that is shown), the list as a table (a card each below 768px), the priority changed in place by anyone who can edit.
// Everything is kept in the address (?committee=3&mine=1&view=overdue&status=open&q=&page=2&size=50), and the old ?overdue=1 (the Governance Overview's counter links there) opens the
// Overdue view. On the design-system kit: PageHeader variant="page", FilterChips, StatTile, RegisterTable + Pager, StatusPill, PersonChip, Menu for the status change,
// EmptyState / ErrorState, useReportedMutation for every write.
// Four things this page used to get wrong, fixed (G4-E): a failed request is an error with Retry (it used to be answered with made-up committees and seven made-up actions); "Overdue"
// is what the API means by it (is_overdue); the four totals are the server's, not the length of a list cut at 100; all 18 action types read as themselves.
// "Add manual action" is open to every signed-in user, as it always was (the server asks for no more): recorded in G3_permission_matrix, not changed here. A deactivated committee's
// actions are still here: the committee filter lists it too, marked "(inactive)", while the form that adds an action offers the active committees only.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, CheckSquare, Clock, Plus, Search } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import { useModuleSettings } from '@/components/settings/CustomFields';
import { PRIORITIES } from '@/components/settings/PrioritySla';
import {
  Button, Checkbox, EmptyState, ErrorState, FilterChips, Menu, Pager, PersonChip, RegisterTable, Select, Skeleton, TextInput, useAddressState,
  type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { NOT_SET, formatCount, statusLabel, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { actionStatus } from '@/lib/status';
import {
  ACTION_PAGE_SIZES, actionTypeLabel, committeeChoiceLabel, dueDay, dueRelative, isOverdueAction, listOf, type Overview, type SlaLike,
} from '@/lib/committees';
import { ACTIONS_SCHEMA, ACTION_VIEWS, GROUP_LABEL, VIEW_LABEL, committeeHomeAddress, groupQuery, laterTotal, viewOf, viewQuery, type ActionQuery, type ActionView } from '@/lib/committeeHome';
import { useDebounced } from '@/components/committees/hooks';
import { ManualActionPanel } from '@/components/committees/ManualActionPanel';
import { ActionStatusPills, PriorityTag, SlaTag, StatTile } from '@/components/committees/ui';

interface Action {
  id: number;
  committee_id: number;
  committee_name: string;
  meeting_id?: number;
  meeting_title?: string;
  title: string;
  description?: string;
  action_type: string;
  status: string;
  is_overdue?: boolean;
  priority?: string;
  sla?: SlaLike | null;
  due_date: string | null;
  assigned_to_name?: string;
}
interface Committee { id: number; name: string; is_active?: boolean }

const STATUS_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

export default function ActionsPage() {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('governance:committees:create');          // the priority in place (the committee page offered it to the same people)
  const [address, setAddress] = useAddressState(ACTIONS_SCHEMA);
  const view = viewOf(address);
  const committeeId = address.committee > 0 ? address.committee : null;
  const filters = useMemo(() => ({ committeeId, mine: address.mine, status: address.status }), [committeeId, address.mine, address.status]);
  const [draft, setDraft] = useState(address.q);
  const settled = useDebounced(draft, 300);
  useEffect(() => { if (settled.trim() !== address.q.trim()) setAddress({ q: settled }); }, [settled]);          // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(address.q); }, [address.q]);
  const [adding, setAdding] = useState(false);
  // Task Management's SLA table: the days each priority allows (a person without access just gets no hints)
  const { data: taskSettings } = useModuleSettings('tasks');

  const committeesQ = useQuery({
    queryKey: ['committees-list'],
    queryFn: async () => listOf<Committee>((await committeeApi.getCommittees({ is_active: 'all' })).data).items,
  });
  const committees = committeesQ.data ?? [];

  // the true totals of the views, for the committee and the person asked about: one request each, limit 1 (the server's `total` is the count)
  const countsQ = useQuery({
    queryKey: ['action-counts', committeeId ?? 0, address.mine],
    queryFn: async () => {
      const scope = { committeeId, mine: address.mine };
      const now = new Date();
      const total = async (q: Partial<ActionQuery>) => listOf((await committeeApi.getActions({ ...q, limit: 1 })).data).total;
      const [all, open, overdue, week] = await Promise.all([
        total({ ...(committeeId ? { committee_id: committeeId } : {}), ...(address.mine ? { assigned_to: 'me' as const } : {}) }),
        total({ ...groupQuery('later', scope, now, { limit: 1 }) }),
        total({ ...groupQuery('overdue', scope, now, { limit: 1 }) }),
        total({ ...groupQuery('week', scope, now, { limit: 1 }) }),
      ]);
      return { all, overdue, week, later: laterTotal(open, overdue, week) };
    },
  });
  const counts = countsQ.data;

  // the page of actions the filters ask for; `total` is the API's, never the length of what came back
  const before = (counts?.overdue ?? 0) + (counts?.week ?? 0);
  const actionsQ = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['all-actions', view, address.status, committeeId ?? 0, address.mine, address.page, address.size, view === 'later' ? before : 0],
    enabled: view !== 'later' || !!counts,
    queryFn: async () => {
      const params = viewQuery(view, filters, new Date(), { page: address.page, size: address.size, before });
      const { items, total } = listOf<Record<string, unknown>>((await committeeApi.getActions(params)).data);
      return { total, items: items.map((item) => ({ ...item, assigned_to_name: (item.assigned_to_name as string) || (item.assignee_name as string) || '' })) as unknown as Action[] };
    },
  });
  const actions = actionsQ.data?.items ?? [];
  const total = actionsQ.data?.total ?? 0;

  // the four totals: the overview endpoint's own counts (all committees, or the one chosen), the same numbers and the same meaning of "overdue" as the Overview
  const overviewQ = useQuery({ queryKey: ['committee-overview'], queryFn: async () => (await committeeApi.getOverview()).data as Overview });
  const totals = useMemo(() => {
    const overview = overviewQ.data;
    if (!overview) return null;
    if (!committeeId) return overview.kpis.actions;
    const c = overview.committees.find((row) => row.id === committeeId);
    return c ? { open: c.open_actions, in_progress: c.in_progress_actions, overdue: c.overdue_actions, completed: c.completed_actions, total: c.total_actions } : null;
  }, [overviewQ.data, committeeId]);

  const refresh = [['all-actions'], ['action-counts'], ['committee-overview'], ['committee-lane-actions']];       // the list, the view totals, the totals above, the lane
  const updateStatus = useReportedMutation({
    mutationFn: ({ id, status }: { id: number; status: string; title: string }) => committeeApi.updateAction(id, { status }),
    success: (_r, v) => ({ title: `Marked ${actionStatus.label(v.status).toLowerCase()}`, message: truncate(v.title, 80).text }),
    failure: "Couldn't change the status",
    invalidate: refresh,
  });
  // re-prioritising an action re-dates it (unless the date was chosen) and updates its twin in Task Management: the server does both
  const updatePriority = useReportedMutation({
    mutationFn: ({ id, priority }: { id: number; priority: string; title: string }) => committeeApi.updateAction(id, { priority }),
    success: (_r, v) => ({ title: 'Priority changed', message: `${truncate(v.title, 60).text}: ${statusLabel(v.priority)}` }),
    failure: "Couldn't change the priority",
    invalidate: refresh,
  });

  // the search reads what is on the page (the API has no text search); the filters above it are the API's
  const query = address.q.trim().toLowerCase();
  const shown = useMemo(
    () => (query
      ? actions.filter((a) => a.title.toLowerCase().includes(query) || (a.description || '').toLowerCase().includes(query) || (a.assigned_to_name || '').toLowerCase().includes(query))
      : actions),
    [actions, query],
  );
  const filtering = Boolean(address.status || committeeId || address.mine || view !== 'all' || query);
  const clearFilters = () => { setDraft(''); setAddress({ status: '', committee: 0, mine: false, view: 'all', overdue: false, q: '', page: 1 }); };
  const setView = (next: ActionView) => setAddress({ view: next, overdue: false, page: 1 });

  const title = routeFor('/governance/committees/actions')?.label ?? 'Oversight Actions';
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add manual action</Button>;

  const rowMenu = (a: Action) => {
    const items: MenuItem[] = STATUS_FILTERS.map((s) => ({
      key: s.value,
      label: `Mark as ${s.label.toLowerCase()}`,
      icon: s.value === 'completed' ? CheckCircle : s.value === 'in_progress' ? Clock : CheckSquare,
      onSelect: () => updateStatus.mutate({ id: a.id, status: s.value, title: a.title }),
      disabled: a.status === s.value || updateStatus.isPending,
    }));
    return <Menu label={`Change the status of ${truncate(a.title, 50).text}`} iconOnly items={items} />;
  };

  const priorityCell = (a: Action) => (
    <span className="flex flex-col items-start gap-[4px]">
      {canEdit && a.status !== 'completed' ? (
        <Select
          value={a.priority || 'medium'}
          onChange={(e) => updatePriority.mutate({ id: a.id, priority: e.target.value, title: a.title })}
          disabled={updatePriority.isPending}
          aria-label={`Priority of ${truncate(a.title, 60).text}`}
          className="w-[132px]"
        >
          {[...PRIORITIES, ...(PRIORITIES.some((p) => p.value === a.priority) || !a.priority ? [] : [{ value: a.priority, label: statusLabel(a.priority) }])].map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      ) : <PriorityTag size="sm" value={a.priority} />}
      <SlaTag size="sm" sla={a.sla} />
    </span>
  );

  const columns: RegisterColumn<Action>[] = [
    {
      key: 'action', header: 'Action', isRowHeader: true,
      cell: (a) => (
        <>
          <span className="line-clamp-2 break-words font-[600] text-ds-fg" title={a.title}>{a.title}</span>
          <span className="block text-ds-label font-normal text-ds-fg-muted">{a.committee_name || 'No committee'} · {actionTypeLabel(a.action_type)}</span>
          {a.meeting_title && <span className="line-clamp-1 break-words text-ds-label font-normal text-ds-fg-muted" title={a.meeting_title}>From: {a.meeting_title}</span>}
          {a.description && <span className="mt-[2px] line-clamp-2 break-words text-ds-label font-normal text-ds-fg-body" title={a.description}>{a.description}</span>}
        </>
      ),
    },
    {
      key: 'due', header: 'Due', width: 'w-[132px]', card: 'meta',
      cell: (a) => (a.due_date
        ? (<><span className={isOverdueAction(a) ? 'whitespace-nowrap text-ds-danger' : 'whitespace-nowrap'}>{dueDay(a.due_date)}</span><span className="block text-ds-label text-ds-fg-muted">{dueRelative(a.due_date)}</span></>)
        : <span className="text-ds-fg-muted">{NOT_SET}</span>),
    },
    { key: 'assigned', header: 'Assigned to', priority: 3, width: 'w-[168px]', card: 'meta', cell: (a) => <PersonChip name={a.assigned_to_name} /> },
    { key: 'priority', header: 'Priority', priority: 3, width: 'w-[156px]', card: 'meta', cell: priorityCell },
    { key: 'status', header: 'Status', width: 'w-[148px]', card: 'meta', cell: (a) => <ActionStatusPills size="sm" action={a} /> },
    { key: 'menu', header: 'Actions', align: 'right', width: 'w-[56px]', cell: rowMenu },
  ];

  const noun = 'actions';
  const chips = ACTION_VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v], count: counts ? counts[v === 'all' ? 'all' : v] : undefined, active: view === v }));

  return (
    <div className="space-y-[16px]">
      <PageHeader
        variant="page"
        title={title}
        back={{ href: committeeHomeAddress(committeeId), label: committeeId ? 'Back to the committee' : 'Back to committees' }}
        info="Track and manage the actions of every committee."
        meta={actionsQ.data ? `${formatCount(total)} ${total === 1 ? 'action' : noun}` : undefined}
        actions={add}
      />

      {/* ── the four totals (the server's counts, for every committee or the one chosen) ── */}
      {overviewQ.isError && !totals ? (
        <ErrorState compact className="rounded-ds-card border border-ds-border bg-ds-surface" title="Couldn't load the totals" message={errorMessage(overviewQ.error)} onRetry={() => { void overviewQ.refetch(); }} />
      ) : (
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
          {totals === null && overviewQ.isLoading ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[88px]" />)
          ) : (
            <>
              <StatTile label="Open" icon={Clock} value={totals ? formatCount(totals.open) : '—'} />
              <StatTile label="In progress" icon={Clock} value={totals ? formatCount(totals.in_progress) : '—'} />
              <StatTile label="Overdue" icon={AlertTriangle} value={totals ? formatCount(totals.overdue) : '—'} tone={totals && totals.overdue > 0 ? 'danger' : 'default'} note="Open or in progress, past its due date" />
              <StatTile label="Completed" icon={CheckCircle} value={totals ? formatCount(totals.completed) : '—'} tone="success" />
            </>
          )}
        </div>
      )}

      {/* ── views and filters ── */}
      <div className="space-y-[10px]">
        <FilterChips label="Views" chips={chips} onToggle={(key) => setView(key as ActionView)} />
        {countsQ.isError && (
          <p role="alert" className="inline-flex items-center gap-[8px] text-ds-body text-ds-danger">
            Couldn&apos;t load the totals of the views <Button size="sm" onClick={() => { void countsQ.refetch(); }}>Retry</Button>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
          <TextInput
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search this page"
            aria-label="Search the actions on this page"
            leftAdornment={<Search aria-hidden />}
            className="min-w-[200px] max-w-md flex-1"
          />
          <Select
            aria-label="Status"
            value={view === 'all' ? address.status : ''}
            placeholder={view === 'all' ? 'All statuses' : `Open actions: ${GROUP_LABEL[view === 'later' ? 'later' : view === 'week' ? 'week' : 'overdue'].toLowerCase()}`}
            disabled={view !== 'all'}
            onChange={(e) => setAddress({ status: e.target.value as typeof address.status, page: 1 })}
            className="w-[200px]"
          >
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Select aria-label="Committee" value={committeeId ? String(committeeId) : ''} placeholder="All committees" onChange={(e) => setAddress({ committee: e.target.value ? parseInt(e.target.value, 10) : 0, page: 1 })} className="w-[220px]" disabled={committeesQ.isError}>
            {committees.map((c) => <option key={c.id} value={String(c.id)}>{committeeChoiceLabel(c)}</option>)}
          </Select>
          <Checkbox label="Assigned to me" checked={address.mine} onChange={(e) => setAddress({ mine: e.target.checked, page: 1 })} />
          {committeesQ.isError && (
            <span role="alert" className="inline-flex items-center gap-[8px] text-ds-body text-ds-danger">
              Couldn&apos;t load the committees <Button size="sm" onClick={() => { void committeesQ.refetch(); }}>Retry</Button>
            </span>
          )}
        </div>
      </div>
      {query && total > actions.length && (
        <p className="text-ds-label font-normal text-ds-fg-muted">The search reads the {formatCount(actions.length)} actions on this page, not all {formatCount(total)}.</p>
      )}

      <RegisterTable<Action>
        caption="Oversight actions"
        columns={columns}
        rows={shown}
        getRowId={(a) => a.id}
        loading={actionsQ.isLoading || (view === 'later' && !counts && !countsQ.isError)}
        error={actionsQ.isError && !actionsQ.data ? { message: `Couldn't load the actions. ${errorMessage(actionsQ.error)}`, onRetry: () => { void actionsQ.refetch(); } } : null}
        cardTitle={(a) => (
          <>
            <span className="block break-words font-[600] text-ds-fg">{a.title}</span>
            <span className="block text-ds-label font-normal text-ds-fg-muted">{a.committee_name || 'No committee'} · {actionTypeLabel(a.action_type)}</span>
            <span className="mt-[4px] flex items-start justify-between gap-[8px]">
              {a.meeting_title ? <span className="line-clamp-1 break-words text-ds-label font-normal text-ds-fg-muted">From: {a.meeting_title}</span> : <span />}
              {rowMenu(a)}
            </span>
          </>
        )}
        empty={filtering ? (
          <EmptyState kind="noMatches" bare title="No actions match" description={query ? 'No action fits these filters on this page.' : address.mine ? 'Nothing is assigned to you with these filters.' : 'No action fits these filters.'} onClearFilters={clearFilters} />
        ) : (
          <EmptyState kind="firstUse" bare icon={CheckSquare} title="No oversight actions yet" description="Actions made in a meeting, or added by hand, are listed here." action={add} />
        )}
        footer={actionsQ.data ? <Pager page={address.page} pageSize={address.size} total={total} onPage={(page) => setAddress({ page })} onPageSize={(size) => setAddress({ size, page: 1 })} pageSizes={ACTION_PAGE_SIZES} noun={noun} /> : undefined}
      />

      <ManualActionPanel
        open={adding}
        onClose={() => setAdding(false)}
        committees={committees}
        presetCommitteeId={committeeId}
        taskSettings={taskSettings}
        onSaved={() => undefined}
      />
    </div>
  );
}

