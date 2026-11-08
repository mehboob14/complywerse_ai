'use client';

// The scoreboard: one row per area of the platform the person can open, the weakest scored areas first, then the areas that have a headline instead of a score, then the areas this page
// only links to. A row says the score, its grade (a word), how far it is from the target, the thing that needs attention first (a link to the records it counts) and, in the last column,
// the weakest section or the headline. A row opens in place to show every counter of the area, its three weakest sections and whose target it is, and goes to the area from its name.
// Each row loads, fails (with its own Retry), is refused or has nothing on its own; on a phone the rows are cards and the whole card is a closed disclosure. Rules: perfModel.ts.
import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { Button, CountRow, Disclosure, ProgressBar, RegisterTable, SectionCard, Skeleton, StatusPill, TitleLink, type RegisterColumn, type RowId } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { formatCount, formatPercent } from '@/lib/format';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { useSlow } from './parts';
import { againstTarget, attentionOf, retryable, targetNote, weakestThree, type AreaRow } from './perfModel';

const DASH = <span aria-hidden className="text-ds-fg-muted">—</span>;

function Words({ children }: { children: string }) {
  return <span className="text-ds-body text-ds-fg-muted">{children}</span>;
}

function ScoreCell({ row }: { row: AreaRow }) {
  if (row.state === 'loading') return <Skeleton className="ml-auto h-[16px] w-[40px]" />;
  if (row.state === 'error') return <span className="text-ds-body text-ds-danger">Couldn&apos;t load</span>;
  if (row.state === 'denied') return <Words>No access</Words>;
  if (row.state === 'link' || !row.read) return DASH;
  if (row.read.score !== null) return <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{Math.round(row.read.score)}</span>;
  return <Words>{row.area.kind === 'score' ? 'No score yet' : 'Not scored'}</Words>;
}

function GradeCell({ row }: { row: AreaRow }) {
  if (row.state !== 'ready' || !row.read?.grade) return DASH;
  return <StatusPill {...statusPill(gradeStatus, row.read.grade)} size="sm" />;
}

function AttentionCell({ row, onRetry }: { row: AreaRow; onRetry: (areaKey: string) => void }) {
  if (row.state === 'loading') return <Skeleton className="h-[16px] w-[120px]" />;
  if (row.state === 'error') return retryable(row) ? <Button variant="link" size="sm" onClick={() => onRetry(row.area.key)} aria-label={`Retry ${row.area.label}`}>Retry</Button> : DASH;
  if (row.state !== 'ready' || !row.read) return DASH;
  const a = attentionOf(row.read);
  if (a.top) {
    return (
      <div className="min-w-0">
        <TitleLink href={a.top.href} title={`${formatCount(a.top.value)} ${a.top.label}`} lines={2} />
        {a.more > 0 && <span className="text-ds-label text-ds-fg-muted">{`and ${a.more} more`}</span>}
      </div>
    );
  }
  if (a.clear) return <Words>Nothing overdue</Words>;
  return DASH;
}

function DetailCell({ row }: { row: AreaRow }) {
  if (row.state === 'link') return <Words>Open it to see its figures</Words>;
  if (row.state !== 'ready' || !row.read) return DASH;
  const weakest = weakestThree(row.read)[0];
  if (row.read.score !== null && weakest) return <span className="text-ds-body text-ds-fg-body">{`Weakest: ${weakest.label}, ${formatPercent(weakest.score)}`}</span>;
  return row.read.headline ? <span className="text-ds-body text-ds-fg-body">{row.read.headline}</span> : DASH;
}

/** What an opened row shows: every counter of the area (each opens the records it counts), its three weakest sections, whose target it is, and the way into the area. */
function Opened({ row }: { row: AreaRow }) {
  const { area, read } = row;
  const weak = weakestThree(read);
  const open = <Button size="sm" href={area.href}>{`Open ${area.label}`}</Button>;
  if (row.state === 'link') return <div className="flex flex-wrap items-center gap-[12px] px-[8px] py-[4px]"><Words>{`${area.label} has its own pages; its figures are not summarised here.`}</Words>{open}</div>;
  if (!read) {
    const why = row.state === 'loading' ? 'Still loading.' : row.state === 'denied' ? 'Your account cannot read this area.' : 'This area could not be read.';
    return <div className="flex flex-wrap items-center gap-[12px] px-[8px] py-[4px]"><Words>{why}</Words>{row.state === 'denied' ? null : open}</div>;
  }
  return (
    <div className="grid gap-[16px] px-[8px] py-[4px] md:grid-cols-3">
      <div className="min-w-0">
        <p className="mb-[4px] text-ds-label text-ds-fg-muted">Needs attention</p>
        {read.counters.length > 0 ? (
          <ul className="m-0 list-none p-0">
            {read.counters.map((c) => <CountRow key={c.key} label={c.label} count={c.value} href={c.href} tone={c.tone} />)}
          </ul>
        ) : <Words>Nothing is counted for this area here.</Words>}
      </div>
      <div className="min-w-0">
        <p className="mb-[4px] text-ds-label text-ds-fg-muted">Weakest sections</p>
        {weak.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
            {weak.map((s) => (
              <li key={s.key}>
                <div className="flex items-baseline justify-between gap-[8px] text-ds-body">
                  <span className="min-w-0 break-words text-ds-fg">{s.label}</span>
                  <span className="shrink-0 tabular-nums text-ds-fg-muted">{formatPercent(s.score)}</span>
                </div>
                <ProgressBar value={s.score} label={`${s.label} score`} showValue={false} tone={s.score >= (read.target ?? 70) ? 'success' : s.score >= 50 ? 'warning' : 'danger'} className="mt-[4px]" />
              </li>
            ))}
          </ul>
        ) : <Words>{read.headline ?? 'No sections are scored.'}</Words>}
      </div>
      <div className="min-w-0">
        <p className="mb-[4px] text-ds-label text-ds-fg-muted">Target</p>
        <p className="mb-[12px] text-ds-body text-ds-fg-body">{read.score !== null || read.target !== null ? targetNote(read) : 'This area has no score, so it has no target.'}</p>
        {open}
      </div>
    </div>
  );
}

export function Modules({ rows, total, onRetry, onRetryAll, narrow }: {
  rows: readonly AreaRow[];
  /** every area there is, for "N of M areas you can open" */
  total: number;
  onRetry: (areaKey: string) => void;
  onRetryAll: () => void;
  narrow: boolean;
}) {
  const [open, setOpen] = useState<RowId[]>([]);
  const [folded, setFolded] = useState(false);
  const slow = useSlow(rows.some((r) => r.state === 'loading'));
  const failed = rows.filter(retryable);

  const columns: RegisterColumn<AreaRow>[] = [
    { key: 'area', header: 'Area', isRowHeader: true, cell: (r) => <TitleLink href={r.area.href} title={r.area.label} lines={2} />, width: 'w-[220px]' },
    { key: 'score', header: 'Score', align: 'right', card: 'meta', cell: (r) => <ScoreCell row={r} />, width: 'w-[88px]' },
    { key: 'grade', header: 'Grade', card: 'meta', cell: (r) => <GradeCell row={r} />, width: 'w-[104px]' },
    { key: 'target', header: 'Against target', priority: 2, card: 'meta', cell: (r) => (r.state === 'ready' && againstTarget(r.read?.score, r.read?.target)) || DASH, width: 'w-[128px]' },
    { key: 'attention', header: 'Needs attention', card: 'meta', cell: (r) => <AttentionCell row={r} onRetry={onRetry} /> },
    { key: 'detail', header: 'Detail', priority: 3, card: 'meta', cell: (r) => <DetailCell row={r} /> },
  ];

  const table = (
    <RegisterTable
      caption="Performance by area"
      columns={columns}
      rows={rows.slice()}
      getRowId={(r) => r.area.key}
      cardTitle={(r) => <TitleLink href={r.area.href} title={r.area.label} lines={2} />}
      expand={{ open, onChange: setOpen, label: (r) => `Details of ${r.area.label}`, render: (r) => <Opened row={r} /> }}
    />
  );
  const meta = rows.length < total ? `${rows.length} of ${total} areas you can open` : `${rows.length} areas`;
  const retryAll = failed.length > 1 ? <Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={onRetryAll}>{`Retry ${failed.length} failed`}</Button> : undefined;

  if (narrow) {
    return (
      <section id="modules" className="min-w-0 scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px]">
        <Disclosure label={`By area (${rows.length})`} level={2} open={folded} onOpenChange={setFolded}>
          {folded && <div className="px-[8px] pb-[8px]">{retryAll && <div className="mb-[8px]">{retryAll}</div>}{table}</div>}
        </Disclosure>
      </section>
    );
  }
  return (
    <SectionCard
      id="modules"
      title="By area"
      info="Every area of the platform you can open: its score and grade where the server scores it, how far that is from the target, and what needs attention first. Open a row for all of its counters and its weakest sections. The weakest scored areas come first."
      meta={meta}
      actions={retryAll}
    >
      {table}
      {slow && <p className="mt-[8px] text-ds-label text-ds-fg-muted">Still loading. This is taking longer than usual.</p>}
    </SectionCard>
  );
}
