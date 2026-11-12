'use client';

// Going from folder to folder in the library's Folders layout: every move to another folder pushes the address (`?dept=`, the library's own Department filter), so the browser's Back and Forward and a mouse's side buttons work and bring
// the address, the tree and the selection back; and the page keeps the small mirror of that history (navTrail.ts) so its own Back and Forward buttons know whether there is anywhere
// to go (the first Back from the first folder visited does not leave the folders: its button is off) and which way an address change went.
// SCROLL: the page scrolls inside the shell's <main>, which the browser does not restore and the app router does not reset for an address the page pushed itself, so it is done here: a
// folder opened afresh (a push, Up, a click in the tree) starts at the top; Back and Forward put the folder back where it was left.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { canBack, canForward, follow, replaceHere, startTrail, visit, type Folder, type Trail } from './navTrail';

/** The folder a scroll position is remembered under: `org` or the unit's id. */
const folderKey = (folder: Folder): string => (folder === null ? 'org' : String(folder));

// measured before the browser paints; on the server there is nothing to measure
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const scroller = (): HTMLElement | null => (typeof document === 'undefined' ? null : document.getElementById('main-content'));

export interface DirectoryNav {
  canBack: boolean;
  canForward: boolean;
  /** go to a folder: a push (a step the browser's Back undoes), or with 'replace' a change of the same step (a key moved the selection in the tree; a new unit was opened) */
  navigate: (to: Folder, mode?: 'push' | 'replace') => void;
  back: () => void;
  forward: () => void;
}

/** `active`: the Folders layout is showing; otherwise nothing is followed. */
export function useDirectoryNav(active: boolean, current: Folder, setUnit: (to: Folder, push: boolean) => void): DirectoryNav {
  const trailRef = useRef<Trail | null>(null);
  const asked = useRef<'back' | 'forward' | null>(null);       // the direction the page's own button asked the browser for
  const own = useRef<'push' | 'replace' | null>(null);          // the page itself moved to another folder (not the browser's Back or Forward)
  const left = useRef<Folder | undefined>(undefined);           // the folder on screen before this one
  const top = useRef(0);                                        // how far <main> is scrolled, kept as it scrolls (it is clamped the moment shorter content is drawn)
  const tops = useRef(new Map<string, number>());               // where each folder was left
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const main = scroller();
    if (!main) return undefined;
    const keep = () => { top.current = main.scrollTop; };
    main.addEventListener('scroll', keep, { passive: true });
    return () => main.removeEventListener('scroll', keep);
  }, []);

  // the folder changed: which step of the history is it (the browser's Back or Forward, or the page's own move), and where is it scrolled to
  useBeforePaint(() => {
    if (!active) { trailRef.current = null; left.current = undefined; return; }        // not on the Folders layout: nothing is followed
    const t = trailRef.current;
    if (!t) { trailRef.current = startTrail(current); left.current = current; bump(); return; }
    const next = follow(t, current, asked.current);
    const kind = own.current ?? (next.at < t.at ? 'back' : next.at > t.at ? 'forward' : 'push');
    asked.current = null;
    own.current = null;
    if (next !== t) { trailRef.current = next; bump(); }
    if (left.current !== undefined && left.current !== current) {
      tops.current.set(folderKey(left.current), top.current);
      const main = scroller();
      if (main) { main.scrollTop = kind === 'back' || kind === 'forward' ? tops.current.get(folderKey(current)) ?? 0 : 0; top.current = main.scrollTop; }
    }
    left.current = current;
  }, [active, current]);

  const navigate = useCallback((to: Folder, mode: 'push' | 'replace' = 'push') => {
    const t = trailRef.current ?? startTrail(current);
    const next = mode === 'push' ? visit(t, to) : replaceHere(t, to);
    trailRef.current = next;
    if (next !== t) own.current = mode;                         // (going where you already are is no move)
    setUnit(to, mode === 'push');
    bump();
  }, [current, setUnit]);

  const ask = (way: 'back' | 'forward') => {
    asked.current = way;
    window.setTimeout(() => { if (asked.current === way) asked.current = null; }, 1500);
    if (way === 'back') window.history.back(); else window.history.forward();
  };
  const t = trailRef.current;
  return {
    canBack: !!t && canBack(t),
    canForward: !!t && canForward(t),
    navigate,
    back: () => { if (t && canBack(t)) ask('back'); },
    forward: () => { if (t && canForward(t)) ask('forward'); },
  };
}
