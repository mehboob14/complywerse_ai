'use client';

/**
 * WorkbenchView: the default view. A list of files on the left and the open file's preview on the right (from 1024px), or the list alone with the preview as a
 * full-height sheet (below 1024px: a phone no longer has to scroll past the list to see what a row opened).
 *
 * The list is a real listbox: ONE Tab stop (the selected file, else the one last focused, else the first), ArrowUp / ArrowDown, PageUp / PageDown, Home and End
 * move between files, Enter or Space opens one, a click does too. It used to be a hundred buttons, each a Tab stop. A page of it is drawn (the pager says how
 * many there are in all) and what is selected is `aria-selected`, told by its tint and by the preview beside it.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { EmptyState, ErrorState, Pager, SkeletonLines } from '@/components/ui/ds';
import { optionAfter, pageOfRows, type EvidenceItem } from './evidenceModel';
import { EvidenceRow } from './EvidenceRow';

const PAGE_SIZES = [25, 50, 100] as const;
export const LIST_ID = 'evidence-list';

function EvidenceList({ rows, selectedId, onSelect }: { rows: EvidenceItem[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const box = useRef<HTMLUListElement>(null);
  const [stop, setStop] = useState<number | null>(null);                  // the option the Tab key lands on: the last one that had focus
  const has = (id: number | null) => id !== null && rows.some((r) => r.id === id);
  const tabStopId = has(stop) ? stop : has(selectedId) ? selectedId : rows[0]?.id ?? null;

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const options = Array.from(box.current?.querySelectorAll<HTMLElement>('[role=option]') ?? []);
    const at = options.indexOf(document.activeElement as HTMLElement);
    if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
      e.preventDefault();
      onSelect(rows[at].id);
      return;
    }
    const to = optionAfter(options.length, at, e.key);
    if (to === null || to < 0) return;
    e.preventDefault();
    options[to].focus();
  };

  return (
    <ul id={LIST_ID} ref={box} role="listbox" aria-label="Evidence" onKeyDown={onKeyDown} className="flex flex-col gap-[6px]">
      {rows.map((item) => (
        <EvidenceRow key={item.id} item={item} selected={item.id === selectedId} tabStop={item.id === tabStopId} onFocus={() => setStop(item.id)} onOpen={() => onSelect(item.id)} />
      ))}
    </ul>
  );
}

export function WorkbenchView({ items, page, pageSize, onPage, onPageSize, selectedId, onSelect, loading, error, empty, preview }: {
  /** every file that passes the filters */
  items: EvidenceItem[];
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
  error: { message: string; onRetry?: () => void } | null;
  /** what to show when there is nothing to list (nothing yet, or nothing matches) */
  empty: ReactNode;
  /** the preview of the selected file (docked beside the list) or null (a sheet draws it elsewhere) */
  preview: ReactNode;
}) {
  const { range, rows } = pageOfRows(items, page, pageSize);

  // the selected file into view when it is chosen from outside the list (a link with ?open=, Back) or the list arrives after it
  const box = useRef<HTMLDivElement>(null);
  const present = selectedId !== null && rows.some((r) => r.id === selectedId);
  useEffect(() => {
    if (present) box.current?.querySelector(`[data-evidence-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, present]);

  let list: ReactNode;
  if (loading) list = <SkeletonLines lines={8} label="Loading the evidence" />;
  else if (error) list = <ErrorState compact title="Couldn't load the evidence" message={error.message} onRetry={error.onRetry} />;
  else if (items.length === 0) list = <div className="rounded-ds-card border border-ds-border bg-ds-surface">{empty}</div>;
  else {
    list = (
      <div className="flex flex-col gap-[12px]">
        <EvidenceList rows={rows} selectedId={selectedId} onSelect={onSelect} />
        <Pager page={range.page} pageSize={pageSize} total={items.length} noun={{ one: 'evidence item', other: 'evidence items' }} pageSizes={PAGE_SIZES} onPage={onPage} onPageSize={onPageSize} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-12">
      <div ref={box} className={preview ? 'min-w-0 lg:col-span-5' : 'min-w-0 lg:col-span-12'}>{list}</div>
      {preview && <div className="min-w-0 lg:col-span-7"><div className="lg:sticky lg:top-[16px]">{preview}</div></div>}
    </div>
  );
}
