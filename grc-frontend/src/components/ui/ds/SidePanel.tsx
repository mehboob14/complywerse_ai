'use client';

// SidePanel: one panel, three modes chosen by the window width (sidePanelModel.ts, usePanelMode.ts).
//   docked   a column beside the content from `dockFrom` (default 1440): put it as the last child of a flex row whose other child is the content with
//            `min-w-0 flex-1`; the content shrinks, nothing is covered, nothing is trapped, the page keeps scrolling and Tab flows through it
//   overlay  from 640 px up to the dock width: over the content with a scrim, `role="dialog"` `aria-modal`, Tab wrapped inside, the page's scroll locked,
//            and focus back on what opened it (the existing useDialogFocus and lockBodyScroll of AnimatedModal and RightSlidePanel, not a copy)
//   sheet    under 640 px: the same dialog as a bottom sheet
// `dockFrom={Infinity}` never docks (a drawer over a list); `mode` forces a mode (a style-guide specimen, a panel that is always a sheet).
// The sheet is as wide as the window up to 640 px, then centred at 640 px (a forced bottom sheet on a desktop does not span the screen).
// One Escape closes one layer: the panel takes it only when nothing in it handled it and focus is not in a menu or a dialog drawn over it
// (overlayTakesEscape). A docked column takes Escape only with `escapeClosesDocked`, and only while focus is inside it.
// `dirty` asks "Discard changes?" before the X, Escape or the scrim throw typed input away (the same DiscardBar and useDiscardGuard, in every mode).
// The window width decides the mode, not the width of the box the panel sits in; switching mode while it is open (a resize across 640 or the dock
// width) draws the content again, so keep what matters in the page's state. Tokens and arbitrary values only (kit rules).
//
//   <SidePanel open={!!openId} onClose={() => setOpenId(null)} title="Work and context" dockFrom={1440} width="sm" padded={false}>…</SidePanel>
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { focusIsElsewhere, overlayTakesEscape } from '../dialogFocus';
import { useDialogFocus } from '../useDialogFocus';
import { lockBodyScroll } from '../scrollLock';
import { IconButton } from './Button';
import { DiscardBar, useDiscardGuard } from './DiscardBar';
import {
  DOCK_FROM, PANEL_WIDTH, focusAfterClose, panelTakesEscape, resolveFocusTarget,
  type FocusTarget, type PanelMode, type PanelWidth,
} from './sidePanelModel';
import { usePanelMode } from './usePanelMode';

export interface SidePanelProps {
  open: boolean;
  /** Close was asked for and nothing is left to lose (the X, Escape, the scrim, or Discard on the "Discard changes?" bar). */
  onClose: () => void;
  /** The panel's name: its heading, and what names the dialog or the complementary region for a screen reader. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Controls in the header, before the close button (a Menu, previous and next). */
  actions?: ReactNode;
  children: ReactNode;
  /** A row of buttons under the body ("Show 12 documents"). It stays in view while the body scrolls. */
  footer?: ReactNode;
  /** The window width from which the panel docks as a column. `Infinity` never docks. Under 640 px it is a sheet whatever this says. */
  dockFrom?: number;
  /** sm 360 px, md 480 px, lg 640 px: the width of the docked column and of the overlay. The sheet is as wide as the window. */
  width?: PanelWidth;
  /** Force a mode instead of following the window width. */
  mode?: PanelMode;
  /** Padding around the body (default on). Turn it off for a body made of lists that run edge to edge. */
  padded?: boolean;
  /** The caller holds typed input: the X, Escape and the scrim ask first. */
  dirty?: boolean;
  discardLabel?: string;
  keepLabel?: string;
  /** False: a press on the scrim does nothing, not even ask. */
  closeOnBackdrop?: boolean;
  /** What takes focus when the panel opens: a CSS selector inside it, or a ref. Default: the first field, else the first button. A docked column takes no focus unless this is given. */
  initialFocus?: string | RefObject<HTMLElement>;
  /** Where focus goes when the panel closes, if focus is lost with it: a ref, or a function that finds the element then (the row the panel was opened from, drawn again since). Default: what opened the panel. */
  restoreFocus?: FocusTarget;
  /** Docked only: Escape pressed inside the column closes it. An overlay and a sheet always close on Escape. */
  escapeClosesDocked?: boolean;
  /** The close button's name (default "Close panel"). */
  closeLabel?: string;
  /** Layout only (a margin on the docked column). */
  className?: string;
}

/** Remember what had focus when the panel opened; when it closes with focus lost, give it back to `restore`, else to that element. */
function useRestoreFocus(open: boolean, restore: FocusTarget | undefined) {
  const opener = useRef<Element | null>(null);
  const named = useRef(restore);
  named.current = restore;
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    return () => {
      const here = document.activeElement;
      const lost = !here || here === document.body;
      const from = opener.current instanceof HTMLElement && opener.current !== document.body ? opener.current : null;
      focusAfterClose({ lost, named: resolveFocusTarget(named.current), opener: from })?.focus({ preventScroll: true });
    };
  }, [open]);
}

/** Mark the element that takes focus (useDialogFocus honours data-autofocus when it moves focus in); a docked column is not a dialog, so it is focused here. */
function useInitialFocus(open: boolean, panel: RefObject<HTMLElement>, initial: SidePanelProps['initialFocus'], docked: boolean) {
  useEffect(() => {
    if (!open || !initial) return;
    const el = typeof initial === 'string' ? panel.current?.querySelector<HTMLElement>(initial) : initial.current;
    if (!el) return;
    if (docked) el.focus({ preventScroll: true });
    else el.setAttribute('data-autofocus', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when it opens or the mode changes
  }, [open, docked]);
}

export function SidePanel({
  open, onClose, title, subtitle, actions, children, footer,
  dockFrom = DOCK_FROM, width = 'md', mode: forced, padded = true,
  dirty = false, discardLabel = 'Discard', keepLabel = 'Keep editing', closeOnBackdrop = true,
  initialFocus, restoreFocus, escapeClosesDocked = false, closeLabel = 'Close panel', className,
}: SidePanelProps) {
  const byWidth = usePanelMode(dockFrom);
  const mode = forced ?? byWidth;
  const docked = mode === 'docked';
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  const { asking, requestClose, keep, discard } = useDiscardGuard({ open, dirty, closeOnBackdrop, onClose, dialogRef: panelRef });

  // declared before useDialogFocus on purpose: this one remembers the opener first, and marks the element that takes focus before focus moves in
  useRestoreFocus(open, restoreFocus);
  useInitialFocus(open, panelRef, initialFocus, docked);
  useDialogFocus(open && !docked, panelRef);
  useEffect(() => (open && !docked ? lockBodyScroll() : undefined), [open, docked]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      const inside = !!panel && panel.contains(document.activeElement);
      const elsewhere = panel ? focusIsElsewhere(panel, document.activeElement, document.body) : false;
      if (!overlayTakesEscape({ key: e.key, defaultPrevented: e.defaultPrevented, focusElsewhere: elsewhere })) return;
      if (!panelTakesEscape({ mode, escapeClosesDocked, focusInside: inside })) return;
      e.preventDefault();                 // taken: a layer under this one, whose listener may run after this one, must not take it too
      requestClose('escape');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, mode, escapeClosesDocked, requestClose]);

  if (!open) return null;

  const content = (
    <>
      <div className="flex shrink-0 items-start gap-[8px] border-b border-ds-border px-[16px] py-[12px]">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="break-words !text-ds-section !text-ds-fg">{title}</h2>
          {subtitle && <div id={subtitleId} className="mt-[2px] break-words text-ds-label font-normal text-ds-fg-muted">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-[4px]">
          {actions}
          <IconButton label={closeLabel} onClick={() => requestClose('close-button')}><X aria-hidden /></IconButton>
        </div>
      </div>
      {asking && <DiscardBar keepLabel={keepLabel} discardLabel={discardLabel} onKeep={keep} onDiscard={discard} />}
      <div className={clsx('min-h-0 flex-1 overflow-y-auto overscroll-contain', padded && 'p-[16px]')}>{children}</div>
      {footer && <div className={clsx('shrink-0 border-t border-ds-border bg-ds-surface px-[16px] py-[12px]', mode === 'sheet' && 'pb-[max(12px,env(safe-area-inset-bottom))]')}>{footer}</div>}
    </>
  );

  if (docked) {
    return (
      <aside
        ref={panelRef}
        data-side-panel="docked"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        style={{ width: PANEL_WIDTH[width] }}
        className={clsx('flex min-h-0 shrink-0 flex-col self-stretch border-l border-ds-border bg-ds-surface', className)}
      >
        {content}
      </aside>
    );
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div data-side-panel={mode} className="fixed inset-0 z-50">
      <div aria-hidden className="absolute inset-0 bg-ds-scrim" onClick={() => requestClose('backdrop')} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        style={mode === 'overlay' ? { width: PANEL_WIDTH[width] } : undefined}
        className={clsx(
          'absolute flex flex-col bg-ds-surface shadow-ds-pop focus-visible:outline-none',
          mode === 'overlay'
            ? 'inset-y-0 right-0 max-w-full'
            : 'inset-x-0 bottom-0 mx-auto w-full max-w-[640px] max-h-[85vh] rounded-t-[12px] supports-[height:1dvh]:max-h-[85dvh]',
        )}
      >
        {content}
      </div>
    </div>,
    document.body,
  );
}
