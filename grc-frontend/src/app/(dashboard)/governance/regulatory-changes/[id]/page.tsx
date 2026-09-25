'use client';

// One regulatory change: a compact header (status, priority and actions in
// reach), the AI's progress while it reads the circular, and four tabs.
// Details open in popups over the list, so the page itself barely scrolls.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowLeft, CheckCircle2, ClipboardList, FileText, Landmark, ListChecks, Loader2, Lock, RefreshCw, Target,
  Trash2, User,
} from 'lucide-react';
import { AnimatedModal, PageLoader, useToast } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { regulatoryApi } from '@/lib/api';
import RowActionsMenu from '../../documents/_workspace/RowActionsMenu';
import {
  CHANGE_STATUSES, ConfirmDialog, PRIORITIES, PillSelect, apiError, dueIn, fmtDate, regulatorName, useObligations,
  type RegulatoryChange, type TabFilter, type Task,
} from '../_ui';
import AssessmentsPanel from './_AssessmentsPanel';
import ObligationsPanel from './_ObligationsPanel';
import OverviewPanel from './_OverviewPanel';
import TasksPanel, { TaskEditor, type TaskDraft } from './_TasksPanel';

const TABS = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'obligations', label: 'Obligations', icon: ListChecks },
  { id: 'assessments', label: 'Impact assessments', icon: Target },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Shown while the AI reads the circular, if it failed, or if parts of it could not be read. */
function AnalysisBanner({ analysis, onRetry }: { analysis: NonNullable<RegulatoryChange['analysis']>; onRetry: () => void }) {
  if (analysis.status === 'failed') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="flex-1">The AI analysis did not finish: {analysis.error || 'unknown error'}.</span>
        <button type="button" onClick={onRetry} className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium">Run it again</button>
      </div>
    );
  }
  if (analysis.status === 'done') {
    const missed = analysis.counts?.failed || [];
    if (!missed.length) return null;
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
        <span className="flex-1">The AI could not read {missed.join(', ')}. The rest of the circular was read in full.</span>
        <button type="button" onClick={onRetry} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-medium">Run it again</button>
      </div>
    );
  }
  const total = analysis.total_steps || 0;
  const done = analysis.done_steps || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-primary-200 bg-primary-50/60 px-4 py-2.5" aria-live="polite">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-primary-900">
        <Loader2 className="h-4 w-4 animate-spin" />
        {analysis.status === 'queued' ? 'AI analysis is starting…' : 'AI is reading the circular'}
        {total > 0 && <span className="font-normal text-primary-800">· {done} of {total} parts read</span>}
        {(analysis.found ?? 0) > 0 && <span className="font-normal text-primary-800">· {plural(analysis.found ?? 0, 'obligation')} found so far</span>}
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-primary-100">
        <div className="h-1.5 rounded-full bg-primary-600 transition-all" style={{ width: `${Math.max(5, pct)}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-primary-800">Results appear below as each part is read, usually within two minutes. You can leave this page.</p>
    </div>
  );
}

/** Closing checks the tasks first: a change closes when its work is done. */
function CloseChange({ changeId, open, onClose }: { changeId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isFetching } = useQuery({
    queryKey: ['regulatory-closure', changeId],
    enabled: open,
    queryFn: async () => (await regulatoryApi.getClosureReadiness(changeId)).data as {
      ready_to_close: boolean; completed_tasks: number; total_tasks: number;
      incomplete_tasks?: Array<{ id: number; title: string; status: string; assignee?: string }>;
    },
  });
  const close = useMutation({
    mutationFn: () => regulatoryApi.closeChange(changeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      qc.invalidateQueries({ queryKey: ['regulatory-changes'] });
      toast({ title: 'Change closed', type: 'success' });
      onClose();
    },
    onError: (e) => toast({ title: 'Not closed', message: apiError(e), type: 'error' }),
  });
  const ready = !!data?.ready_to_close;
  return (
    <AnimatedModal isOpen={open} onClose={onClose} size="md" title="Close this change"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => close.mutate()} disabled={!ready || close.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {close.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Close change
          </button>
        </div>
      )}>
      <div className="space-y-3 px-5 py-4 text-sm">
        {isFetching && !data ? (
          <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking the tasks…</p>
        ) : data && (
          <>
            <p className={ready ? 'text-emerald-700' : 'text-amber-800'}>
              {ready ? 'Every task is done. The change can be closed.' : `${data.completed_tasks} of ${data.total_tasks} tasks are done. Finish these first:`}
            </p>
            {!ready && (data.incomplete_tasks || []).length > 0 && (
              <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {(data.incomplete_tasks || []).map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-slate-800">{t.title}</span>
                    {t.assignee && <span className="flex items-center gap-1 text-xs text-slate-500"><User className="h-3 w-3" /> {t.assignee}</span>}
                    <span className="text-xs text-slate-500">{t.status.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AnimatedModal>
  );
}

export default function RegulatoryChangeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const changeId = Number(params.id);

  // ?tab=obligations — the regulatory card on a control's page links straight here.
  const [tab, setTab] = useState(() => {
    const asked = searchParams?.get('tab');
    return TABS.some((t) => t.id === asked) ? (asked as string) : 'overview';
  });
  const [filter, setFilter] = useState<TabFilter>({});
  const [task, setTask] = useState<{ seq: number; task: Task | TaskDraft } | null>(null);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const go = (id: string, next: TabFilter = {}) => {
    setFilter(next);
    setTab(id);
    router.replace(`?tab=${id}`, { scroll: false });
  };
  const openTask = (t: Task | TaskDraft) => setTask({ seq: Date.now(), task: t });

  const { data: change, isLoading, error } = useQuery({
    queryKey: ['regulatory-change', changeId],
    queryFn: async () => (await regulatoryApi.getChange(changeId)).data as RegulatoryChange,
    // Follow a circular analysis while it runs in the background.
    refetchInterval: (query) =>
      ['queued', 'running'].includes((query.state.data as RegulatoryChange | undefined)?.analysis?.status || '') ? 4000 : false,
  });
  const { data: obligations = [] } = useObligations(changeId);

  // While a run is going, what it has written so far shows as each part is read.
  const progress = change?.analysis ? `${change.analysis.status}:${change.analysis.done_steps ?? 0}` : '';
  const lastProgress = useRef(progress);
  useEffect(() => {
    const was = lastProgress.current;
    lastProgress.current = progress;
    if (was !== progress && /^(queued|running):/.test(was)) {
      ['regulatory-assessments', 'regulatory-tasks', 'regulatory-obligations', 'regulatory-links'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k, changeId] }));
    }
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useMutation({
    mutationFn: (data: Record<string, unknown>) => regulatoryApi.updateChange(changeId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      qc.invalidateQueries({ queryKey: ['regulatory-changes'] });
    },
    onError: (e) => toast({ title: 'Not saved', message: apiError(e), type: 'error' }),
  });
  const rerun = useMutation({
    mutationFn: () => regulatoryApi.regenerateAssessments(changeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      toast({ title: 'The AI is reading the circular again', message: 'Results appear as each part is read.', type: 'success' });
    },
    onError: (e) => toast({ title: 'Could not start', message: apiError(e, 'The analysis could not start.'), type: 'error' }),
  });
  const remove = useMutation({
    mutationFn: () => regulatoryApi.deleteChange(changeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulatory-changes'] });
      qc.invalidateQueries({ queryKey: ['regulatory-dashboard'] });
      toast({ title: 'Change deleted', type: 'success' });
      router.push('/governance/regulatory-changes');
    },
    onError: (e) => toast({ title: 'Not deleted', message: apiError(e), type: 'error' }),
  });

  if (isLoading) return <PageLoader className="h-64" />;
  if (error || !change) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-rose-600" />
        <p className="mt-2 text-rose-700">This regulatory change could not be loaded.</p>
        <Link href="/governance/regulatory-changes" className="mt-4 inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700">
          <ArrowLeft className="h-4 w-4" /> Back to regulatory changes
        </Link>
      </div>
    );
  }

  const running = ['queued', 'running'].includes(change.analysis?.status || '');
  const effective = dueIn(change.effective_date);
  const counts: Record<string, string | number | null> = {
    overview: null,
    obligations: obligations.length,
    assessments: change.assessment_count ?? null,
    tasks: change.task_count ? `${change.completed_task_count || 0}/${change.task_count}` : 0,
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href="/governance/regulatory-changes" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Regulatory changes
        </Link>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-snug text-slate-900 sm:text-xl">{change.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1 font-medium text-slate-700"><Landmark className="h-3.5 w-3.5" /> {regulatorName(change.source)}</span>
              {change.reference_number && <span>· {change.reference_number}</span>}
              {change.effective_date && (
                <span>· Effective {fmtDate(change.effective_date)}{effective && !effective.late && change.status !== 'completed' ? ` (${effective.text})` : ''}</span>
              )}
              {change.assignee_name && <span>· Owner {change.assignee_name}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PillSelect size="md" value={change.status} options={CHANGE_STATUSES} label="Status" onChange={(v) => update.mutate({ status: v })} />
            <PillSelect size="md" value={change.priority} options={PRIORITIES} label="Priority" onChange={(v) => update.mutate({ priority: v })} />
            <RowActionsMenu actions={[
              { key: 'rerun', label: running ? 'AI is reading…' : 'Re-run AI analysis', icon: RefreshCw, onClick: () => { if (!running) rerun.mutate(); } },
              { key: 'close', label: 'Close this change', icon: Lock, onClick: () => setClosing(true), hidden: change.status === 'completed' },
              { key: 'delete', label: 'Delete change', icon: Trash2, variant: 'danger', onClick: () => setDeleting(true),
                hidden: !hasPermission('governance:regulatory_changes:delete') },
            ]} />
          </div>
        </div>
      </div>

      {change.analysis && <AnalysisBanner analysis={change.analysis} onRetry={() => rerun.mutate()} />}

      <nav role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => {
          const on = tab === t.id;
          const n = counts[t.id];
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => go(t.id)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                on ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <t.icon className="h-4 w-4" /> {t.label}
              {n !== null && (
                <span className={`rounded-full px-1.5 text-[11px] font-medium ${on ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-600'}`}>{n}</span>
              )}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' && <OverviewPanel change={change} onGo={go} onUpdate={(d) => update.mutate(d)} onClose={() => setClosing(true)} />}
      {tab === 'obligations' && <ObligationsPanel changeId={changeId} onTask={openTask} initial={filter} />}
      {tab === 'assessments' && (
        <AssessmentsPanel changeId={changeId} onTask={openTask} initial={filter}
          onRerun={() => rerun.mutate()} rerunning={rerun.isPending || running} />
      )}
      {tab === 'tasks' && <TasksPanel changeId={changeId} onOpen={openTask} initial={filter} />}

      {task && <TaskEditor key={task.seq} changeId={changeId} task={task.task} onClose={() => setTask(null)} />}
      <CloseChange changeId={changeId} open={closing} onClose={() => setClosing(false)} />
      <ConfirmDialog open={deleting} title="Delete this regulatory change?" busy={remove.isPending}
        message={<>&ldquo;{change.title}&rdquo; and its obligations, assessments and tasks will be removed.</>}
        onCancel={() => setDeleting(false)} onConfirm={() => remove.mutate()} />
    </div>
  );
}
