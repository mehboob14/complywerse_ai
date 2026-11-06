'use client';

// The application shell's menu. By window width (shellMode.ts):
//   >= 1024  the icon rail (components/shell/ModuleIconRail.tsx): modules as icons over short names, Needs my action first, Administration at the foot. A module's pages are
//            in the Work and context panel (components/shell/WorkPanel.tsx), so there is no tree here.
//   <  1024  no rail in the page; the menu is this off-canvas drawer, opened from the menu button in the top bar (Header.tsx). A phone has no room for the panel's module list,
//            so the drawer keeps the full tree and a module opens in place (A's phone menu), with Comply Agent and the Guide, which the phone's top bar has no room for, as its first rows.
// The menu's entries and who sees them are navAccess.ts (read once by components/shell/ShellProvider.tsx); the one lit entry is navActive.ts; the tree is NavTree.tsx.
import Link from 'next/link';
import { Sparkles, HelpCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { focusIsElsewhere } from '@/components/ui/dialogFocus';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { lockBodyScroll } from '@/components/ui/scrollLock';
import { useGuide } from '@/components/guide';
import ModuleIconRail from '@/components/shell/ModuleIconRail';
import { mayAskComplyAgent, visibleLeafHrefs } from '@/components/shell/shellAccess';
import { useShell, useShellAccess, useShellQueue } from '@/components/shell/ShellProvider';
import { useShellRoute } from '@/components/shell/useShellRoute';
import { type NavEntry } from './navAccess';
import { MAIN_MENU_ID, useShellMenu } from './ShellMenu';
import { ADMIN_GROUP, FOCUS, FullTree, NavGroupSection, type EntryBadge } from './NavTree';

function Brand() {
  return (
    <span className="whitespace-nowrap text-base font-semibold text-[var(--color-text)] flex items-baseline gap-0.5">
      Compliverse
      <span className="ml-1 text-xs font-medium text-[var(--color-base)] opacity-70">AI</span>
    </span>
  );
}

const ICON_BUTTON = 'flex items-center justify-center rounded-lg text-[var(--sidebar-icon)] transition-colors duration-150 hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]';
const ROW = 'group flex min-h-ds-control w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-normal text-[var(--sidebar-text)] transition-colors duration-150 hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]';

/** The off-canvas menu: a modal drawer over the page (focus moves in and is kept in, Escape or a press on the dim area closes it and focus
 *  goes back to the button that opened it, the page behind does not scroll). Following a link closes it (Sidebar). */
function MenuDrawer({ open, onClose, nav, activeHref, isAdmin, tenant, canAsk, badges }: {
  open: boolean; onClose: () => void; nav: NavEntry[]; activeHref: string | undefined; isAdmin: boolean; tenant: string; canAsk: boolean; badges: Record<string, EntryBadge | undefined>;
}) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const guide = useGuide();
  useDialogFocus(open, drawerRef, render);

  // mounted a frame before it slides in and kept until it has slid out (the same state machine as AnimatedModal)
  useEffect(() => {
    if (open) {
      setRender(true);
      const frame = requestAnimationFrame(() => setShow(true));
      return () => cancelAnimationFrame(frame);
    }
    setShow(false);
    const t = setTimeout(() => setRender(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => (render ? lockBodyScroll() : undefined), [render]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (drawerRef.current && focusIsElsewhere(drawerRef.current, document.activeElement, document.body)) return;   // a dialog over the menu: Escape is its
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className={clsx('fixed inset-0 z-[55] flex transition-opacity duration-200', show ? 'opacity-100' : 'opacity-0')}>
      <div className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <aside
        ref={drawerRef}
        id={MAIN_MENU_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        tabIndex={-1}
        className={clsx(
          'relative flex h-full w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-sidebar transition-transform duration-200 ease-out focus:outline-none',
          show ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex min-h-14 flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--sidebar-hover-bg)] px-4 py-2">
          <div className="min-w-0">
            <Brand />
            {/* a tenant name can be long: two lines, the whole name as its tooltip */}
            {tenant && <p title={tenant} className="mt-[2px] line-clamp-2 break-words text-[12px] font-normal leading-[16px] text-[var(--color-text-muted)]">{tenant}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className={clsx(ICON_BUTTON, FOCUS, 'min-h-ds-control min-w-[var(--ds-control-h)] shrink-0')}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <nav
          aria-label="Primary"
          // a focused row is brought into view: Tab wrapping to the far end of a menu longer than the screen would leave it out of sight
          onFocusCapture={(e) => (e.target as HTMLElement).scrollIntoView?.({ block: 'nearest' })}
          className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin px-2.5 py-3 space-y-1"
        >
          {/* what a phone's top bar has no room for */}
          {canAsk && (
            <Link href="/complychat" onClick={onClose} className={clsx(ROW, FOCUS)}>
              <Sparkles size={18} strokeWidth={1.75} className="flex-shrink-0 text-[var(--sidebar-icon)]" aria-hidden />
              <span className="leading-tight">Ask Comply Agent</span>
            </Link>
          )}
          <button type="button" onClick={guide.toggle} aria-pressed={guide.enabled} className={clsx(ROW, FOCUS)}>
            <HelpCircle size={18} strokeWidth={1.75} className="flex-shrink-0 text-[var(--sidebar-icon)]" aria-hidden />
            <span className="leading-tight">Guide markers</span>
            <span className="ml-auto text-[12px] text-[var(--color-text-muted)]">{guide.enabled ? 'On' : 'Off'}</span>
          </button>
          <FullTree entries={nav} activeHref={activeHref} animated={false} touch onNavigate={onClose} badges={badges} />
          {isAdmin && (
            <div className="border-t border-[var(--sidebar-hover-bg)] pt-2">
              <NavGroupSection group={ADMIN_GROUP} activeHref={undefined} animated={false} touch onNavigate={onClose} />
            </div>
          )}
        </nav>
      </aside>
    </div>
  );
}

export default function Sidebar() {
  const { pathname, from, litHref } = useShellRoute();
  const { mode } = useShell();
  const { open: menuOpen, setOpen: setMenuOpen } = useShellMenu();
  const { me, access, nav, loaded } = useShellAccess();
  const queue = useShellQueue();

  const closeMenu = useCallback(() => setMenuOpen(false), [setMenuOpen]);
  useEffect(() => { closeMenu(); }, [pathname, closeMenu]);                       // a page was opened: the drawer is done
  useEffect(() => { if (mode !== 'drawer') closeMenu(); }, [mode, closeMenu]);    // the window grew until the rail fits: no drawer

  const badges: Record<string, EntryBadge | undefined> = { '/needs-my-action': { text: queue.text, label: queue.label, urgent: queue.urgent } };

  return (
    <>
      <ModuleIconRail pathname={pathname} from={from} />
      {mode === 'drawer' && (
        <MenuDrawer
          open={menuOpen}
          onClose={closeMenu}
          nav={loaded ? nav : []}
          activeHref={litHref}
          isAdmin={loaded && access.isAdmin}
          tenant={me?.user?.primary_tenant_name || ''}
          canAsk={loaded && mayAskComplyAgent(access, visibleLeafHrefs(nav))}
          badges={badges}
        />
      )}
    </>
  );
}
