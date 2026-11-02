'use client';

// A few people at a glance: the first N as avatars, then a "+M" button for the rest. The button's accessible name lists them
// ("+2 more: Sara Reviewer, Khalid Approver"); pressing it (click, Enter, Space) opens the same list as a note beside it, and Escape, a click
// elsewhere, a scroll or a resize closes it. The note is drawn fixed to the window (a portal), so a table or a card never clips it.
// The avatars sit side by side, not overlapped: the initials are what tells two people apart, and a tucked-under neighbour hides half of one.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { UNASSIGNED } from '@/lib/format';
import { personStack } from '@/lib/people';
import { Avatar, type AvatarSize } from './Avatar';
import { PersonChip } from './PersonChip';
import { popoverSpot, type Spot } from './popoverSpot';

export interface PersonStackProps {
  /** display names; a blank one is left out */
  people: ReadonlyArray<string | null | undefined> | null | undefined;
  /** how many avatars show before the +M button (default 3) */
  max?: number;
  size?: AvatarSize;
  /** what the group is, for a screen reader: "Reviewers" */
  label?: string;
  /** shown when there is nobody (default "Unassigned") */
  emptyLabel?: string;
  className?: string;
}

// The button is never under 24px (WCAG 2.2 target size), even beside 20px avatars.
const MORE: Record<AvatarSize, string> = { 20: 'h-[24px] min-w-[24px]', 24: 'h-[24px] min-w-[24px]', 32: 'h-[32px] min-w-[32px]' };
const LIST_MAX = 240;
const ROW = 36;

export function PersonStack({ people, max = 3, size = 24, label, emptyLabel = UNASSIGNED, className }: PersonStackProps) {
  const { shown, rest, more, moreLabel } = personStack(people, max);
  const [spot, setSpot] = useState<Spot | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = spot !== null;

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setSpot(null);
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && panel.current?.contains(e.target))) close(); };   // the list itself may scroll
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); button.current?.focus(); } };
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

  if (shown.length + more === 0) return <span className={clsx('whitespace-nowrap text-ds-body text-ds-fg-muted', className)}>{emptyLabel}</span>;

  const toggle = () => {
    const anchor = button.current?.getBoundingClientRect();
    if (open || !anchor) setSpot(null);
    else setSpot(popoverSpot(anchor, { width: window.innerWidth, height: window.innerHeight }, { need: Math.min(LIST_MAX, 16 + ROW * rest.length) }));
  };

  return (
    <span {...(label ? { role: 'group', 'aria-label': label } : {})} className={clsx('inline-flex items-center gap-1', className)}>
      {shown.map((name, i) => <Avatar key={i} name={name} size={size} />)}
      {more > 0 && (
        <button
          ref={button}
          type="button"
          aria-label={moreLabel}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          title={open ? undefined : moreLabel}
          onClick={toggle}
          className={clsx(
            'inline-flex shrink-0 items-center justify-center rounded-full border border-ds-border-strong bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-body hover:bg-ds-border focus-visible:outline-none focus-visible:shadow-ds-ring',
            MORE[size],
          )}
        >
          +{more}
        </button>
      )}
      {spot && more > 0 && typeof document !== 'undefined' && createPortal(
        <div
          ref={panel}
          id={panelId}
          role="group"
          aria-label="More people"
          style={{ left: spot.left, top: spot.top, bottom: spot.bottom, width: spot.width, maxHeight: Math.min(LIST_MAX, spot.maxHeight) }}
          className="fixed z-[80] overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-2 shadow-ds-pop"
        >
          <ul className="space-y-1">
            {rest.map((name, i) => <li key={i} className="flex min-w-0"><PersonChip name={name} size={24} /></li>)}
          </ul>
        </div>,
        document.body,
      )}
    </span>
  );
}
