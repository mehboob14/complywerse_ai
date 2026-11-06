'use client';

// Pinned pages and recent items, shared by the panel and the palette, kept per browser (pinnedRecent.ts: localStorage, per tenant and person, every access in try/catch).
//  - Recent: the page the person opens is added when it is opened (a record page once its heading is on screen: that is its name); the view in the address is not part of it,
//    so typing in a library's search does not push the library off the list.
//  - Pinned: the page with its view (a library filtered by status is a view worth keeping).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { routeFor } from '@/lib/navRegistry';
import { shortcutFor } from './currentPage';
import { RECENT_MAX, PINS_MAX, isPinned, pinsKey, pushRecent, readList, recentKey, togglePin, unpin, writeList, type Shortcut } from './pinnedRecent';
import { useShellAccess } from './ShellProvider';

interface PinnedRecent {
  pins: Shortcut[];
  recent: Shortcut[];
  /** the page on screen as something to pin (null while it has no name, or when it is not something to keep) */
  current: Shortcut | null;
  currentPinned: boolean;
  /** pin the page on screen, or unpin it; returns what happened ('pinned' | 'unpinned' | null: nothing to pin) */
  toggleCurrent: () => 'pinned' | 'unpinned' | null;
  unpin: (href: string) => void;
}

const Ctx = createContext<PinnedRecent>({ pins: [], recent: [], current: null, currentPinned: false, toggleCurrent: () => null, unpin: () => {} });
export const usePinnedRecent = (): PinnedRecent => useContext(Ctx);

/** A record page names itself in its heading, a moment after it opens: watch for it (a few seconds), then let it go. */
const HEADING_EVERY = 250;
const HEADING_TRIES = 16;
const headingOf = (): string | null => document.querySelector('#main-content h1')?.textContent ?? null;

export function PinnedRecentProvider({ children }: { children: ReactNode }) {
  const { scope } = useShellAccess();
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const [pins, setPins] = useState<Shortcut[]>([]);
  const [recent, setRecent] = useState<Shortcut[]>([]);
  const [named, setNamed] = useState<{ path: string; text: string } | null>(null);
  const heading = named && named.path === pathname ? named.text : null;       // a name found on the page before is not this page's
  const pinsRef = useRef<Shortcut[]>([]);
  const recentRef = useRef<Shortcut[]>([]);

  // whose lists these are
  useEffect(() => {
    const nextPins = scope ? readList(undefined, pinsKey(scope), PINS_MAX) : [];
    const nextRecent = scope ? readList(undefined, recentKey(scope), RECENT_MAX) : [];
    pinsRef.current = nextPins; recentRef.current = nextRecent;
    setPins(nextPins); setRecent(nextRecent);
  }, [scope]);

  // the page's own name, for a record page: when its heading appears
  useEffect(() => {
    if ((routeFor(pathname)?.path ?? '').indexOf(':') < 0) return undefined;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const found = headingOf()?.trim();
      if (found) { window.clearInterval(timer); setNamed({ path: pathname, text: found }); } else if (tries >= HEADING_TRIES) window.clearInterval(timer);
    }, HEADING_EVERY);
    return () => window.clearInterval(timer);
  }, [pathname]);

  // Recent: when the page opens (and, for a record, when it has a name)
  useEffect(() => {
    if (!scope) return;
    const entry = shortcutFor(pathname, '', heading);
    if (!entry) return;
    const next = pushRecent(recentRef.current, entry);
    recentRef.current = next;
    setRecent(next);
    writeList(undefined, recentKey(scope), next);
  }, [scope, pathname, heading]);

  const current = useMemo(() => shortcutFor(pathname, search ? `?${search}` : '', heading), [pathname, search, heading]);
  const currentPinned = !!current && isPinned(pins, current.href);

  const toggleCurrent = useCallback((): 'pinned' | 'unpinned' | null => {
    if (!current || !scope) return null;
    const result = togglePin(pinsRef.current, current);
    pinsRef.current = result.list;
    setPins(result.list);
    writeList(undefined, pinsKey(scope), result.list);
    return result.pinned ? 'pinned' : 'unpinned';
  }, [current, scope]);

  const remove = useCallback((href: string) => {
    if (!scope) return;
    const next = unpin(pinsRef.current, href);
    pinsRef.current = next;
    setPins(next);
    writeList(undefined, pinsKey(scope), next);
  }, [scope]);

  const value = useMemo<PinnedRecent>(() => ({ pins, recent, current, currentPinned, toggleCurrent, unpin: remove }), [pins, recent, current, currentPinned, toggleCurrent, remove]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
