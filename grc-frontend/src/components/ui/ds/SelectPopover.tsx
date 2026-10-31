'use client';

// The engine MultiSelect and Combobox share: a button that opens a list of options in a popover, with an optional search box. Not exported from the kit
// (use MultiSelect or Combobox); written once so the two cannot drift apart.
//
// The popover is drawn in a PORTAL on document.body, fixed to the button, like the kit's Menu: a table's scroller, a card's overflow or a dialog whose panel
// is transformed (which makes `position: fixed` relative to the panel) cannot clip it. React events still bubble from a portal to the components around
// it, so a press or a key in the popover is stopped before it reaches a clickable row or a dialog the select sits in.
//
// Keys. On the button: ArrowDown, ArrowUp, Enter and Space open it. In the popover, focus is in the search box (when there is one) or on the list itself,
// and the active option is named by aria-activedescendant: ArrowDown / ArrowUp move it (wrapping, skipping a disabled option), Home and End go to the ends
// (on the list; in the search box they move the caret), Enter chooses the active option (a multiple select stays open, a single one closes), Space too
// when it is not being typed into a search box, a letter jumps to the next option that starts with it (type-ahead, on the list), Ctrl+A chooses all
// that are shown (multiple), Escape closes it and gives focus back to the button without a dialog around it hearing it, and Tab / Shift+Tab move between
// the search box, the list and the footer buttons and, at an end, close it and carry on from the button. The rules are listboxModel.ts (tested).
//
// A search keeps the options that hold every word, with the Documents library's fold. Touch: the search box is not focused when the popover opens (the
// on-screen keyboard would cover the list). The popover follows the button when the page scrolls or the window resizes. Tokens and arbitrary values only.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Check, ChevronDown, Search } from 'lucide-react';
import { placeMenu, type Placement } from '@/lib/menuModel';
import { scrollDelta } from '@/lib/tabsModel';
import { TABBABLE, nextFocusIndex, visibleOnly } from '../dialogFocus';
import { Button } from './Button';
import { useFieldControl } from './FormField';
import { fieldClasses } from './fieldStyles';
import {
  filterOptions, initialActive, isTyping, moveActive, selectAll, selectNone, summaryOf, toggleValue, typeAhead, typeAheadIndex,
  type ListOption, type SelectDisplay, type TypeBuffer,
} from './listboxModel';

/** More options than this and the list gets a search box, unless the page says otherwise. */
export const SEARCH_FROM = 8;
/** A multiple select with at least this many options has "Select all" and "Clear". */
export const SELECT_ALL_FROM = 4;
const MAX_HEIGHT = 360;

export interface SelectBaseProps {
  /** the control's name: "Status". It names the button for a screen reader and the list, and is drawn before the choice when `showLabel` */
  label: string;
  /** what can be chosen */
  options: readonly ListOption[];
  /** what the button says while nothing is chosen ("All statuses") */
  placeholder?: string;
  /** a search box above the options; the default is yes when there are more than 8 options */
  searchable?: boolean;
  /** what the empty search box says (default "Search") */
  searchPlaceholder?: string;
  /** what the list says when a search leaves no option (default "No matches") */
  emptyText?: string;
  /** draw the name before the choice ("Status: Draft"): for a filter bar that has no FormField label */
  showLabel?: boolean;
  /** shown, cannot be opened */
  disabled?: boolean;
  /** a red outline (a FormField with an error does this by itself) */
  invalid?: boolean;
  /** the button's id, when the page needs a fixed one (a FormField gives it one) */
  id?: string;
  /** layout only (width, margin) */
  className?: string;
}

export interface SelectEngineProps extends SelectBaseProps {
  multiple: boolean;
  selected: readonly string[];
  /** the whole choice after the change */
  onChoose: (next: string[]) => void;
  display?: SelectDisplay;
  /** a single select: choosing the chosen option again clears it */
  clearable?: boolean;
}

const TRIGGER = '!flex h-ds-control items-center gap-[8px] pl-[12px] pr-[10px] text-left enabled:hover:bg-ds-surface-hover';
const ROW = 'flex min-h-ds-control cursor-pointer items-center gap-[10px] px-[12px] py-[6px] text-ds-body text-ds-fg-body';
const RING = 'shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const CHIP = 'max-w-[9rem] truncate rounded-ds-control bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg';

interface PopupProps {
  listId: string;
  label: string;
  anchor: HTMLElement;
  multiple: boolean;
  options: readonly ListOption[];
  selected: readonly string[];
  searchable: boolean;
  searchPlaceholder: string;
  emptyText: string;
  query: string;
  onQuery: (query: string) => void;
  active: number;
  onActive: (index: number) => void;
  /** it was opened from the keyboard: the active option shows its ring from the start */
  byKeys: boolean;
  onChoose: (option: ListOption) => void;
  onSelectAll: (shown: readonly ListOption[]) => void;
  onClear: (shown: readonly ListOption[]) => void;
  onClose: (refocus: boolean) => void;
}

function Popup({ listId, label, anchor, multiple, options, selected, searchable, searchPlaceholder, emptyText, query, onQuery, active, onActive, byKeys, onChoose, onSelectAll, onClear, onClose }: PopupProps) {
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const typed = useRef<TypeBuffer | null>(null);
  const [at, setAt] = useState<Placement | null>(null);
  const [viaKeys, setViaKeys] = useState(byKeys);             // the ring on the active option is for the keyboard; the pointer has its hover tint
  const visible = useMemo(() => filterOptions(options, query), [options, query]);
  const width = Math.min(Math.max(anchor.getBoundingClientRect().width, 240), window.innerWidth - 16);
  const activeOption = active >= 0 ? visible[active] : undefined;
  const optionId = (i: number) => `${listId}-option-${i}`;
  const activeId = activeOption ? optionId(active) : undefined;

  const place = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const size = el.getBoundingClientRect();
    setAt((previous) => {
      const next = placeMenu(anchor.getBoundingClientRect(), { width: size.width, height: size.height }, { width: window.innerWidth, height: window.innerHeight }, 'start');
      return previous && previous.top === next.top && previous.left === next.left && previous.maxHeight === next.maxHeight ? previous : next;
    });
  }, [anchor]);

  // Before the first paint: measure the popover where it is (invisible, top left), move it next to the button, and put focus in it. On a touch screen the
  // search box is left alone (the on-screen keyboard would cover the list): the list takes focus.
  useLayoutEffect(() => {
    place();
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    (searchable && !touch ? input.current : list.current ?? box.current)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placed and focused once, when it opens
  }, []);

  // A press anywhere else closes it. The page scrolling or the window resizing moves the button, so the popover follows it (a soft keyboard that shrinks
  // the window must not close the list that is being typed in).
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !anchor.contains(target)) onClose(false);
    };
    const moved = () => place();
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, [anchor, onClose, place]);

  // the active option stays in view, scrolling the list only (never the page)
  useEffect(() => {
    const row = active >= 0 ? (list.current?.children[active] as HTMLElement | undefined) : undefined;
    if (!list.current || !row) return;
    const l = list.current.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const by = scrollDelta({ start: l.top, end: l.bottom }, { start: r.top, end: r.bottom }, 0);
    if (by !== 0) list.current.scrollTop += by;
  }, [active, visible]);

  // a footer button that has just disabled itself (Clear with nothing left to clear) must not take focus, and the keys, with it
  const refocus = () => requestAnimationFrame(() => (searchable ? input.current : list.current)?.focus({ preventScroll: true }));
  const canAll = visible.some((o) => !o.disabled && !selected.includes(o.value));
  const canClear = visible.some((o) => !o.disabled && selected.includes(o.value));

  const onTab = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el) return;
    const stops = visibleOnly(el.querySelectorAll<HTMLElement>(TABBABLE));
    const to = stops.length === 0 ? 0 : nextFocusIndex(stops.length, stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (to !== null) onClose(true);                           // at an end: focus is on the button before the browser moves it on
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const inSearch = e.target === input.current;
    const key = e.key;
    if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    if (key === 'Tab') { onTab(e); return; }
    if ((e.target as HTMLElement).closest('button')) { if (key === 'Enter' || key === ' ') e.stopPropagation(); return; }       // the footer buttons act on their own click
    if (e.altKey || e.metaKey) return;
    if (e.ctrlKey) {
      if (multiple && !inSearch && key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); onSelectAll(visible); }
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || (!inSearch && (key === 'Home' || key === 'End'))) {
      e.preventDefault();
      e.stopPropagation();
      const to = moveActive(visible, active, key);
      if (to !== null && to >= 0) { setViaKeys(true); onActive(to); }
      return;
    }
    const spaceInWord = key === ' ' && isTyping(typed.current, Date.now());                  // "in ap": the Space is part of the word being typed
    if (key === 'Enter' || (key === ' ' && !inSearch && !spaceInWord)) {
      e.preventDefault();
      e.stopPropagation();
      if (activeOption && !activeOption.disabled) onChoose(activeOption);
      return;
    }
    if (!inSearch && key.length === 1) {                      // type-ahead on the list
      e.preventDefault();
      e.stopPropagation();
      typed.current = typeAhead(typed.current, key, Date.now());
      const to = typeAheadIndex(visible, active, typed.current.text);
      if (to >= 0) { setViaKeys(true); onActive(to); }
    }
  };

  return createPortal(
    <div
      ref={box}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input, button')) e.preventDefault(); }}   // a press on an option or the padding keeps focus where it is
      style={{ top: at?.top ?? 0, left: at?.left ?? 0, width, maxHeight: Math.min(at?.maxHeight ?? MAX_HEIGHT, MAX_HEIGHT), opacity: at ? 1 : 0 }}
      className={clsx('fixed z-[70] flex flex-col overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface shadow-ds-pop', !at && 'pointer-events-none')}
    >
      {searchable && (
        <div className="relative shrink-0 border-b border-ds-border p-[8px]">
          <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute left-[20px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-ds-fg-muted" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label={`Search ${label.toLowerCase()}`}
            aria-expanded="true"
            aria-controls={visible.length > 0 ? listId : undefined}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => { setViaKeys(true); onQuery(e.target.value); }}
            className={clsx(fieldClasses(false), 'h-ds-control pl-[32px] pr-[8px]')}
          />
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">{query.trim() ? `${visible.length} ${visible.length === 1 ? 'match' : 'matches'}` : ''}</div>
      {visible.length > 0 ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={searchable ? undefined : activeId}
          tabIndex={searchable ? -1 : 0}
          className="min-h-0 flex-1 overflow-y-auto py-[4px] focus-visible:outline-none"
        >
          {visible.map((option, i) => {
            const chosen = selected.includes(option.value);
            const here = i === active;
            return (
              <div
                key={option.value}
                id={optionId(i)}
                role="option"
                aria-selected={chosen}
                aria-disabled={option.disabled || undefined}
                onMouseMove={() => { if (!here) { setViaKeys(false); onActive(i); } }}
                onClick={() => { if (!option.disabled) onChoose(option); }}
                className={clsx(ROW, here && 'bg-ds-surface-hover', here && viaKeys && RING, option.disabled && 'cursor-not-allowed opacity-50')}
              >
                {multiple && (
                  <span aria-hidden className={clsx('grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[4px] border', chosen ? 'border-ds-primary bg-ds-primary text-ds-on-primary' : 'border-ds-border-control bg-ds-surface')}>
                    {chosen && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={clsx('block truncate', !multiple && chosen && 'font-medium text-ds-fg')}>{option.label}</span>
                  {option.description && <span className="block truncate text-ds-label text-ds-fg-muted">{option.description}</span>}
                </span>
                {!multiple && chosen && <Check aria-hidden strokeWidth={2} className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" />}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-[12px] py-[16px] text-center text-ds-body text-ds-fg-muted">{emptyText}</p>
      )}
      {multiple && options.length >= SELECT_ALL_FROM && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-[8px] border-t border-ds-border px-[12px] py-[6px]">
          <span className="text-ds-label text-ds-fg-muted">{`${selected.length} selected`}</span>
          <span className="flex items-center gap-[4px]">
            <Button size="sm" variant="ghost" disabled={!canAll} onClick={() => { onSelectAll(visible); refocus(); }}>Select all</Button>
            <Button size="sm" variant="ghost" disabled={!canClear} onClick={() => { onClear(visible); refocus(); }}>Clear</Button>
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}

export function SelectEngine({
  label, options, placeholder = 'Select…', searchable, searchPlaceholder = 'Search', emptyText = 'No matches', showLabel = false, disabled = false, invalid = false, id, className,
  multiple, selected, onChoose, display = 'count', clearable = false,
}: SelectEngineProps) {
  const a11y = useFieldControl({ id, invalid });
  const listId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [byKeys, setByKeys] = useState(false);
  const withSearch = searchable ?? options.length > SEARCH_FROM;
  const visible = useMemo(() => filterOptions(options, query), [options, query]);
  const summary = summaryOf(options, selected, display, placeholder);

  const show = (fromKeyboard: boolean) => { setQuery(''); setActive(initialActive(options, selected)); setByKeys(fromKeyboard); setOpen(true); };
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }, []);

  // a new search puts the active option on the first match that can be chosen
  const search = (next: string) => { setQuery(next); setActive(filterOptions(options, next).findIndex((o) => !o.disabled)); };

  const choose = (option: ListOption) => {
    if (option.disabled) return;
    if (multiple) { onChoose(toggleValue(selected, option.value)); return; }
    if (selected[0] === option.value) { if (clearable) onChoose([]); close(true); return; }
    onChoose([option.value]);
    close(true);
  };

  return (
    <>
      <button
        ref={trigger}
        id={a11y.id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open && visible.length > 0 ? listId : undefined}
        aria-label={`${label}: ${summary.text}`}
        aria-describedby={a11y['aria-describedby']}
        title={summary.labels.length > 1 ? summary.labels.join(', ') : undefined}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); if (open) close(false); else show(e.detail === 0); }}                      // a click with no pointer (detail 0) is Enter or Space
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (!open) show(true); }
          else if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();           // the click that follows is the button's; a row around it must not also act
        }}
        className={clsx(fieldClasses(a11y['aria-invalid'] === true), TRIGGER, className)}
      >
        {showLabel && <span className="shrink-0 text-ds-fg-muted">{label}:</span>}
        {display === 'chips' && summary.chips.length > 0 ? (
          <span className="flex min-w-0 flex-1 items-center gap-[4px] overflow-hidden">
            {summary.chips.map((chip, i) => <span key={i} className={CHIP}>{chip}</span>)}
            {summary.more > 0 && <span className="shrink-0 text-ds-label text-ds-fg-muted">{`+${summary.more}`}</span>}
          </span>
        ) : (
          <span className={clsx('min-w-0 flex-1 truncate', summary.empty ? 'text-ds-fg-muted' : 'text-ds-fg')}>{summary.text}</span>
        )}
        <ChevronDown aria-hidden strokeWidth={1.75} className={clsx('h-[16px] w-[16px] shrink-0 text-ds-fg-muted', open && 'rotate-180')} />
      </button>
      {open && trigger.current && (
        <Popup
          listId={listId}
          label={label}
          anchor={trigger.current}
          multiple={multiple}
          options={options}
          selected={selected}
          searchable={withSearch}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          query={query}
          onQuery={search}
          active={active}
          onActive={setActive}
          byKeys={byKeys}
          onChoose={choose}
          onSelectAll={(shown) => onChoose(selectAll(shown, selected))}
          onClear={(shown) => onChoose(selectNone(shown, selected))}
          onClose={close}
        />
      )}
    </>
  );
}
