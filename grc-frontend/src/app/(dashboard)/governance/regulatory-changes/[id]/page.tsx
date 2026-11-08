'use client';

// One regulatory change: its head (the title, the status and priority with their menus, Close), the AI's progress while it reads the circular, and four tabs: Overview (the journey, what needs
// attention, the facts, closure), Obligations, Impact and Tasks. The tab, the filters and the obligation open are in the address, so a link from the Overview, from the register or from a control's
// page (?tab=obligations&control=review) opens the right place already filtered. Completed is reached through Close, which checks the tasks first; a change with no tasks is told to add one.
import { useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Menu, Skeleton, StatusPill, Tabs, TabPanel, useAddressState, useConfirm, useNotify, useReportedMutation, useTabParam, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { regulatoryApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { changeStatus } from '@/lib/statuses/regulatory';
import { CHANGE_REFRESH, useObligations, useTasks } from '../_lib/data';
import { DETAIL_SCHEMA, DETAIL_TABS, TAB_ALIASES, TAB_LABEL, type DetailAddress, type DetailTab } from '../_lib/detailAddress';
import { MOVES, PRIORITIES, isFinished, isReading, regulatorName } from '../_lib/regulatoryModel';
import type { ChangeRow, Task, TaskDraft } from '../_lib/types';
import AssessmentsTab from './_AssessmentsTab';
import { AnalysisBanner, CloseSheet } from './_head';
import ObligationsTab from './_ObligationsTab';
import OverviewTab from './_OverviewTab';
import { TaskEditor } from './_TaskEditor';
import TasksTab from './_TasksTab';

const BACK = { href: '/governance/regulatory-changes?tab=changes', label: 'Back to changes' };

export default function RegulatoryChangeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission('governance:regulatory_changes:delete');
  const changeId = Number(params.id);
  const [tab, setTab] = useTabParam('tab', DETAIL_TABS, { fallback: 'overview', aliases: TAB_ALIASES });
  const [address, setAddress] = useAddressState(DETAIL_SCHEMA);
  const a = address as DetailAddress;
  const [task, setTask] = useState<{ seq: number; task: Task | TaskDraft } | null>(null);
  const [closing, setClosing] = useState(false);
  const today = new Date();

  const changeQ = useQuery({
    queryKey: ['regulatory-change', changeId],
    queryFn: async () => (await regulatoryApi.getChange(changeId)).data as ChangeRow,
    enabled: Number.isFinite(changeId),
    retry: (failures, e) => failures < 2 && canRetry(e),
    // follow a circular analysis while it runs in the background
    refetchInterval: (query) => (isReading((query.state.data as ChangeRow | undefined) ?? {}) ? 4000 : false),
  });
  const change = changeQ.data;
  const obligations = useObligations(changeId);
  const tasksQ = useTasks(changeId);

  // While a run is going, what it has written so far shows as each part is read.
  const progress = change?.analysis ? `${change.analysis.status}:${change.analysis.done_steps ?? 0}` : '';
  const lastProgress = useRef(progress);
  useEffect(() => {
    const was = lastProgress.current;
    lastProgress.current = progress;
    if (was !== progress && /^(queued|running):/.test(was)) {
      ['regulatory-assessments', 'regulatory-tasks', 'regulatory-obligations', 'regulatory-links'].forEach((k) => { void qc.invalidateQueries({ queryKey: [k, changeId] }); });
    }
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Opens a tab with these filters already on (the Overview's links): one address change, so the strip and the filters cannot overwrite each other. */
  const go = (to: DetailTab, patch: Record<string, string | number | boolean> = {}) => {
    const q = new URLSearchParams();
    if (to !== 'overview') q.set('tab', to);
    Object.entries(patch).forEach(([k, v]) => { if (v === true) q.set(k, '1'); else if (v !== false && v !== '' && v !== 0) q.set(k, String(v)); });
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const update = useReportedMutation({
    mutationFn: ({ data }: { data: Record<string, unknown>; words?: string }) => regulatoryApi.updateChange(changeId, data),
    failure: "Couldn't save the change", invalidate: CHANGE_REFRESH.map((k) => [...k]),
    onSuccess: (_, v) => { if (v.words) notify.success(v.words); },
  });
  const rerun = useReportedMutation({
    mutationFn: () => regulatoryApi.regenerateAssessments(changeId),
    success: { title: 'The AI is reading the circular again', message: 'Results appear as each part is read.' }, failure: "Couldn't start the reading", fallback: 'The reading could not start.',
    invalidate: [['regulatory-change', changeId]],
  });
  const remove = useReportedMutation({
    mutationFn: () => regulatoryApi.deleteChange(changeId),
    success: { title: 'Change deleted', message: 'Its obligations, assessments and tasks went with it.' }, failure: "Couldn't delete the change", invalidate: [['regulatory-changes'], ['regulatory-overview'], ['regulatory-my-work']],
    onSuccess: () => router.push(BACK.href),
  });

  if (changeQ.isPending) {
    return <div aria-busy="true" className="flex flex-col gap-[12px]"><Skeleton className="h-[28px] w-[60%]" /><Skeleton className="h-[16px] w-[40%]" /><Skeleton className="h-[160px] w-full" /></div>;
  }
  if (changeQ.isError || !change) {
    const missing = statusOf(changeQ.error) === 404;
    return (
      <div className="flex flex-col gap-[12px]">
        <Button variant="link" href={BACK.href}>{BACK.label}</Button>
        <ErrorState
          title={missing ? 'This regulatory change is not there' : "Couldn't load this regulatory change"}
          message={missing ? 'It may have been deleted, or it is not in your organisation.' : errorMessage(changeQ.error)}
          onRetry={!missing && canRetry(changeQ.error) ? () => { void changeQ.refetch(); } : undefined}
        />
      </div>
    );
  }

  const finished = isFinished(change.status);
  const running = isReading(change);
  const pickStatus = async (to: string) => {
    if (to === change.status) return;
    if (to === 'not_applicable') {
      const yes = await confirm({ title: 'Mark this change as not applicable?', message: 'It leaves the work lists. You can move it back later.', confirmLabel: 'Mark not applicable' });
      if (!yes) return;
    }
    update.mutate({ data: { status: to }, words: `Moved to ${changeStatus.label(to)}` });
  };
  const statusItems: MenuItem[] = MOVES.map((s, i) => ({ key: s, label: changeStatus.label(s), checked: s === change.status, radio: true, section: i === 0 ? 'Move to' : undefined, onSelect: () => { void pickStatus(s); } }));
  const priorityItems: MenuItem[] = PRIORITIES.map((p, i) => ({ key: p, label: priority.label(p), checked: p === change.priority, radio: true, section: i === 0 ? 'Priority' : undefined, onSelect: () => { if (p !== change.priority) update.mutate({ data: { priority: p }, words: `Priority set to ${priority.label(p)}` }); } }));
  const more: MenuItem[] = [
    { key: 'rerun', label: running ? 'The AI is reading…' : 'Re-run the AI reading', icon: RefreshCw, disabled: running, onSelect: () => rerun.mutate() },
    {
      key: 'delete', label: 'Delete change', icon: Trash2, danger: true, hidden: !canDelete,
      onSelect: async () => {
        const yes = await confirm({ title: 'Delete this regulatory change?', message: `“${change.title}” and its obligations, assessments and tasks (the copies in Task Management too) will be removed. It cannot be undone.`, confirmLabel: 'Delete change', tone: 'danger' });
        if (yes) remove.mutate();
      },
    },
  ];

  const tabs = DETAIL_TABS.map((k) => ({
    key: k, label: TAB_LABEL[k],
    count: k === 'obligations' ? obligations.data?.length : k === 'assessments' ? change.assessment_count : k === 'tasks' ? tasksQ.data?.length : undefined,
  }));
  const openTask = (t: Task | TaskDraft) => setTask({ seq: Date.now(), task: t });

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={change.title}
        back={BACK}
        meta={[regulatorName(change.source), change.reference_number, change.effective_date ? `Takes effect ${formatDate(change.effective_date, { calendar: true })}` : null].filter(Boolean).join(' · ')}
        chips={(
          <>
            <StatusPill {...statusPill(changeStatus, change.status)} />
            <StatusPill size="sm" {...statusPill(priority, change.priority)} />
            {change.assignee_name && <span className="text-ds-label text-ds-fg-muted">{`Owner ${change.assignee_name}`}</span>}
          </>
        )}
        actions={(
          <>
            <Menu label="Status" items={statusItems} />
            <Menu label="Priority" items={priorityItems} />
            {!finished && <Button leftIcon={<Lock aria-hidden />} onClick={() => setClosing(true)}>Close change</Button>}
            <Menu label="More actions" iconOnly items={more} />
          </>
        )}
      />

      {change.analysis && <AnalysisBanner analysis={change.analysis} busy={rerun.isPending || running} onRetry={() => rerun.mutate()} />}

      <Tabs<DetailTab> tabs={tabs} value={tab} onChange={setTab} ariaLabel="This change" countFormat="exact" className="flex flex-col gap-[12px]">
        <TabPanel tabKey="overview">
          {tab === 'overview' && <OverviewTab change={change} today={today} onGo={go} onUpdate={(data) => update.mutate({ data })} onClose={() => setClosing(true)} />}
        </TabPanel>
        <TabPanel tabKey="obligations">
          {tab === 'obligations' && <ObligationsTab changeId={changeId} address={a} setAddress={setAddress} onTask={openTask} />}
        </TabPanel>
        <TabPanel tabKey="assessments">
          {tab === 'assessments' && <AssessmentsTab changeId={changeId} gapsOnly={a.gaps} setGapsOnly={(on) => setAddress({ gaps: on })} onTask={openTask} onRerun={() => rerun.mutate()} rerunning={rerun.isPending || running} />}
        </TabPanel>
        <TabPanel tabKey="tasks">
          {tab === 'tasks' && <TasksTab changeId={changeId} address={a} setAddress={setAddress} onOpen={openTask} today={today} />}
        </TabPanel>
      </Tabs>

      {task && <TaskEditor key={task.seq} changeId={changeId} task={task.task} onClose={() => setTask(null)} />}
      <CloseSheet
        open={closing} onClose={() => setClosing(false)} change={change} tasks={tasksQ.data ?? []}
        onGoToTasks={() => go('tasks')} onAddTask={() => { go('tasks'); openTask({ title: '', task_type: 'process_change', priority: 'medium' }); }}
      />
      {confirmDialog}
    </div>
  );
}
