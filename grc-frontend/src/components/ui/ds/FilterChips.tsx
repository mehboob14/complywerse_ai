'use client';

// FilterChips: a row of quick filters, each a toggle with the number of records it would show (the library's "Mine 12", "Review overdue 3", a
// committee with a live dot and an overdue badge). A chip is a button with `aria-pressed`; the row is a toolbar with ONE tab stop and the arrow keys
// (Left, Right, Home, End) between its chips, and Enter or Space toggles one: an arrow never toggles. The count is the true number ("1,247", never "99+").
// A flag (a dot, or a small badge) carries its words for a screen reader and a tooltip, so a chip is never told by colour alone. A label that does not
// fit is cut with an ellipsis and gives its whole text as a tooltip only then. `overflow="wrap"` (the default) lets the row wrap onto more lines;
// "scroll" keeps it to one line that scrolls sideways (with room around the chips for their focus ring). With `maxVisible`, the chips past it go to a
// "+N more" menu (the kit's Menu: each is a check with its count at its end); the trigger says how many of them are on. Decisions: filterChipsModel.ts.
//
//   <FilterChips label="Quick views" chips={[{ key: 'all', label: 'All', count: 1247, active: view === 'all' }, …]} onToggle={(key) => setView(key)} />
import { useRef, useState, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { Menu } from './Menu';
import { useClipped } from './useClipped';
import { chipStop, chipText, countText, moreItems, moreText, nextChip, splitChips, type ChipFlag, type FlagTone } from './filterChipsModel';

export type { ChipFlag, FlagTone };

export interface FilterChip {
  /** Identity; what `onToggle` receives. */
  key: string;
  label: string;
  /** The number of records the chip would show: the true count (1,247). Missing: none is drawn; 0 is a count. */
  count?: number | null;
  /** On (`aria-pressed`). The page holds it. */
  active?: boolean;
  /** A mark before the label (a dot) or after the count (a badge, when it has `text`); its `label` is what a screen reader and the tooltip say. */
  flag?: ChipFlag;
  /** A small icon before the label. */
  icon?: LucideIcon;
  /** Shown, cannot be toggled; the arrow keys skip it. */
  disabled?: boolean;
  /** Not shown at all. */
  hidden?: boolean;
  /** A tooltip of your own; by default the whole text of the chip, when its label is cut. */
  title?: string;
}

export interface FilterChipsProps {
  chips: FilterChip[];
  /** A chip was pressed (click, Enter, Space): its key. The page flips `active`. */
  onToggle: (key: string) => void;
  /** Names the row for a screen reader: "Quick views". */
  label: string;
  /** wrap: more lines when the chips do not fit (the default). scroll: one line that scrolls sideways. */
  overflow?: 'wrap' | 'scroll';
  /** Show at most this many chips; the rest go to a "+N more" menu (a cut that would leave one chip in it is not made). */
  maxVisible?: number;
  /** Layout only (margin, width). */
  className?: string;
}

// 28px (44px on a phone or a coarse pointer: the token), a pill, 12px words. The ring is outside, so the scrolling row leaves room for it.
const CHIP = 'inline-flex h-ds-control-sm max-w-full shrink-0 items-center gap-[6px] whitespace-nowrap rounded-full border px-[10px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-not-allowed disabled:opacity-50';
const OFF = 'border-ds-border-strong bg-ds-surface text-ds-fg-body enabled:hover:bg-ds-surface-hover';
const ON = 'border-ds-primary bg-ds-primary text-ds-on-primary enabled:hover:bg-ds-primary-hover';
const DOT: Record<FlagTone, string> = { info: 'bg-ds-info', warning: 'bg-ds-warning', danger: 'bg-ds-danger', success: 'bg-ds-success' };
// white words on the tone (5:1 and up); the surface-coloured edge keeps a dot or a badge apart from the filled chip it sits on
const BADGE: Record<FlagTone, string> = { info: 'bg-ds-info', warning: 'bg-ds-warning', danger: 'bg-ds-danger', success: 'bg-ds-success' };
const EDGE = 'shadow-[0_0_0_2px_var(--ds-surface)]';

function ChipButton({ chip, tabbable, onToggle, onFocus, onKeyDown, register }: {
  chip: FilterChip;
  tabbable: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  register: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = chip.icon;
  const count = countText(chip.count);
  const [word, clipped] = useClipped<HTMLSpanElement>();
  const flag = chip.flag;
  return (
    <button
      ref={register}
      type="button"
      aria-pressed={!!chip.active}
      tabIndex={tabbable ? 0 : -1}
      disabled={chip.disabled}
      title={chip.title ?? (clipped || flag ? chipText(chip) : undefined)}
      onClick={onToggle}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={clsx(CHIP, chip.active ? ON : OFF)}
    >
      {flag && flag.text == null && <span aria-hidden className={clsx('h-[8px] w-[8px] shrink-0 rounded-full', DOT[flag.tone], EDGE)} />}
      {Icon && <Icon aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />}
      <span ref={word} className="min-w-0 truncate">{chip.label}</span>
      {count && <span className={clsx('shrink-0 tabular-nums', chip.active ? 'text-ds-on-primary' : 'text-ds-fg-muted')}>{count}</span>}
      {flag && flag.text != null && <span aria-hidden className={clsx('inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-[5px] text-ds-label tabular-nums text-ds-on-primary', BADGE[flag.tone], EDGE)}>{flag.text}</span>}
      {flag && <span className="sr-only">{`, ${flag.label}`}</span>}
    </button>
  );
}

export function FilterChips({ chips, onToggle, label, overflow = 'wrap', maxVisible, className }: FilterChipsProps) {
  const { row, more } = splitChips(chips, maxVisible);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focused, setFocused] = useState<string | null>(null);
  const stop = chipStop(row, focused);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = nextChip(row, key, e.key);
    if (to === null) return;
    e.preventDefault();
    buttons.current.get(to)?.focus();
  };

  if (row.length === 0) return null;                                                      // nothing to filter by: no empty toolbar

  const trigger = moreText(more);
  const menu = more.length > 0 && (
    <Menu
      label={trigger.text}
      size="sm"
      className={clsx('!rounded-full', trigger.on > 0 && '!border-ds-primary !bg-ds-primary-soft !text-ds-primary-text')}
      items={moreItems(more).map((item) => ({ ...item, onSelect: () => onToggle(item.key) }))}
    />
  );
  const items = row.map((chip) => (
    <ChipButton
      key={chip.key}
      chip={chip}
      tabbable={chip.key === stop}
      onToggle={() => onToggle(chip.key)}
      onFocus={() => setFocused(chip.key)}
      onKeyDown={(e) => onKeyDown(e, chip.key)}
      register={(el) => { if (el) buttons.current.set(chip.key, el); else buttons.current.delete(chip.key); }}
    />
  ));

  if (overflow === 'scroll') {
    return (
      <div className={clsx('flex min-w-0 items-center gap-[6px]', className)}>
        <div role="toolbar" aria-label={label} className="-m-[4px] flex min-w-0 flex-1 items-center gap-[6px] overflow-x-auto p-[4px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{items}</div>
        {menu}
      </div>
    );
  }
  return <div role="toolbar" aria-label={label} className={clsx('flex min-w-0 flex-wrap items-center gap-[6px]', className)}>{items}{menu}</div>;
}
