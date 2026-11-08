'use client';

// The AI helpers of the Insights tab, Predict escalations and Balance workload, and the sheet shell the third one (AI Reprioritize, _AiPriorities.tsx) shares. A helper's answer opens in a SHEET
// beside the page (it used to be a card far below the button, off the screen): what the AI read in words (it reads 50 tasks for two of them and the old screens never said so), a wait that is
// announced, a failure that says what happened with Retry, and the answer. The calls are the old ones (aiPredictEscalations, aiBalanceWorkload); a suggestion to change a task is a row with
// an Apply of its own and "Apply all" in the footer (SuggestionRows.tsx). The answer is read once when it arrives: it is the list the person reviews, it is not read again after a write.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Scale, Sparkles } from 'lucide-react';
import { Button, FormError, Sheet, SkeletonLines, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { criticalTasksApi } from '@/lib/api';
import { NOT_SET, formatDate } from '@/lib/format';
import type { RegisterTask } from '../taskRecord';
import { aiReach, loadChips, predictionView, reassignRows, type Prediction, type PredictionView, type ReassignRow, type Reassignment } from './aiModel';
import { SuggestionRows, taskCount, useApplyRows, type SuggestionItem } from './SuggestionRows';

type Answer<T> = { data?: T } | undefined;
const bodyOf = <T,>(response: unknown): T | undefined => (response as Answer<T>)?.data;

/** The sheet every AI answer opens in: the title, what the AI read, then the wait, the failure or the answer. */
export function AiShell({ open, onClose, title, reach, pending, error, failure, onRetry, footer, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** aiReach(...): what the AI looked at */
  reach: string;
  pending: boolean;
  error: unknown;
  failure: string;
  onRetry: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle="Written by AI from your tasks. Check it before you act." width="md" footer={footer}>
      <p className="mb-[12px] text-ds-body text-ds-fg-muted">{reach}</p>
      {pending && <div role="status" aria-label="The AI is working"><SkeletonLines lines={6} /></div>}
      {!pending && error ? <FormError title={failure} error={error} onRetry={onRetry} /> : null}
      {!pending && !error && children}
    </Sheet>
  );
}

const Chip = ({ children }: { children: ReactNode }) => <li className="rounded-ds-control border border-ds-border bg-ds-surface px-[8px] py-[4px] text-ds-label text-ds-fg-muted">{children}</li>;
const Quiet = ({ children }: { children: ReactNode }) => <p className="flex items-center gap-[8px] text-ds-body text-ds-success"><CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0" /> {children}</p>;

function PredictionCard({ v }: { v: PredictionView }) {
  return (
    <li className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[8px]">
        {v.taskId
          ? <Link href={`/tasks/${v.taskId}`} className="min-w-0 flex-1 basis-[12rem] rounded-ds-control text-ds-body font-[600] text-ds-primary-text underline-offset-[2px] [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{v.title}</Link>
          : <span className="min-w-0 flex-1 basis-[12rem] text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{v.title}</span>}
        {v.risk != null && <StatusPill size="sm" tone={v.tone} label={`Risk ${Math.round(v.risk)}%`} />}
      </div>
      {(v.confidence || v.breach) && (
        <p className="mt-[8px] text-ds-body text-ds-fg-muted">
          {v.confidence ? `Confidence ${v.confidence}` : null}{v.confidence && v.breach ? ' · ' : null}{v.breach ? `May breach on ${formatDate(v.breach, { empty: NOT_SET })}` : null}
        </p>
      )}
      {v.factors.length > 0 && <p className="mt-[8px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">Risk factors: {v.factors.join(', ')}</p>}
      {v.actions.length > 0 && <p className="mt-[4px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">Actions: {v.actions.join(' · ')}</p>}
    </li>
  );
}

interface Plan { summary: string; message: string; chips: ReturnType<typeof loadChips>; rows: ReassignRow[] }

/** The Balance workload sheet: the rows of the answer, what each write did, the footer. A new answer starts the outcomes again. */
function BalanceSheet({ open, onClose, reach, pending, error, onRetry, plan }: { open: boolean; onClose: () => void; reach: string; pending: boolean; error: unknown; onRetry: () => void; plan: Plan | null }) {
  const { confirm, confirmDialog } = useConfirm();
  const rows = plan?.rows ?? [];
  // the whole list of people is sent: the server keeps the owner it is given and leaves the list alone, so the old owner would stay on the task
  const writer = useApplyRows<ReassignRow>({ run: (r) => criticalTasksApi.update(r.taskId, { assigned_user_ids: r.people }), done: (n) => `Reassigned ${taskCount(n)}`, failed: "Couldn't reassign the tasks" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { writer.reset(); }, [plan]);
  const items: SuggestionItem[] = rows.map((r) => ({
    key: r.key, taskId: r.taskId, title: r.title, reason: r.reason,
    change: <><span className="text-ds-danger">{r.from}</span><ArrowRight aria-label="goes to" className="h-[16px] w-[16px] text-ds-fg-muted" /><span className="text-ds-success">{r.to}</span></>,
  }));
  const todo = rows.filter((r) => writer.outcomes[r.key] !== '');
  const applyAll = async () => {
    const yes = await confirm({
      title: `Reassign ${taskCount(todo.length)}?`,
      message: 'Each task goes to the person the AI suggests, and the person it is taken from is no longer on it. A document request is never moved.',
      confirmLabel: `Reassign ${taskCount(todo.length)}`,
    });
    if (yes) writer.apply(todo);
  };
  return (
    <>
      <AiShell
        open={open} onClose={onClose} title="Workload balance" reach={reach} pending={pending} error={error} failure="AI couldn't balance the workload" onRetry={onRetry}
        footer={(
          <div className="flex items-center justify-end gap-[8px]">
            <Button onClick={onClose}>Close</Button>
            {todo.length > 0 && <Button variant="primary" loading={writer.pending && writer.applying.length > 1} disabled={writer.pending} onClick={() => { void applyAll(); }}>{`Apply all (${todo.length})`}</Button>}
          </div>
        )}
      >
        <div className="flex flex-col gap-[16px]">
          {plan?.summary && <p className="m-0 text-ds-body text-ds-fg">{plan.summary}</p>}
          {plan && plan.chips.length > 0 && (
            <div>
              <h3 className="mb-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">Current load</h3>
              <ul className="m-0 flex list-none flex-wrap gap-[8px] p-0">{plan.chips.map((c) => <Chip key={c.name}>{c.name}: <b className="font-[600] text-ds-fg">{c.count}</b>{c.level ? ` (${c.level})` : ''}</Chip>)}</ul>
            </div>
          )}
          {rows.length === 0
            ? <Quiet>{plan?.message || 'The AI has no reassignment to suggest.'}</Quiet>
            : <SuggestionRows items={items} outcomes={writer.outcomes} pending={writer.pending} applying={writer.applying} onApply={(key) => writer.apply(rows.filter((r) => r.key === key))} />}
        </div>
      </AiShell>
      {confirmDialog}
    </>
  );
}

/** The two buttons of the Insights tab and their sheets. `rows` are the tasks loaded (an answer is read against them), `complete` says the load holds every task there is. */
export function AiHelpers({ rows, complete }: { rows: readonly RegisterTask[]; complete: boolean }) {
  const [open, setOpen] = useState<'predict' | 'balance' | null>(null);
  const [predictions, setPredictions] = useState<{ cards: PredictionView[]; message: string }>({ cards: [], message: '' });
  const [plan, setPlan] = useState<Plan | null>(null);
  const loaded = useRef(rows);
  loaded.current = rows;
  const close = () => setOpen(null);

  const predict = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiPredictEscalations(),
    success: 'Done',                                                   // not used: the sheet shows the answer, the wait and the failure
    failure: "AI couldn't predict escalations",
    toast: 'none',
    onSuccess: (res) => {
      const body = bodyOf<{ predictions?: Prediction[]; message?: string }>(res);
      setPredictions({ cards: (body?.predictions ?? []).map(predictionView), message: body?.message ?? '' });
    },
  });
  const balance = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiBalanceWorkload(),
    success: 'Done',
    failure: "AI couldn't balance the workload",
    toast: 'none',
    onSuccess: (res) => {
      const body = bodyOf<{ summary?: string; message?: string; current_workload?: Record<string, unknown>; suggestions?: Reassignment[] }>(res);
      setPlan({ summary: body?.summary ?? '', message: body?.message ?? '', chips: loadChips(body?.current_workload), rows: reassignRows(body?.suggestions, loaded.current) });
    },
  });

  return (
    <>
      <Button leftIcon={<Sparkles aria-hidden />} onClick={() => { setOpen('predict'); predict.mutate(); }}>Predict escalations</Button>
      <Button leftIcon={<Scale aria-hidden />} onClick={() => { setOpen('balance'); setPlan(null); balance.mutate(); }}>Balance workload</Button>

      <AiShell
        open={open === 'predict'} onClose={close} title="Escalation predictions" reach={aiReach('predict', rows, complete)} pending={predict.isPending} error={predict.error}
        failure="AI couldn't predict escalations" onRetry={() => predict.mutate()} footer={<div className="flex justify-end"><Button onClick={close}>Close</Button></div>}
      >
        {predictions.cards.length === 0
          ? <Quiet>{predictions.message || 'No escalation risks detected.'}</Quiet>
          : <ul className="m-0 flex list-none flex-col gap-[12px] p-0">{predictions.cards.map((v, i) => <PredictionCard key={`${v.taskId ?? 'x'}-${i}`} v={v} />)}</ul>}
      </AiShell>

      <BalanceSheet open={open === 'balance'} onClose={close} reach={aiReach('balance', rows, complete)} pending={balance.isPending} error={balance.error} onRetry={() => balance.mutate()} plan={plan} />
    </>
  );
}
