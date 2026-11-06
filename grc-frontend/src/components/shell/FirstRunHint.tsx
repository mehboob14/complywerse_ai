'use client';

// A one-line tip for people who have not seen the palette and the panel: below 1440 the panel is shut and the rail is icons, so nothing on the page says they are there.
// Shown from 768 to 1439 until it is dismissed (Got it, or once the palette has been opened); dismissed per browser (localStorage; the login page clears storage at every
// sign-in, so it comes back once after signing in again: a decision for the owner, noted in the plan). It does not take focus and it moves nothing: a fixed note in the corner of the window, out of the way of the page's own actions.
import { useEffect, useState } from 'react';
import { useModifierName } from './CommandBar';
import { useShell, useShellAccess } from './ShellProvider';

const KEY = 'cw-shell-hint';

function dismissed(): boolean {
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}
function remember(): void {
  try { window.localStorage.setItem(KEY, '1'); } catch { /* shown again next time; harmless */ }
}

export default function FirstRunHint() {
  const { placement, paletteOpen } = useShell();
  const { access, loaded } = useShellAccess();
  const mod = useModifierName();
  const [gone, setGone] = useState(true);              // until the browser has been asked: no flash
  useEffect(() => { setGone(dismissed()); }, []);
  useEffect(() => { if (paletteOpen && !gone) { setGone(true); remember(); } }, [paletteOpen, gone]);

  if (gone || !loaded || !access.signedIn || placement === 'dock') return null;
  const dismiss = () => { setGone(true); remember(); };
  return (
    <div role="note" aria-label="Tip" className="fixed bottom-[16px] right-[16px] z-40 hidden w-[320px] max-w-[calc(100vw-24px)] items-start gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px] shadow-ds-pop md:flex">
      <p className="min-w-0 flex-1 text-ds-body text-ds-fg-body">
        <span className="font-[600] text-ds-fg">Search anything with {mod} K.</span> Your queue and this module&apos;s pages are under Work and context ({mod} .).
      </p>
      <button type="button" onClick={dismiss} className="inline-flex h-ds-control shrink-0 items-center justify-center rounded-ds-control px-[8px] text-ds-body font-[600] text-ds-primary-text hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">Got it</button>
    </div>
  );
}
