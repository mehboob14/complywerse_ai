'use client';

// One group of the Tracker (Draft, In review, ... Changes requested, Review overdue ...): a header that is a disclosure button (aria-expanded) with the group's name, its count and the ONE line
// of what holds it up ("4 late, 1 stuck"), CLOSED until it is pressed. Opening it lists its documents as compact lines, 25 at a time ("Show more"): each page of 25 asks the server for its own
// lines (useTrackerLines), so a library of thousands costs nothing until a group is opened and one request per page after that. The (i) beside the header says what being in the group means.
import { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Button, ErrorState } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui';
import { formatCount } from '@/lib/format';
import type { GovDoc } from '../lib';
import { ROWS_AT_A_TIME, pagesOf, rowsShown, type Group } from '../libraryTracker';
import { TrackerRow, type RowEnv } from './TrackerRow';
import { useTrackerLines } from './useTrackerData';

const MARK: Record<string, string> = { danger: 'bg-ds-danger', warning: 'bg-ds-warning', success: 'bg-ds-success', progress: 'bg-ds-primary', pending: 'bg-ds-primary', neutral: 'bg-ds-border-control' };

/** The rows of ONE page of a group: one request for their lines, never one per document. */
function RowsPage({ docs, env, openRows, onToggleRow }: { docs: readonly GovDoc[]; env: RowEnv; openRows: ReadonlySet<number>; onToggleRow: (id: number) => void }) {
  const ids = docs.map((d) => d.id);
  const q = useTrackerLines(ids);
  const byId = new Map((q.data?.items ?? []).map((l) => [l.id, l]));
  const lineState = q.data ? 'ready' : q.isError ? 'failed' : 'loading';
  return (
    <>
      {q.isError && !q.data && (
        <li className="list-none border-b border-ds-border">
          <ErrorState compact title="Couldn't load who these wait on" onRetry={() => { void q.refetch(); }} />
        </li>
      )}
      {docs.map((d) => <TrackerRow key={d.id} doc={d} line={byId.get(d.id)} lineState={lineState} env={env} open={openRows.has(d.id)} onToggle={onToggleRow} />)}
    </>
  );
}

export interface TrackerGroupProps {
  group: Group<GovDoc>;
  open: boolean;
  onToggle: (id: Group['def']['id']) => void;
  env: RowEnv;
  openRows: ReadonlySet<number>;
  onToggleRow: (id: number) => void;
}

export function TrackerGroup({ group, open, onToggle, env, openRows, onToggleRow }: TrackerGroupProps) {
  const { def, count, summary } = group;
  const [shown, setShown] = useState(ROWS_AT_A_TIME);
  const panel = `tracker-group-${def.id}`;
  const { count: drawn, more } = rowsShown(shown, count);
  const pages = open ? pagesOf(group.docs, shown) : [];
  return (
    <li className="list-none border-b border-ds-border last:border-b-0">
      <div className="flex min-w-0 items-center">
        <h3 className="m-0 min-w-0 flex-1 !text-ds-body !font-[600] !text-ds-fg">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? panel : undefined}
            onClick={() => onToggle(def.id)}
            className="flex min-h-[44px] w-full min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[2px] px-[8px] py-[6px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
          >
            <ChevronRight aria-hidden className={clsx('h-[14px] w-[14px] shrink-0 text-ds-fg-muted transition-transform', open && 'rotate-90')} strokeWidth={2} />
            <span aria-hidden className={clsx('h-[8px] w-[8px] shrink-0 rounded-full', MARK[def.tone] ?? MARK.neutral)} />
            <span className="shrink-0 text-ds-body font-[600] text-ds-fg">{def.label}</span>
            <span className="inline-flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-ds-surface-subtle px-[6px] text-ds-label font-[600] tabular-nums text-ds-fg-body">
              {formatCount(count)}
              <span className="sr-only">{count === 1 ? ' document' : ' documents'}</span>
            </span>
            {summary && <span title={summary} className="min-w-0 flex-1 basis-[10rem] text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]">{summary}</span>}
          </button>
        </h3>
        <span className="shrink-0 pr-[8px]"><InfoTip text={def.info} label={`What “${def.label}” means`} align="end" /></span>
      </div>
      {open && (
        <div id={panel} className="min-w-0 border-t border-ds-border">
          <ul aria-label={`${def.label}: documents`} className="m-0 list-none p-0">
            {pages.map((page) => <RowsPage key={page[0].id} docs={page} env={env} openRows={openRows} onToggleRow={onToggleRow} />)}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[12px] py-[8px]">
            <span role="status" className="text-ds-label text-ds-fg-muted">{drawn < count ? `Showing ${formatCount(drawn)} of ${formatCount(count)}` : `${formatCount(count)} ${count === 1 ? 'document' : 'documents'}`}</span>
            {more > 0 && <Button onClick={() => setShown(drawn + ROWS_AT_A_TIME)}>{`Show ${formatCount(more)} more`}</Button>}
          </div>
        </div>
      )}
    </li>
  );
}
