'use client';

// A small dropdown menu: a button that opens a short list of actions, for a table row ("⋯") or a page's "Actions".
//
// The list is drawn in a PORTAL on document.body, fixed to the button (position: fixed + getBoundingClientRect, kept inside the window, opening
// upwards when there is more room above). That is needed, not decoration: the menus of rows sit in tables inside `overflow-x-auto` scrollers
// that would clip an absolutely positioned list, and inside dialogs and drawers whose panel is transformed (animated), which makes
// `position: fixed` relative to the panel instead of the window. The cost is that React events still bubble from a portal to the components
// around it, so the list and the button stop clicks and Enter / Space from reaching a clickable row they sit in.
//
// Keyboard: Enter, Space, ArrowDown open it on the first item, ArrowUp on the last; ArrowUp / ArrowDown / Home / End move (disabled items are
// skipped, lib/menuModel.ts); Escape closes it and returns focus to the button (and, with preventDefault, is not also taken by a dialog around
// it); Tab closes it and carries on from the button; a click outside, scrolling or resizing closes it. Choosing an item closes the menu and puts
// focus back on the button first, then runs `onSelect`, so a dialog it opens returns focus to the button when it closes.
import { Fragment, forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react';
import { indexForKey, nextIndex, placeMenu, type Placement } from '@/lib/menuModel';

export interface MenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** the destructive step: red, and set off by a line above it */
  danger?: boolean;
  /** shown but cannot be chosen; the arrow keys skip it */
  disabled?: boolean;
  /** not shown at all (a menu with nothing to show renders nothing) */
  hidden?: boolean;
}

export interface MenuProps {
  /** What the button is called for a screen reader, and its text unless `iconOnly`: "Actions", or "Actions for Acme Ltd" on a row. */
  label: string;
  items: MenuItem[];
  /** A ⋯ button with no text (row actions), instead of a labelled button with a chevron. */
  iconOnly?: boolean;
  /** Which edge of the button the list lines up with; default 'end' (the right edge). Either way it is kept inside the window. */
  align?: 'start' | 'end';
  disabled?: boolean;
  /** layout only (margin) */
  className?: string;
}

const TRIGGER = 'inline-flex h-ds-control shrink-0 items-center justify-center rounded-ds-control text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-not-allowed disabled:opacity-50';
const TRIGGER_ICON = `${TRIGGER} aspect-square text-ds-fg-muted enabled:hover:bg-ds-surface-hover enabled:hover:text-ds-fg`;
const TRIGGER_TEXT = `${TRIGGER} gap-[6px] border border-ds-border-strong px-[12px] text-ds-fg-body enabled:hover:bg-ds-surface-hover`;
// the ring is inset: the list scrolls and clips, which would cut off an outer one
const ITEM = 'flex min-h-ds-control w-full items-center gap-[10px] px-[12px] py-[6px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-not-allowed disabled:opacity-50';
const ITEM_NORMAL = 'text-ds-fg-body enabled:hover:bg-ds-surface-hover focus-visible:bg-ds-surface-hover';
const ITEM_DANGER = 'text-ds-danger enabled:hover:bg-ds-danger-soft focus-visible:bg-ds-danger-soft';

type Start = 'first' | 'last';

function Popup({ id, label, items, anchor, align, start, onClose, onPick }: {
  id: string;
  label: string;
  items: MenuItem[];
  anchor: HTMLElement;
  align: 'start' | 'end';
  start: Start;
  onClose: (refocus: boolean) => void;
  onPick: (item: MenuItem) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Placement | null>(null);
  const rows = () => Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Before the first paint: measure the list where it is (invisible, top left), move it next to the button, and put focus in it.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = el.getBoundingClientRect();
    setAt(placeMenu(anchor.getBoundingClientRect(), size, { width: window.innerWidth, height: window.innerHeight }, align));
    const first = start === 'last' ? nextIndex(items, items.length, -1) : nextIndex(items, -1, 1);
    (first >= 0 ? rows()[first] : el).focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placed and focused once, when it opens
  }, []);

  // Closed by a press anywhere else, by the page scrolling (the button moved away) and by the window resizing. Scrolling the list itself is its own.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !anchor.contains(target)) onClose(false);
    };
    const scrolled = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(false); };
    const resized = () => onClose(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
    };
  }, [anchor, onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    if (e.key === 'Tab') { onClose(true); return; }                                  // focus is on the button before the browser moves it on
    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; }         // the item's own click runs; a row around the menu must not also act
    const list = rows();
    const to = indexForKey(items, list.indexOf(document.activeElement as HTMLElement), e.key);
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (to >= 0) list[to].focus();
  };

  return createPortal(
    <div
      ref={box}
      id={id}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      style={{ top: at?.top ?? 0, left: at?.left ?? 0, maxHeight: at?.maxHeight, opacity: at ? 1 : 0 }}
      className={clsx('fixed z-[70] w-max min-w-[200px] max-w-[calc(100vw_-_16px)] overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface py-1 shadow-ds-pop focus-visible:outline-none', !at && 'pointer-events-none')}
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <Fragment key={item.key}>
            {item.danger && i > 0 && !items[i - 1].danger && <div role="separator" className="my-1 h-px bg-ds-border" />}
            <button type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} onClick={() => onPick(item)} className={clsx(ITEM, item.danger ? ITEM_DANGER : ITEM_NORMAL)}>
              {Icon && <Icon aria-hidden className="h-[16px] w-[16px] shrink-0" strokeWidth={1.75} />}
              <span className="min-w-0">{item.label}</span>
            </button>
          </Fragment>
        );
      })}
    </div>,
    document.body,
  );
}

export const Menu = forwardRef<HTMLButtonElement, MenuProps>(function Menu({ label, items, iconOnly = false, align = 'end', disabled = false, className }, ref) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<Start | null>(null);                                 // null: shut; else which item focus starts on
  const shown = items.filter((i) => !i.hidden);

  const close = useCallback((refocus: boolean) => {
    setOpen(null);
    if (refocus) trigger.current?.focus();
  }, []);
  const pick = useCallback((item: MenuItem) => {
    close(true);
    item.onSelect();
  }, [close]);

  if (shown.length === 0) return null;
  return (
    <>
      <button
        ref={(el) => { trigger.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; }}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open !== null ? id : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen(open === null ? 'first' : null); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setOpen(e.key === 'ArrowUp' ? 'last' : 'first'); }
          else if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();           // the click that follows is the button's; a row around it must not also act
        }}
        className={clsx(iconOnly ? TRIGGER_ICON : TRIGGER_TEXT, open !== null ? 'bg-ds-surface-hover' : !iconOnly && 'bg-ds-surface', className)}
      >
        {iconOnly ? <MoreHorizontal aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} /> : <>{label}<ChevronDown aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} /></>}
      </button>
      {open !== null && trigger.current && (
        <Popup id={id} label={label} items={shown} anchor={trigger.current} align={align} start={open} onClose={close} onPick={pick} />
      )}
    </>
  );
});
