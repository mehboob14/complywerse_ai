'use client';

// ChipList: the related records of one record (its frameworks, its owners, its linked assets) as the first two chips and a "+N" that opens ALL of them. The rule
// for related records: the first two and "+N", never a count that hides the names and never a row that grows with the data. The "+N" is a button that opens a
// small dialog (not modal) with the whole list, as links where an item has an address, with a search box from eight items. Keyboard: Enter or Space on the
// "+N" opens it and moves focus in (the search box, else the dialog), Tab stays inside it, Escape closes it and gives focus back to the "+N"; a press outside,
// a scroll or a resize closes it too (like the +M of a PersonStack, whose list is a note only; this one holds links, so it must be reachable). It is drawn in
// a portal on the page, so a table or a card never clips it. A chip that is cut gives its whole text as a tooltip only then. Rules: chipListModel.ts.
//
//   <ChipList label="frameworks" items={doc.frameworks.map((f) => ({ label: f.name, href: `/frameworks/${f.id}` }))} />
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useDialogFocus } from '../useDialogFocus';
import { TextInput } from './TextInput';
import { popoverSpot, type Spot } from './popoverSpot';
import { useClipped } from './useClipped';
import { SEARCH_FROM, SHOWN, chipItems, dialogName, filterItems, moreName, resultLine, searchable, splitItems, type ChipListInput, type ChipListItem } from './chipListModel';

export type { ChipListItem };

export interface ChipListProps {
  /** The items: a name, or `{ label, href }` for a link. A blank one is left out. */
  items: readonly ChipListInput[] | null | undefined;
  /** What the items are, a plural noun in lower case ("frameworks"): it names the list, the "+N" ("+3 more frameworks") and the full list ("All frameworks"). */
  label: string;
  /** Chips shown before the "+N". */
  shown?: number;
  /** The full list has a search box from this many items. */
  searchFrom?: number;
  /** Layout only (margin, width). */
  className?: string;
}

const CHIP = 'inline-flex max-w-full min-w-0 items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label font-normal text-ds-fg-body';
const CHIP_LINK = 'min-h-ds-control-sm hover:border-ds-border-strong hover:bg-ds-primary-soft hover:text-ds-primary-text focus-visible:outline-none focus-visible:shadow-ds-ring';
const MORE = 'inline-flex min-h-ds-control-sm items-center rounded-ds-control px-[6px] text-ds-label font-medium text-ds-primary-text hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring';
const ROW = 'flex min-h-ds-control w-full min-w-0 items-center rounded-ds-control px-[8px] py-[4px] text-left text-ds-body text-ds-fg-body [overflow-wrap:anywhere]';
const ROW_LINK = 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const WIDTH = 288;
const MAX_HEIGHT = 320;
const ROW_HEIGHT = 36;

function Chip({ item }: { item: ChipListItem }) {
  const [word, clipped] = useClipped<HTMLSpanElement>();
  const label = <span ref={word} title={clipped ? item.label : undefined} className="min-w-0 truncate">{item.label}</span>;
  return item.href ? <Link href={item.href} className={clsx(CHIP, CHIP_LINK)}>{label}</Link> : <span className={CHIP}>{label}</span>;
}

export function ChipList({ items, label, shown = SHOWN, searchFrom = SEARCH_FROM, className }: ChipListProps) {
  const all = chipItems(items);
  const { visible, more } = splitItems(all, shown);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [query, setQuery] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const open = spot !== null;
  const canSearch = searchable(all.length, searchFrom);
  const found = canSearch ? filterItems(all, query) : all;

  useDialogFocus(open, panel);                                                       // focus moves in, Tab stays inside, focus returns to the "+N"
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setSpot(null);
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && panel.current?.contains(e.target))) close(); };   // the list itself scrolls
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();                                                            // taken: a dialog or a panel around this one must not close too
      close();
      button.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (all.length === 0) return null;

  const toggle = () => {
    const anchor = button.current?.getBoundingClientRect();
    if (open || !anchor) { setSpot(null); return; }
    setQuery('');
    setSpot(popoverSpot(anchor, { width: window.innerWidth, height: window.innerHeight }, { width: WIDTH, need: Math.min(MAX_HEIGHT, 56 + ROW_HEIGHT * Math.min(all.length, 7)) }));
  };

  return (
    <>
      <ul aria-label={label} className={clsx('flex min-w-0 flex-wrap items-center gap-[6px]', className)}>
        {visible.map((item, i) => <li key={`${item.label}-${i}`} className="min-w-0 max-w-full"><Chip item={item} /></li>)}
        {more > 0 && (
          <li>
            <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} aria-label={moreName(more, label)} onClick={toggle} className={MORE}>+{more}</button>
          </li>
        )}
      </ul>
      {spot && typeof document !== 'undefined' && createPortal(
        <div
          ref={panel}
          id={dialogId}
          role="dialog"
          aria-label={dialogName(label)}
          tabIndex={-1}
          style={{ left: spot.left, top: spot.top, bottom: spot.bottom, width: spot.width, maxHeight: Math.min(MAX_HEIGHT, spot.maxHeight) }}
          className="fixed z-[80] flex flex-col rounded-ds-card border border-ds-border bg-ds-surface shadow-ds-pop focus-visible:outline-none"
        >
          {canSearch && (
            <div className="shrink-0 border-b border-ds-border p-[8px]">
              <TextInput type="search" data-autofocus="" aria-label={`Find in ${label}`} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
              <p className="mt-[4px] min-h-[16px] text-ds-label font-normal text-ds-fg-muted" aria-live="polite">{resultLine(found.length, all.length)}</p>
            </div>
          )}
          <ul aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[4px]">
            {found.map((item, i) => (
              <li key={`${item.label}-${i}`} className="min-w-0">
                {item.href ? <Link href={item.href} className={clsx(ROW, ROW_LINK)}>{item.label}</Link> : <span className={ROW}>{item.label}</span>}
              </li>
            ))}
            {found.length === 0 && <li className="px-[8px] py-[8px] text-ds-body text-ds-fg-muted">No matches</li>}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
