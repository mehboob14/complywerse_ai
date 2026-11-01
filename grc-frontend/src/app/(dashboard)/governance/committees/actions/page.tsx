'use client';

// Governance > Committees > Oversight Actions: every committee's actions in one register. Four totals, filters (the status, the committee and "Overdue only" go to
// the API, so they work on every action; the search reads the page that is shown), the list as a table (a card each below 768px), a page at a time.
// On the design-system kit: PageHeader variant="page", StatTile, RegisterTable + Pager, StatusPill, PersonChip, Menu for the status change, EmptyState / ErrorState,
// useReportedMutation for every write. Four things this page used to get wrong, fixed here:
//  - a failed request is an error with Retry. It used to be answered with made-up committees and seven made-up actions, so an outage looked like data;
//  - "Overdue" is what the API means by it (is_overdue: open or in progress and past its due date); the page tested status === 'overdue', which nothing writes, so the
//    tile and the red border said 0 beside rows the SLA badge called "Overdue 6d";
//  - the four totals are the server's (the overview endpoint: every committee, or the one chosen), not the length of a list cut at 100;
//  - all 18 action types read as themselves (4 had a label, the rest said "Follow Up").
// "Add manual action" is open to every signed-in user, as it always was (the server asks for no more): recorded in G3_permission_matrix, not changed here.
// A deactivated committee's actions are still here: the committee filter lists it too, marked "(inactive)", while the form that adds an action offers the
// active committees only (the server refuses an inactive one).
// Opening the page with ?overdue=1 (the Governance Overview's counter links there) starts on the overdue ones.
import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckSquare, Clock, Plus, Search, Sparkles, Upload, CheckCircle, Pencil } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { useModuleSettings } from '@/components/settings/CustomFields';
import { priorityChoices, slaDays } from '@/components/settings/PrioritySla';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, Menu, Pager, PersonChip, RegisterTable, Select, Skeleton, Textarea, TextInput,
  type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { NOT_SET, formatCount, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { actionStatus } from '@/lib/status';
import {
  ACTION_PAGE_SIZE, ACTION_PAGE_SIZES, ACTION_TYPES, actionListParams, actionTypeLabel, activeCommittees, committeeChoiceLabel, dueDay, dueRelative, formChanged,
  isOverdueAction, listOf, overdueFromSearch, type Overview, type SlaLike,
} from '@/lib/committees';
import { ActionStatusPills, DrawerFooter, FileInput, FormProblem, PriorityTag, SlaTag, StatTile } from '../_ui';

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
interface CommitteeMeeting { id: number; title: string }

const STATUS_FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];
const NEW_ACTION = { committee_id: '', meeting_id: '', title: '', description: '', action_type: 'follow_up', priority: 'medium', due_date: '' };

export default function ActionsPage() {
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [committeeFilter, setCommitteeFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(() => overdueFromSearch(searchParams?.toString() ?? ''));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ACTION_PAGE_SIZE);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createFormData, setCreateFormData] = useState(NEW_ACTION);
  const [aiFile, setAiFile] = useState<File | null>(null);
  // Task Management's SLA table: the days each priority allows (a person without access just gets no hints)
  const { data: taskSettings } = useModuleSettings('tasks');

  const committeesQ = useQuery({
    queryKey: ['committees-list'],
    queryFn: async () => listOf<Committee>((await committeeApi.getCommittees({ is_active: 'all' })).data).items,
  });
  const committees = committeesQ.data ?? [];

  // the page of actions the filters ask for; `total` is the API's, never the length of what came back
  const actionsQ = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['all-actions', statusFilter, committeeFilter, overdueOnly, page, pageSize],
    queryFn: async () => {
      const response = await committeeApi.getActions(actionListParams({ status: statusFilter, committee: committeeFilter, overdueOnly }, page, pageSize));
      const { items, total } = listOf<Record<string, any>>(response.data);
      return { total, items: items.map((item) => ({ ...item, assigned_to_name: item.assigned_to_name || item.assignee_name || '' })) as Action[] };
    },
  });
  const actions = actionsQ.data?.items ?? [];
  const total = actionsQ.data?.total ?? 0;

  // the four totals: the overview endpoint's own counts (all committees, or the one chosen), the same numbers and the same meaning of "overdue" as the Overview
  const overviewQ = useQuery({
    queryKey: ['committee-overview'],
    queryFn: async () => (await committeeApi.getOverview()).data as Overview,
  });
  const totals = useMemo(() => {
    const overview = overviewQ.data;
    if (!overview) return null;
    if (!committeeFilter) return overview.kpis.actions;
    const c = overview.committees.find((row) => String(row.id) === committeeFilter);
    return c ? { open: c.open_actions, in_progress: c.in_progress_actions, overdue: c.overdue_actions, completed: c.completed_actions, total: c.total_actions } : null;
  }, [overviewQ.data, committeeFilter]);

  const { data: meetings = [], isLoading: isMeetingsLoading } = useQuery({
    queryKey: ['committee-meetings-for-actions', createFormData.committee_id],
    enabled: !!createFormData.committee_id,
    queryFn: async () => listOf<{ id: number; title: string }>((await committeeApi.getMeetings(parseInt(createFormData.committee_id, 10))).data).items
      .map((m) => ({ id: m.id, title: m.title })) as CommitteeMeeting[],
  });

  const refresh = [['all-actions'], ['committee-overview']];       // the list, and the totals above it
  const updateAction = useReportedMutation({
    mutationFn: ({ id, status }: { id: number; status: string; title: string }) => committeeApi.updateAction(id, { status }),
    success: (_r, v) => ({ title: `Marked ${actionStatus.label(v.status).toLowerCase()}`, message: truncate(v.title, 80).text }),
    failure: "Couldn't change the status",
    invalidate: refresh,
  });

  const createAction = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => committeeApi.createManualAction(data),
    success: (_r, data) => ({ title: 'Action created', message: truncate(String(data.title), 80).text }),
    failure: "Couldn't create the action",
    retryable: false,                                              // a create is not safe to repeat blindly: the drawer stays open to try again
    invalidate: refresh,
    onSuccess: () => { setIsCreateModalOpen(false); setCreateFormData(NEW_ACTION); setAiFile(null); },
  });

  const aiReword = useReportedMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (createFormData.description.trim()) formData.append('text', createFormData.description.trim());
      if (aiFile) formData.append('file', aiFile);
      formData.append('tone', 'professional');
      return (await committeeApi.aiRewordActionText(formData)).data as { text: string };
    },
    success: 'Description reworded',
    failure: "Couldn't reword the description",
    onSuccess: (result) => setCreateFormData((prev) => ({ ...prev, description: result.text || prev.description })),
  });

  const aiSummary = useReportedMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (createFormData.description.trim()) formData.append('text', createFormData.description.trim());
      if (aiFile) formData.append('file', aiFile);
      return (await committeeApi.aiSummarizeActionText(formData)).data as { text: string };
    },
    success: 'Summary added to the description',
    failure: "Couldn't summarise the description",
    onSuccess: (result) => setCreateFormData((prev) => ({ ...prev, description: result.text || prev.description })),
  });

  const handleCreateManualAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createFormData.committee_id || !createFormData.title.trim()) return;
    const payload: Record<string, unknown> = {
      committee_id: parseInt(createFormData.committee_id, 10),
      title: createFormData.title.trim(),
      action_type: createFormData.action_type,
      priority: createFormData.priority,
    };
    if (createFormData.meeting_id) payload.meeting_id = parseInt(createFormData.meeting_id, 10);
    if (createFormData.description.trim()) payload.description = createFormData.description.trim();
    if (createFormData.due_date) payload.due_date = createFormData.due_date;
    createAction.mutate(payload);
  };
  const closeCreate = () => { createAction.reset(); setIsCreateModalOpen(false); };

  // the search reads what is on the page (the API has no text search); the filters above it are the API's
  const query = searchTerm.trim().toLowerCase();
  const shown = useMemo(
    () => (query
      ? actions.filter((a) => a.title.toLowerCase().includes(query) || (a.description || '').toLowerCase().includes(query) || (a.assigned_to_name || '').toLowerCase().includes(query))
      : actions),
    [actions, query],
  );
  const filtering = Boolean(statusFilter || committeeFilter || overdueOnly || query);
  const clearFilters = () => { setStatusFilter(''); setCommitteeFilter(''); setOverdueOnly(false); setSearchTerm(''); setPage(1); };

  const title = routeFor('/governance/committees/actions')?.label ?? 'Oversight Actions';
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setIsCreateModalOpen(true)}>Add manual action</Button>;

  const rowMenu = (a: Action) => {
    const items: MenuItem[] = STATUS_FILTERS.map((s) => ({
      key: s.value,
      label: `Mark as ${s.label.toLowerCase()}`,
      icon: s.value === 'completed' ? CheckCircle : s.value === 'in_progress' ? Clock : Pencil,
      onSelect: () => updateAction.mutate({ id: a.id, status: s.value, title: a.title }),
      disabled: a.status === s.value || updateAction.isPending,
    }));
    return <Menu label={`Change the status of ${truncate(a.title, 50).text}`} iconOnly items={items} />;
  };

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
    {
      key: 'priority', header: 'Priority', priority: 3, width: 'w-[140px]', card: 'meta',
      cell: (a) => (<span className="flex flex-col items-start gap-[4px]"><PriorityTag size="sm" value={a.priority} /><SlaTag size="sm" sla={a.sla} /></span>),
    },
    { key: 'status', header: 'Status', width: 'w-[148px]', card: 'meta', cell: (a) => <ActionStatusPills size="sm" action={a} /> },
    { key: 'menu', header: 'Actions', align: 'right', width: 'w-[56px]', cell: rowMenu },
  ];

  const noun = 'actions';
  return (
    <div className="space-y-[16px]">
      <PageHeader
        variant="page"
        title={title}
        back={{ href: '/governance/committees', label: 'Back to committees' }}
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
              <StatTile label="Overdue" icon={AlertTriangle} value={totals ? formatCount(totals.overdue) : '—'} tone={totals && totals.overdue > 0 ? 'danger' : 'default'}
                note="Open or in progress, past its due date" />
              <StatTile label="Completed" icon={CheckCircle} value={totals ? formatCount(totals.completed) : '—'} tone="success" />
            </>
          )}
        </div>
      )}

      {/* ── filters ── */}
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        <TextInput
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search this page"
          aria-label="Search the actions on this page"
          leftAdornment={<Search aria-hidden />}
          className="min-w-[200px] max-w-md flex-1"
        />
        <Select aria-label="Status" value={statusFilter} placeholder="All statuses" onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-[160px]">
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <Select aria-label="Committee" value={committeeFilter} placeholder="All committees" onChange={(e) => { setCommitteeFilter(e.target.value); setPage(1); }} className="w-[220px]"
          disabled={committeesQ.isError}>
          {committees.map((c) => <option key={c.id} value={String(c.id)}>{committeeChoiceLabel(c)}</option>)}
        </Select>
        <Checkbox label="Overdue only" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setPage(1); }} />
        {committeesQ.isError && (
          <span role="alert" className="inline-flex items-center gap-[8px] text-ds-body text-ds-danger">
            Couldn&apos;t load the committees <Button size="sm" onClick={() => { void committeesQ.refetch(); }}>Retry</Button>
          </span>
        )}
      </div>
      {query && total > actions.length && (
        <p className="text-ds-label font-normal text-ds-fg-muted">The search reads the {formatCount(actions.length)} actions on this page, not all {formatCount(total)}.</p>
      )}

      <RegisterTable<Action>
        caption="Oversight actions"
        columns={columns}
        rows={shown}
        getRowId={(a) => a.id}
        loading={actionsQ.isLoading}
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
          <EmptyState kind="noMatches" bare title="No actions match" description="No action fits these filters on this page." onClearFilters={clearFilters} />
        ) : (
          <EmptyState kind="firstUse" bare icon={CheckSquare} title="No oversight actions yet" description="Actions made in a meeting, or added by hand, are listed here." action={add} />
        )}
        footer={actionsQ.data ? <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} pageSizes={ACTION_PAGE_SIZES} noun={noun} /> : undefined}
      />

      <RightSlidePanel
        isOpen={isCreateModalOpen}
        onClose={closeCreate}
        title="Add manual action"
        dirty={formChanged(NEW_ACTION, createFormData) || aiFile !== null}
        footer={<DrawerFooter onCancel={closeCreate} form="create-action-form" pending={createAction.isPending} label="Create action" pendingLabel="Creating…" disabled={!createFormData.committee_id || !createFormData.title.trim()} />}
      >
        <form id="create-action-form" onSubmit={handleCreateManualAction} className="flex flex-col gap-[16px]">
          {createAction.isError && <FormProblem message={errorMessage(createAction.error, 'The action could not be created.')} />}
          {committeesQ.isError && <FormProblem message="The committees could not be loaded, so none can be chosen. Close this and try again." />}
          <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
            <FormField label="Committee" required>
              <Select
                value={createFormData.committee_id}
                placeholder="Select committee"
                required
                onChange={(e) => setCreateFormData((prev) => ({ ...prev, committee_id: e.target.value, meeting_id: '' }))}
              >
                {activeCommittees(committees).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Meeting" optional>
              <Select
                value={createFormData.meeting_id}
                disabled={!createFormData.committee_id}
                placeholder={!createFormData.committee_id ? 'Select a committee first' : isMeetingsLoading ? 'Loading meetings…' : 'No linked meeting'}
                onChange={(e) => setCreateFormData((prev) => ({ ...prev, meeting_id: e.target.value }))}
              >
                {meetings.map((m) => <option key={m.id} value={String(m.id)}>{m.title}</option>)}
              </Select>
            </FormField>
          </div>

          <FormField label="Title" required>
            <TextInput value={createFormData.title} onChange={(e) => setCreateFormData((prev) => ({ ...prev, title: e.target.value }))} placeholder="Action item title" maxLength={500} required />
          </FormField>

          <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2">
            <FormField label="Action type">
              <Select value={createFormData.action_type} onChange={(e) => setCreateFormData((prev) => ({ ...prev, action_type: e.target.value }))}>
                {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Priority">
              <Select value={createFormData.priority} onChange={(e) => setCreateFormData((prev) => ({ ...prev, priority: e.target.value }))}>
                {priorityChoices(taskSettings).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </FormField>
          </div>

          <FormField
            label="Due date"
            optional
            hint={!createFormData.due_date && slaDays(taskSettings, createFormData.priority) != null
              ? `Left blank, it is due ${slaDays(taskSettings, createFormData.priority)} days from today (the ${createFormData.priority} SLA).`
              : undefined}
          >
            <TextInput type="date" value={createFormData.due_date} onChange={(e) => setCreateFormData((prev) => ({ ...prev, due_date: e.target.value }))} className="md:max-w-[50%]" />
          </FormField>

          <FormField label="Description" optional>
            <Textarea value={createFormData.description} onChange={(e) => setCreateFormData((prev) => ({ ...prev, description: e.target.value }))} rows={5} placeholder="Describe the action item" />
          </FormField>

          <fieldset className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
            <legend className="px-[4px] text-ds-label text-ds-fg">AI assistant</legend>
            <div className="flex flex-col gap-[12px]">
              <FormField label="Reference file" optional>
                <FileInput accept=".txt,.md,.csv,.json,.pdf,.doc,.docx" onPick={setAiFile} />
              </FormField>
              <div className="flex flex-wrap gap-[8px]">
                <Button leftIcon={<Sparkles aria-hidden />} loading={aiReword.isPending} disabled={aiSummary.isPending || (!createFormData.description.trim() && !aiFile)} onClick={() => aiReword.mutate()}>AI reword</Button>
                <Button leftIcon={<Upload aria-hidden />} loading={aiSummary.isPending} disabled={aiReword.isPending || (!createFormData.description.trim() && !aiFile)} onClick={() => aiSummary.mutate()}>Generate summary</Button>
              </div>
            </div>
          </fieldset>
        </form>
      </RightSlidePanel>
    </div>
  );
}
