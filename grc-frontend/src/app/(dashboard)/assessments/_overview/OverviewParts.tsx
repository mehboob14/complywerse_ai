'use client';

/**
 * The parts of the Assessments Overview the cockpit frame (components/overview) arranges around the graphs (Visuals.tsx): "My work" (the signed-in person's own controls, drafts to scope and evidence to
 * decide: the slim card of Overview rule R3, a header with the true count and how many are late, at most three one-line rows each with its one action, "See all"), the gaps card's body (the gaps by
 * state and by due date, "what if" in the address, Tune SLA) and the empty page. Every figure is the server's; each part loads, fails (with Retry) and is empty on its own, and a figure that is not
 * recorded says so and is never 0. Rows and words: overviewModel.ts, visualModel.ts. The shared "My work" card (components/overview/MyWorkCard) reads the inbox, which does not carry these rows (a control
 * assigned to the person is not an inbox item), so this is its twin with the same markup, built on the same `compactDue` and header rules.
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowRight, CheckCircle2, Clock, SlidersHorizontal } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, ErrorState, SkeletonRows, StatusPill, TextInput } from '@/components/ui/ds';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SegmentBar } from '@/components/overview/charts';
import { MY_WORK_ROWS, compactDue } from '@/components/overview/workList';
import { formatCount, formatDate } from '@/lib/format';
import type { Board, MyWork, Point, Policy } from '../_data/types';
import { SlaDialog } from './SlaDialog';
import { daysOf, portfolioClock, whatIfBounds, whatIfMs, workSummary, type WorkRowModel } from './overviewModel';
import { agingParts, gapParts } from './visualModel';

const MUTED = 'text-ds-fg-muted';
const SEE_ALL = '/assessments/register?quick=waiting';

export interface Load { loading: boolean; error: unknown; retry: () => void }
const errorOf = (title: string, load: Load) => <ErrorState compact title={title} message={errorMessage(load.error)} onRetry={canRetry(load.error) ? load.retry : undefined} />;

// ── My work ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function MyWorkCard({ rows, work, limit = MY_WORK_ROWS, load }: { rows: WorkRowModel[]; work: MyWork | undefined; limit?: number; load: Load }) {
  const head = workSummary(work);
  const shown = rows.slice(0, Math.max(1, limit));
  const total = head?.total ?? 0;
  const cut = total > shown.length;
  return (
    <section id="work" aria-labelledby="work-h" className="min-w-0 scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[4px]">
        <h2 id="work-h" className="min-w-0 break-words !text-ds-section !text-ds-fg">My work</h2>
        <InfoTip text="Your own work, the most urgent first: controls assigned to you (or to a department you belong to) that are open, evidence waiting for your decision, and drafts you own that still need their scope." label="About my work" />
        {head && !load.error && total > 0 && (
          <span className={`ml-[4px] text-ds-body ${MUTED}`}>
            {formatCount(total)}
            {head.overdue > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(head.overdue)} overdue`}</span></>}
          </span>
        )}
        {head && !load.error && total > 0 && (
          <Link href={SEE_ALL} aria-label={cut ? `See all ${formatCount(total)} items in my work` : 'Open my work'} className={clsx('ml-auto inline-flex items-center gap-[2px]', linkClasses({ tone: 'text', size: 'label' }))}>
            {cut ? `See all ${formatCount(total)}` : 'Open'}
            <ArrowRight aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
          </Link>
        )}
      </div>
      {load.loading ? <div className="mt-[8px]"><SkeletonRows rows={Math.max(1, limit)} columns={3} label="Loading your work" /></div>
        : load.error ? errorOf("Couldn't load your work", load)
        : total === 0 ? (
          <p className={`mt-[4px] flex min-h-[32px] items-center gap-[8px] text-ds-body ${MUTED}`}>
            <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
            All caught up
          </p>
        ) : (
          <ul aria-label="My work" className="m-0 mt-[4px] list-none p-0">
            {shown.map((r) => {
              const due = compactDue({ due: r.due, overdue: r.kind.label === 'Overdue' });
              return (
                <li key={r.key} className="relative flex min-h-[40px] items-center gap-[8px] border-t border-ds-border px-[4px] py-[4px] first:border-t-0 hover:bg-ds-surface-hover has-[:focus-visible]:bg-ds-surface-hover">
                  <Link href={r.href} aria-label={`${r.action}: ${r.title}`} className="min-w-0 flex-1 truncate rounded-ds-control text-ds-body font-[500] text-ds-fg after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.title}</Link>
                  {r.due !== null || r.kind.label === 'Overdue' ? <StatusPill size="sm" tone={due.tone} label={due.text} className="shrink-0" /> : <StatusPill size="sm" tone={r.kind.tone} label={r.kind.label} className="shrink-0" />}
                  <span aria-hidden className="hidden shrink-0 text-ds-label font-[500] text-ds-primary-text sm:inline">{r.action}</span>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}

// ── The gaps card's body ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface GapsProps {
  board: Board | undefined;
  points: readonly Point[] | undefined;
  policy: Policy | undefined;
  pointsLoad: Load;
  /** the "what if" day from the address (a calendar day, or '') */
  asof: string;
  /** the people who hold the right to change the SLA */
  canTune: boolean;
}

/** The card's own controls: the "what if" day (the open gaps by their date if nothing is closed before it) and Tune SLA. */
export function GapsActions({ asof, onAsof, canTune, policy }: Pick<GapsProps, 'asof' | 'canTune' | 'policy'> & { onAsof: (day: string) => void }) {
  const [tuning, setTuning] = useState(false);
  const [now] = useState(() => Date.now());
  const bounds = whatIfBounds(now);
  return (
    <>
      <label className="flex items-center gap-[6px] text-ds-label text-ds-fg-body">
        As of
        <TextInput type="date" min={bounds.min} max={bounds.max} value={asof} onChange={(e) => onAsof(e.target.value)} className="w-[10.5rem]" aria-label="Show the open gaps as of this day, if nothing is closed before it" />
      </label>
      {asof && <Button size="sm" variant="ghost" onClick={() => onAsof('')}>Today</Button>}
      {canTune && <Button size="sm" leftIcon={<SlidersHorizontal aria-hidden />} onClick={() => setTuning(true)} disabled={!policy}>Tune SLA</Button>}
      {tuning && policy && <SlaDialog policy={policy} onClose={() => setTuning(false)} />}
    </>
  );
}

/** The gaps by state (closed, within target, overdue) and, under it, the open gaps by their due date as of today or the "what if" day. */
export function GapsBody({ board, points, policy, pointsLoad, asof }: GapsProps) {
  const [now] = useState(() => Date.now());
  const asOf = whatIfMs(asof, now);
  const states = gapParts(board);
  const clock = board && points ? portfolioClock(points, daysOf(policy), board, asOf ?? now) : null;
  const aging = clock ? agingParts(clock.aging) : [];
  const open = board?.sla.open ?? null;
  const caption = [
    'Open by due date',
    asOf ? `as of ${formatDate(asOf)}` : null,
    clock && clock.agingTotal > 0 && open !== null && clock.agingTotal !== open ? `${formatCount(clock.agingTotal)} of ${formatCount(open)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-[16px]">
      <SegmentBar label="Gaps by state" parts={states} height={20} />
      <div>
        <p className={`mb-[6px] text-ds-label ${MUTED}`}>{caption}</p>
        {pointsLoad.loading ? <SkeletonRows rows={1} columns={1} label="Loading the dates" />
          : pointsLoad.error ? errorOf("Couldn't load the dates", pointsLoad)
          : !clock ? null
          : aging.length === 0 ? <p className={`text-ds-body ${MUTED}`}>{points && points.length ? 'No open gaps.' : 'Nothing to track yet.'}</p>
          : <SegmentBar label={asOf ? `Open gaps by due date as of ${formatDate(asOf)}` : 'Open gaps by due date'} parts={aging} height={12} />}
        {asof && asOf === null && <p role="status" className={`mt-[6px] text-ds-label ${MUTED}`}>Choose a day after today, up to a year ahead.</p>}
      </div>
    </div>
  );
}

export function EmptyOverview({ action }: { action: ReactNode }) {
  return (
    <EmptyState kind="firstUse" icon={Clock} title="No assessments yet" description="Start an assessment for an application, a function or a system, or upload a workbook from Types." action={action} />
  );
}
