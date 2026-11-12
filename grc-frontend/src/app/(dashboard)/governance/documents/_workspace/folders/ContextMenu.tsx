'use client';

// The right-click menu of a unit: the kit's Menu items (the same list as a row's "⋯"), drawn at the pointer. The kit's Menu opens from its own button, so this is the small
// version for a point: a portal on the window (a card or a scrolling frame cannot clip it), kept inside the window (lib/menuModel placeMenu), the arrow keys, Home and End
// move (a disabled item with a reason stays reachable, so its reason can be read), Escape and Tab close it and give focus back to what was right-clicked, and a press elsewhere,
// scrolling or resizing close it. Choosing an item closes the menu first, then runs it (so a dialog it opens returns focus to the unit).
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import type { MenuItem } from '@/components/ui/ds';
import { indexForKey, isBlocked, navEntries, nextIndex, placeMenu, type Placement } from '@/lib/menuModel';

const ITEM = 'flex min-h-ds-control w-full items-center gap-[10px] px-[12px] py-[6px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed';

export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: MenuItem[]; onClose: (refocus: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Placement | null>(null);
  const shown = items.filter((i) => !i.hidden);
  const reach = navEntries(shown);
  const rows = () => Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = el.getBoundingClientRect();
    setAt(placeMenu({ top: y, left: x, right: x, bottom: y }, size, { width: window.innerWidth, height: window.innerHeight }, 'start', 0));
    const first = nextIndex(reach, -1, 1);
    (first >= 0 ? rows()[first] : el).focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placed and focused once, when it opens
  }, []);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(false); };
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
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); onClose(true); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; }
    const list = rows();
    const to = indexForKey(reach, list.indexOf(document.activeElement as HTMLElement), e.key);
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (to >= 0) list[to].focus();
  };

  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-label={label}
      tabIndex={0}                                                  // a menu that scrolls on a short screen is a focusable region (Tab closes it: onKeyDown)
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ top: at?.top ?? 0, left: at?.left ?? 0, maxHeight: at?.maxHeight, opacity: at ? 1 : 0 }}
      className={clsx('fixed z-[70] w-max min-w-[200px] max-w-[calc(100vw_-_16px)] overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface py-1 shadow-ds-pop focus-visible:outline-none', !at && 'pointer-events-none')}
    >
      {shown.map((it, i) => {
        const Icon = it.icon;
        const blocked = isBlocked(it);
        const reasonId = it.reason ? `ctx-${i}-reason` : undefined;
        const line = !!it.danger && i > 0 && !shown[i - 1].danger;
        return (
          <Fragment key={it.key}>
            {line && <div role="separator" className="my-1 h-px bg-ds-border" />}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={blocked && it.reason ? true : undefined}
              aria-describedby={reasonId}
              disabled={blocked && !it.reason}
              onClick={() => { if (blocked) return; onClose(true); it.onSelect(); }}
              className={clsx(ITEM, it.danger ? 'text-ds-danger enabled:hover:bg-ds-danger-soft focus-visible:bg-ds-danger-soft' : 'text-ds-fg-body enabled:hover:bg-ds-surface-hover focus-visible:bg-ds-surface-hover')}
            >
              {Icon && <Icon aria-hidden className={clsx('h-[16px] w-[16px] shrink-0', blocked && it.reason && 'opacity-50')} strokeWidth={1.75} />}
              <span className="min-w-0 flex-1">
                <span className={clsx('block', blocked && it.reason && 'opacity-50')}>{it.label}</span>
                {it.reason && <span id={reasonId} className="mt-[2px] block text-ds-label font-normal text-ds-fg-muted">{it.reason}</span>}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>,
    document.body,
  );
}
