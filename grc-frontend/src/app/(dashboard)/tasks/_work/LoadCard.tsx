'use client';

// "Your load": the one compact card beside the worklist. How many tasks are open, how they split by priority (each a link to the same tasks in All tasks), how many the person finished in the
// last 30 days, and the two other places their work waits: Needs my action (document decisions and acknowledgements, counted by the shared inbox) and the controls and requirements assigned to
// them (My Work, a link only: its count needs one request for every framework, which this page does not make). Each part loads, fails and has nothing on its own.
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Button, CountRow, SectionCard, SkeletonRows } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import type { Tone } from '@/lib/status';
import { tasksHref } from '../taskTabs';
import type { Load } from './taskWork';

const PRIORITY_TONE: Record<string, Tone> = { Critical: 'danger', High: 'warning', Medium: 'progress', Low: 'neutral', Other: 'neutral' };

export interface NeedsMyAction {
  state: 'loading' | 'error' | 'ready';
  count: number;
  onRetry: () => void;
}

export interface LoadCardProps {
  id: string;
  state: 'loading' | 'ready';
  load: Load | null;
  needs: NeedsMyAction;
  /** the person may open My Work (its rule is the page's own: my-work/myWorkAccess.ts) */
  myWork: boolean;
}

export function LoadCard({ id, state, load, needs, myWork }: LoadCardProps) {
  return (
    <SectionCard id={id} title="Your load" info="Your open tasks by priority, each opening the same tasks in All tasks, and the other places your work waits.">
      {state === 'loading' && <SkeletonRows rows={4} columns={2} label="Loading your load" />}
      {state === 'ready' && load && (
        <>
          <div className="flex items-baseline gap-[8px]">
            <span className="text-[32px] font-[600] leading-none tabular-nums text-ds-fg">{formatCount(load.open)}</span>
            <span className="text-ds-body text-ds-fg-muted">{load.open === 1 ? 'task open' : 'tasks open'}</span>
          </div>
          <ul aria-label="Open tasks by priority" className="m-0 mt-[8px] list-none p-0">
            {load.byPriority.filter((p) => p.count > 0).map((p) => (
              <CountRow key={p.word} label={p.word} count={p.count} href={p.href ?? undefined} tone={PRIORITY_TONE[p.word] ?? 'neutral'} />
            ))}
          </ul>
          <p className="m-0 mt-[8px] text-ds-body text-ds-fg-muted">
            <span className="font-[600] tabular-nums text-ds-fg">{formatCount(load.done30)}</span> finished in the last 30 days
          </p>
        </>
      )}
      <div className="mt-[12px] border-t border-ds-border pt-[8px]">
        <h3 className="m-0 !text-ds-label !font-[600] !text-ds-fg-muted">Also waiting for you</h3>
        <ul className="m-0 list-none p-0">
          <CountRow
            label="Needs my action"
            count={needs.state === 'ready' ? needs.count : null}
            href="/needs-my-action"
            loading={needs.state === 'loading'}
            error={needs.state === 'error' ? { onRetry: needs.onRetry } : null}
            tone={needs.count > 0 ? 'pending' : 'neutral'}
          />
          {myWork && (
            <li className="min-w-0 border-b border-ds-border last:border-b-0">
              <Link href="/my-work" className="flex min-h-ds-control w-full min-w-0 items-center gap-[8px] rounded-ds-control px-[8px] py-[4px] text-ds-body text-ds-fg hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]">
                <span className="min-w-0 flex-1">Controls and requirements assigned to you</span>
                <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />
              </Link>
            </li>
          )}
        </ul>
      </div>
      <div className="mt-[12px]"><Button href={tasksHref('all', { quick: 'mine' })}>Open All tasks</Button></div>
    </SectionCard>
  );
}
