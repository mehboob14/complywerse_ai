'use client';

// The first-run pointer at Work and context. Below 1440 the panel is shut and the rail is icons, so nothing on the page says the panel is there: until the person has opened the
// palette or the panel once, the panel's button in the top bar carries its name (from 1024, where the bar has the room). It sits in the bar, so it covers nothing of the page, and it
// needs no "Got it": using what it points at is the dismissal. Remembered per browser (localStorage; the login page clears storage at every sign-in, so it comes back once after
// signing in again: a decision for the owner, noted in the plan). The rules are panelModel.hintShows / hintUsed.
import { useEffect, useState } from 'react';
import { hintShows, hintUsed } from './panelModel';
import { useShell, useShellAccess } from './ShellProvider';

const KEY = 'cw-shell-hint';

function dismissed(): boolean {
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}
function remember(): void {
  try { window.localStorage.setItem(KEY, '1'); } catch { /* shown again next time; harmless */ }
}

/** Whether the panel's button carries its name now. */
export function useFirstRunHint(): boolean {
  const { placement, paletteOpen, panelShown } = useShell();
  const { access, loaded } = useShellAccess();
  const [gone, setGone] = useState(true);              // until the browser has been asked: no flash
  useEffect(() => { setGone(dismissed()); }, []);
  const used = hintUsed({ paletteOpen, panelShown, placement });
  useEffect(() => { if (used && !gone) { setGone(true); remember(); } }, [used, gone]);
  return loaded && access.signedIn && hintShows(gone, placement);
}
