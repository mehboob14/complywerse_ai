'use client';

// The application shell's menu. By window width (shellMode.ts):
//   >= 1280  the 240px sidebar, or the 64px rail when collapsed (remembered per browser)
//   1024-1279 the 64px rail; the full menu is the off-canvas drawer, opened from the button on the rail
//   < 1024   no sidebar in the page; the drawer, opened from the menu button in the top bar (Header.tsx)
// The menu's entries and who sees them are navAccess.ts; the one lit entry is navActive.ts; the tree is NavTree.tsx.
import { usePathname } from 'next/navigation';
import { ChevronRight, Menu, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { apiClient } from '@/lib/api';
import { focusIsElsewhere } from '@/components/ui/dialogFocus';
import { useDialogFocus } from '@/components/ui/useDialogFocus';
import { lockBodyScroll } from '@/components/ui/scrollLock';
import { NO_ACCESS, navAccessFromMe, navigation, visibleNav, type NavAccess, type NavEntry } from './navAccess';
import { activeNavHref } from './navActive';
import { readCollapsed, writeCollapsed } from './shellMode';
import { useShellMode } from './useShellMode';
import { MAIN_MENU_ID, useShellMenu } from './ShellMenu';
import { ADMIN_GROUP, AdminMenu, FOCUS, FullTree, NavGroupSection, RailTree } from './NavTree';

function Brand() {
  return (
    <span className="whitespace-nowrap text-base font-semibold text-[var(--color-text)] flex items-baseline gap-0.5">
      Compliverse
      <span className="ml-1 text-xs font-medium text-[var(--color-base)] opacity-70">AI</span>
    </span>
  );
}

const ICON_BUTTON = 'flex items-center justify-center rounded-lg text-[var(--sidebar-icon)] transition-colors duration-150 hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]';

/** The off-canvas menu: a modal drawer over the page (focus moves in and is kept in, Escape or a press on the dim area closes it and focus
 *  goes back to the button that opened it, the page behind does not scroll). Following a link closes it (Sidebar). */
function MenuDrawer({ open, onClose, nav, activeHref, isAdmin }: {
  open: boolean; onClose: () => void; nav: NavEntry[]; activeHref: string | undefined; isAdmin: boolean;
}) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
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
        <div className="h-14 flex flex-shrink-0 items-center justify-between border-b border-[var(--sidebar-hover-bg)] px-4">
          <Brand />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className={clsx(ICON_BUTTON, FOCUS, 'min-h-ds-control min-w-[var(--ds-control-h)]')}
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
          <FullTree entries={nav} activeHref={activeHref} animated={false} touch onNavigate={onClose} />
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
  const pathname = usePathname();
  const mode = useShellMode();
  const { open: menuOpen, setOpen: setMenuOpen } = useShellMenu();
  // read at mount: the sidebar is mounted by the dashboard layout after AuthGuard has run in the browser, never on the server
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [access, setAccess] = useState<NavAccess>(NO_ACCESS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadMe = async () => {
      let data: any = null;
      try {
        const res = await apiClient.get('/auth/me');
        data = res.data;
      } catch {
        // Fallback in case axios interceptors/session state cause an edge-case redirect.
        // authedFetch attaches Bearer + X-Tenant-Slug from localStorage so the request
        // works even when Domain=localhost cookies were rejected by the browser.
        try {
          const { authedFetch } = await import('@/lib/auth-fetch');
          const res = await authedFetch('/api/auth/me');
          data = await res.json();
        } catch {
          data = null;
        }
      }

      // an administrator sees every entry; anyone else what their role's permissions open (navAccess.visibleNav)
      setAccess(navAccessFromMe(data));
      setLoaded(true);
    };

    loadMe()
      .catch((error) => {
        console.error('Failed to fetch user data:', error);
        setLoaded(true);
      });
  }, []);

  const filteredNavigation: NavEntry[] = loaded ? visibleNav(navigation, access) : [];
  // ONE entry is lit across the whole menu (navActive.ts)
  const activeHref = activeNavHref(pathname, filteredNavigation);

  const closeMenu = useCallback(() => setMenuOpen(false), [setMenuOpen]);
  useEffect(() => { closeMenu(); }, [pathname, closeMenu]);                    // a page was opened: the drawer is done
  useEffect(() => { if (mode === 'full') closeMenu(); }, [mode, closeMenu]);   // the window grew until the sidebar fits: no drawer

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  };

  // icons only: the rail of a middle-width window, or the sidebar the person collapsed
  const rail = mode === 'rail' || collapsed;

  return (
    <>
      {/* No sidebar in the page below lg. `hidden lg:flex` and the widths say the same as the mode does, so the first paint is right before any script. */}
      {mode !== 'offcanvas' && (
        <aside
          className={clsx(
            'hidden lg:flex flex-col bg-white border-r border-slate-200 shadow-sidebar transition-all duration-300 ease-out',
            collapsed ? 'w-[64px]' : 'w-[64px] xl:w-60'
          )}
        >
          {/* Brand + collapse toggle share one row to save vertical space. On the rail of a middle-width window the button opens the drawer instead. */}
          <div className={clsx(
            'h-14 flex items-center border-b border-[var(--sidebar-hover-bg)] transition-all duration-300',
            rail ? 'justify-center px-2' : 'justify-between px-4'
          )}>
            {!rail && <Brand />}
            {mode === 'rail' ? (
              <button
                type="button"
                onClick={(e) => { e.currentTarget.focus({ preventScroll: true }); setMenuOpen(true); }}
                className={clsx(ICON_BUTTON, FOCUS, 'h-7 w-7')}
                title="Open menu"
                aria-label="Open menu"
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                aria-controls={MAIN_MENU_ID}
              >
                <Menu size={17} strokeWidth={1.75} />
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleCollapsed}
                className={clsx(ICON_BUTTON, FOCUS, 'h-7 w-7')}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <ChevronRight
                  size={17}
                  strokeWidth={1.75}
                  className={clsx('transition-transform duration-300', !collapsed && 'rotate-180')}
                />
              </button>
            )}
          </div>

          {/* Top-aligned nav: items start at the top (no vertical centering). */}
          <nav aria-label="Primary" className="flex-1 overflow-y-auto scrollbar-thin px-2.5 py-3 space-y-1">
            {rail
              ? <RailTree entries={filteredNavigation} activeHref={activeHref} />
              : <FullTree entries={filteredNavigation} activeHref={activeHref} animated />}
          </nav>

          {/* Administration: pinned at the bottom. Administrators only (the old nav entry was adminOnly, and administrators bypass
              module and permission checks), so non-admins see no Administration row at all. */}
          {loaded && access.isAdmin && <AdminMenu collapsed={rail} />}
        </aside>
      )}

      {mode !== 'full' && (
        <MenuDrawer open={menuOpen} onClose={closeMenu} nav={filteredNavigation} activeHref={activeHref} isAdmin={loaded && access.isAdmin} />
      )}
    </>
  );
}
