'use client';

// What the pieces of the shell share, in one provider around them (the dashboard layout):
//  - WHO the person is: /auth/me asked ONCE (the top bar used to ask it, the sidebar asked it again, usePermissions a third time), turned into the menu they have
//    (navAccess.visibleNav) and the one lit entry (navActive). The rail, the drawer, the panel, the palette and the crumbs all read this, so they can never disagree.
//  - Needs my action: the inbox's one hook, asked ONCE here (the rail's count, the top bar's chip, the panel and the palette all read it; its sources keep their own
//    intervals and keys, so nothing else changes). The count rule is the inbox's (lib/inbox/buildInbox).
//  - the shell's UI state: the command palette, the Work and context panel (docked: shut or not, remembered per browser; overlay and sheet: asked or not) and the two
//    shortcuts that reach them (Ctrl/Cmd K, Ctrl/Cmd .).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { NO_ACCESS, navAccessFromMe, navigation, visibleNav, type NavAccess, type NavEntry } from '@/components/layout/navAccess';
import { placementOf, type PanelPlacement, type ShellMode } from '@/components/layout/shellMode';
import { useShellMode } from '@/components/layout/useShellMode';
import { badgeLabel, badgeText } from '@/lib/inbox/buildInbox';
import { useInbox, type UseInbox } from '@/lib/inbox/inboxApi';
import { scopeOf } from './pinnedRecent';
import { panelOpen } from './panelModel';

const DOCK_KEY = 'cw-shell-panel';

/** True when the person shut the docked panel in this browser before. Storage can be missing or throw: then it is open. */
function readDockedShut(): boolean {
  try { return window.localStorage.getItem(DOCK_KEY) === 'closed'; } catch { return false; }
}
function writeDockedShut(shut: boolean): void {
  try { if (shut) window.localStorage.setItem(DOCK_KEY, 'closed'); else window.localStorage.removeItem(DOCK_KEY); } catch { /* not remembered; the panel still closes for this visit */ }
}

/** /auth/me; if the client's own interceptors get in the way, the same request by hand (the sidebar always did this). */
async function loadMe(): Promise<any> {
  try {
    return (await apiClient.get('/auth/me')).data;
  } catch {
    try {
      const { authedFetch } = await import('@/lib/auth-fetch');
      return await (await authedFetch('/api/auth/me')).json();
    } catch {
      return null;
    }
  }
}

interface Access {
  /** /auth/me as the server sent it (null until known, or when it could not be asked) */
  me: any;
  access: NavAccess;
  /** the menu this person has: the rail, the drawer and the panel are drawn from it */
  nav: NavEntry[];
  /** /auth/me has answered (even if it said nobody is signed in) */
  loaded: boolean;
  /** the tenant and the person, for what is kept per browser; null while unknown */
  scope: string | null;
}

/** Needs my action as the shell shows it: the inbox, its count as drawn and as spoken, and whether something is overdue (the count turns red). */
interface Queue extends UseInbox {
  text: string;
  label: string;
  urgent: boolean;
}

interface Ui {
  mode: ShellMode;
  placement: PanelPlacement;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  /** the panel is showing (docked and not shut, or asked for as an overlay or a sheet) */
  panelShown: boolean;
  /** open it, shut it: docked, the person's choice (remembered); overlay and sheet, until it is closed or a page opens */
  setPanel: (shown: boolean) => void;
  togglePanel: () => void;
  /** a number that goes up when something asks the panel to take keyboard focus (Ctrl .); the panel focuses its first row when it sees a new one */
  focusRequest: number;
  requestPanelFocus: () => void;
  /** the panel asks, once, whether it was opened to take focus (Ctrl .): true the first time after a request, then false, so a panel opened by its button never takes focus */
  takeFocusRequest: () => boolean;
  /** the top bar's panel button: where focus goes back to when the panel is closed from the keyboard */
  panelButton: RefObject<HTMLButtonElement>;
}

const AccessCtx = createContext<Access>({ me: null, access: NO_ACCESS, nav: [], loaded: false, scope: null });
const UiCtx = createContext<Ui | null>(null);
const QueueCtx = createContext<Queue | null>(null);

export const useShellAccess = (): Access => useContext(AccessCtx);
export function useShellQueue(): Queue {
  const queue = useContext(QueueCtx);
  if (!queue) throw new Error('useShellQueue needs the ShellProvider');
  return queue;
}
export function useShell(): Ui {
  const ui = useContext(UiCtx);
  if (!ui) throw new Error('useShell needs the ShellProvider');
  return ui;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mode = useShellMode();
  const placement = placementOf(mode);

  // WHO: the same query key and options the top bar always used, so every other reader of ['current-user'] shares the answer
  const { data: me, isPending } = useQuery({
    queryKey: ['current-user'],
    queryFn: loadMe,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: true,
  });
  const access = useMemo(() => navAccessFromMe(me), [me]);
  const nav = useMemo(() => visibleNav(navigation, access), [access]);
  const value = useMemo<Access>(() => ({ me: me ?? null, access, nav, loaded: !isPending, scope: scopeOf(me) }), [me, access, nav, isPending]);

  // NEEDS MY ACTION: one hook for every reader
  const inboxState = useInbox({ enabled: access.signedIn });
  const queue = useMemo<Queue>(() => ({
    ...inboxState,
    text: badgeText(inboxState.inbox.badge),
    label: badgeLabel(inboxState.inbox),
    urgent: inboxState.inbox.badge.kind === 'count' && inboxState.inbox.badge.overdue > 0,
    // the hook hands out a new object every render; what it says changes with `inbox` (memoised by the hook) and `fetching`, and `refetch` does the same each time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [inboxState.inbox, inboxState.fetching]);

  // THE UI
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [dockedShut, setDockedShut] = useState(readDockedShut);
  const [focusRequest, setFocusRequest] = useState(0);
  const pendingFocus = useRef(false);
  const panelButton = useRef<HTMLButtonElement>(null);
  const shown = panelOpen(placement, dockedShut, asked);

  const setPanel = useCallback((next: boolean) => {
    if (placement === 'dock') { setDockedShut(!next); writeDockedShut(!next); } else setAsked(next);
  }, [placement]);
  const togglePanel = useCallback(() => setPanel(!shown), [setPanel, shown]);
  const requestPanelFocus = useCallback(() => { pendingFocus.current = true; setPanel(true); setFocusRequest((n) => n + 1); }, [setPanel]);
  const takeFocusRequest = useCallback(() => { const wanted = pendingFocus.current; pendingFocus.current = false; return wanted; }, []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // a page was opened (or the window changed shape): an overlay, a sheet and the palette are done
  useEffect(() => { setAsked(false); setPaletteOpen(false); }, [pathname]);
  useEffect(() => { setAsked(false); }, [placement]);

  // Ctrl/Cmd K opens the palette, Ctrl/Cmd . takes keyboard focus into the panel (pressed again from inside it, it closes and focus goes back to its button).
  // A page that handled the key first (an editor's own Ctrl K) keeps it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === '.') {
        e.preventDefault();
        const inside = !!document.activeElement?.closest?.('[data-work-panel]');
        if (inside && shown) { setPanel(false); window.requestAnimationFrame(() => panelButton.current?.focus({ preventScroll: true })); } else requestPanelFocus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown, setPanel, requestPanelFocus]);

  const ui = useMemo<Ui>(() => ({
    mode, placement, paletteOpen, openPalette, closePalette, panelShown: shown, setPanel, togglePanel, focusRequest, requestPanelFocus, takeFocusRequest, panelButton,
  }), [mode, placement, paletteOpen, openPalette, closePalette, shown, setPanel, togglePanel, focusRequest, requestPanelFocus, takeFocusRequest]);

  return (
    <AccessCtx.Provider value={value}>
      <QueueCtx.Provider value={queue}>
        <UiCtx.Provider value={ui}>{children}</UiCtx.Provider>
      </QueueCtx.Provider>
    </AccessCtx.Provider>
  );
}
