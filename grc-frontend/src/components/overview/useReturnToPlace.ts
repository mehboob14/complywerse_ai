'use client';

// useReturnToPlace(ready): when the person comes back to an Overview (browser Back or Forward, a reload, or a link to the very address they left, like the
// module's own "back to the overview"), the page is put back where they were: the same view (that is the address's job: useAddressState keeps view, scope and
// tabs in the query) and the same scroll position, once `ready` says the data has rendered. Opening the page fresh (a menu entry, a card on another page)
// starts at the top, whatever scroll the previous page had left in the layout's <main>.
//
//   const ready = !isLoading && !isFetching;            // or every card's query has answered
//   useReturnToPlace(ready);
//
// How it works. The scroller is the dashboard layout's <main id="main-content"> (the window is not what scrolls there; the window is the fallback for a page
// outside that layout). While the person scrolls, the position is written to sessionStorage under the page's path and query (at most every 150ms, and once more
// when they stop), and exactly once more when they leave: when a link is pressed, on `pagehide`, and in the layout-effect cleanup (it runs before the page's
// elements are removed, so it reads the real position; a scroll event after the move would read the shorter next page). On arrival a module-level `popstate`
// listener (installed when this file is first loaded, so it has seen the Back press) tells a history return from a fresh open (returnToPlaceModel.isReturn).
// While the place is being put back nothing is written (the browser's own scroll to the top must not overwrite it); the page is put back when `ready` is true
// and kept there for 2.5s while its charts measure themselves (a page that is not tall enough yet is put as low as it goes and asked again), unless the person
// scrolls first (wheel, touch, key, press). sessionStorage can be blocked: every read and write is in a try/catch and the page simply starts at the top.
// A page that goes back with a button that calls router.push (not a link, not Back) starts at the top: only the browser's history and links are known.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  DECIDE_LATE_MS, POLL_MS, SETTLE_MS, STORE_KEY, isReturn, isTraverse, keyOfHref, mayWrite, parsePlaces, placeKey, placeOf, reached, restoreTarget, saveDelay, withPlace, type Arrival,
} from './returnToPlaceModel';

interface Scroller { target: EventTarget; get: () => number; set: (y: number) => void; max: () => number }

function scrollerOf(): Scroller {
  const main = typeof document !== 'undefined' ? document.getElementById('main-content') : null;
  if (main) return { target: main, get: () => main.scrollTop, set: (y) => { main.scrollTop = y; }, max: () => main.scrollHeight - main.clientHeight };
  return {
    target: window,
    get: () => window.scrollY,
    set: (y) => window.scrollTo(0, y),
    max: () => document.documentElement.scrollHeight - window.innerHeight,
  };
}

const read = () => { try { return parsePlaces(window.sessionStorage.getItem(STORE_KEY)); } catch { return {}; } };
const write = (key: string, y: number) => { try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(withPlace(read(), key, y, Date.now()))); } catch { /* blocked or full: the page starts at the top next time */ } };

// what the window did since the page was last drawn (module level: it must have seen the Back press before the page mounted)
const arrival: Arrival = { poppedAt: null, intent: null, load: null };
let saveActive: (() => void) | null = null;
let touched = false;                                  // the person scrolled, pressed or touched since the page mounted

// `window.__rtp = []` (a probe or a test) records what the hook saw and decided, for diagnosing a return that was not recognised; without it nothing is recorded
const hasNavigationApi = (): boolean => typeof (window as unknown as { navigation?: unknown }).navigation !== 'undefined';

const trace = (event: string, extra?: Record<string, unknown>) => { (window as unknown as { __rtp?: unknown[] }).__rtp?.push({ t: Math.round(performance.now()), event, ...extra }); };

if (typeof window !== 'undefined') {
  const nav = typeof performance !== 'undefined' && performance.getEntriesByType ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined) : undefined;
  if (nav) {
    // the address this DOCUMENT was loaded at (the navigation entry's name stays the first address whatever the app pushes later)
    let at: URL | null = null;
    try { at = new URL(nav.name); } catch { /* not an address */ }
    if (at) arrival.load = { type: nav.type, ageMs: 0, key: placeKey(at.pathname, at.search) };
  }
  const popped = (how: string) => { arrival.poppedAt = Date.now(); arrival.intent = null; trace(how); };
  // CAPTURE: the router (Next) restores the cached page in its own popstate handler, which was registered long before this one; a bubbling listener could run
  // after the page had already mounted and decided. A capture listener on the window runs first, whatever the order of registration.
  window.addEventListener('popstate', () => popped('popstate'), true);
  // the Navigation API (Chromium) says it earlier still, and says what kind of navigation it is: a push is a new intent and ends an unused Back
  const navigation = (window as unknown as { navigation?: { addEventListener: (type: string, listener: (e: { navigationType?: unknown }) => void) => void } }).navigation;
  navigation?.addEventListener('navigate', (e) => {
    if (isTraverse(e.navigationType)) popped('navigate:traverse');
    else if (e.navigationType === 'push') { arrival.poppedAt = null; trace('navigate:push'); }
  });
  window.addEventListener('pagehide', () => saveActive?.());
  // any new intent of the person ends the last one: a Back that nobody used must not turn the next fresh visit into a return
  const intend = (e: Event) => {
    touched = true;
    arrival.poppedAt = null;
    arrival.intent = null;
    if (e.type !== 'click') return;
    saveActive?.();
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.closest('aside, nav[aria-label="Primary"]')) return;     // the menu opens a page fresh
    arrival.intent = keyOfHref(a.href, window.location.href);
  };
  document.addEventListener('click', intend, true);
  document.addEventListener('keydown', intend, true);
  for (const ev of ['wheel', 'touchstart', 'pointerdown']) window.addEventListener(ev, () => { touched = true; }, { capture: true, passive: true });
}

export function useReturnToPlace(ready: boolean): void {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const key = placeKey(pathname ?? '/', search);
  const keyRef = useRef(key);
  keyRef.current = key;
  const decided = useRef<{ place: number | null; late: boolean } | null>(null);   // decided once per page, so React's dev remount (mount, cleanup, mount) cannot lose it
  const [verdict, setVerdict] = useState(0);             // a late verdict (no Navigation API: `popstate` came after the mount) asks the put-back effect to look again
  const want = useRef<number | null>(null);          // the place to put the page back to; null: a fresh open
  const done = useRef(false);                        // the page is where it was (or the person took over): writing resumes
  const stop = useRef<(() => void) | null>(null);

  // on arrival: decide, start at the top for a fresh open, and keep the position while the person scrolls and when they leave
  useLayoutEffect(() => {
    const sc = scrollerOf();
    const mountedAt = Date.now();
    touched = false;
    if (!decided.current) {
      const now = mountedAt;
      if (arrival.load) arrival.load.ageMs = performance.now();
      const back = isReturn(arrival, keyRef.current, now);
      // `poppedAt` is NOT cleared here: a page that is mounted twice for one Back (a Suspense boundary, a remount) must decide the same twice. It ends with the person's next
      // click or key, with a push, or after 15 s.
      // Without the Navigation API nothing has said "Back" yet when the router mounts the cached page before `popstate`: a page that looks freshly opened waits a
      // moment. (A link pressed earlier proves nothing: it is the link that LEFT the overview, and Back does not click.)
      const late = !back && !hasNavigationApi();
      arrival.intent = null;
      arrival.load = null;                                                     // the document's own first page only
      decided.current = { place: back ? placeOf(read(), keyRef.current, now) : null, late };
      trace('mount', { key: keyRef.current, back, late, place: decided.current.place, poppedAt: arrival.poppedAt === null ? null : now - arrival.poppedAt });
    }
    const place = decided.current.place;
    const waiting = decided.current.late;
    want.current = place;
    done.current = place === null && !waiting;                                 // while it waits nothing is written and nothing is moved
    if (place === null && !waiting && !window.location.hash) sc.set(0);
    let verdictTimer: ReturnType<typeof setTimeout> | null = null;
    if (waiting) {
      verdictTimer = setTimeout(() => {
        const now = Date.now();
        const back = isReturn(arrival, keyRef.current, now);                   // `popstate` may have come in the meantime
        const found = back ? placeOf(read(), keyRef.current, now) : null;
        decided.current = { place: found, late: false };
        want.current = found;
        done.current = found === null;
        if (found === null && !window.location.hash) sc.set(0);
        trace('verdict', { key: keyRef.current, back, place: found });
        setVerdict((v) => v + 1);
      }, DECIDE_LATE_MS);
    }

    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!done.current) return;                                               // being put back: the browser's own jump to the top is not the person's place
      last = Date.now();
      const y = sc.get();
      if (!mayWrite({ y, touched, sinceMountMs: last - mountedAt, kept: y < 1 && !touched ? placeOf(read(), keyRef.current, last) : null })) { trace('keep', { key: keyRef.current }); return; }
      write(keyRef.current, y);
    };
    const onScroll = () => {
      const wait = saveDelay(Date.now(), last);
      if (wait === 0) save();
      else if (!timer) timer = setTimeout(save, wait);
    };
    sc.target.addEventListener('scroll', onScroll, { passive: true });
    saveActive = save;
    return () => {
      if (verdictTimer) clearTimeout(verdictTimer);
      save();                                                                  // layout cleanup: the page's elements are still there, so this is where the person was
      sc.target.removeEventListener('scroll', onScroll);
      if (saveActive === save) saveActive = null;
      stop.current?.();
    };
  }, []);

  // when the data has rendered: put the page back, and keep it there while the layout settles
  useEffect(() => {
    if (!ready || want.current === null || done.current) return;
    const sc = scrollerOf();
    const target = want.current;
    const TAKEOVER = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    const put = () => { const y = restoreTarget(target, sc.max()); if (!reached(sc.get(), y)) sc.set(y); };
    let poll = 0;
    let end = 0;
    const cancel = () => {
      window.clearInterval(poll);
      window.clearTimeout(end);
      for (const ev of TAKEOVER) window.removeEventListener(ev, finish, true);
      stop.current = null;
    };
    const finish = () => { cancel(); done.current = true; };                  // the person took over, or it has settled: writing resumes
    put();
    poll = window.setInterval(put, POLL_MS);
    end = window.setTimeout(finish, SETTLE_MS);
    for (const ev of TAKEOVER) window.addEventListener(ev, finish, { capture: true, passive: true });
    stop.current = cancel;
    return cancel;
  }, [ready, verdict]);
}
