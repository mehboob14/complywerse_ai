'use client';

/**
 * Top navigation progress bar. Next 14 App Router removed router events and has
 * no useLinkStatus (15.3+), so client navigations render the shell instantly
 * while data loads — the old page appears to hang for a few seconds with no
 * feedback, and users double-click (flagged by the CTEM UI walkthrough).
 *
 * Dependency-free: a capture-phase click listener starts the bar on any
 * genuine internal navigation; the bar finishes when usePathname() changes
 * (nav complete). A 12s safety timer guarantees it can never stick. Only
 * left-click, no modifier keys, same-origin path links, no hash-only / new-tab
 * / download links.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function NavProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const safety = useRef<number | undefined>(undefined);

  // route actually changed → finish the bar
  useEffect(() => {
    setPhase((p) => (p === 'loading' ? 'done' : p));
  }, [pathname]);

  // brief 'done' flash, then reset
  useEffect(() => {
    if (phase !== 'done') return;
    const t = window.setTimeout(() => setPhase('idle'), 220);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;                 // internal path links only
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      if (href.split('#')[0] === window.location.pathname) return; // same page → no nav
      setPhase('loading');
      window.clearTimeout(safety.current);
      safety.current = window.setTimeout(() => setPhase('idle'), 12000); // never stick
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  if (phase === 'idle') return null;
  return (
    <div aria-hidden style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 2000, pointerEvents: 'none' }}>
      <div style={{
        height: '100%',
        width: phase === 'done' ? '100%' : '85%',
        background: '#17b898',
        transition: phase === 'done' ? 'width .2s ease, opacity .25s ease .1s' : 'width 10s cubic-bezier(.05,.7,.5,1)',
        opacity: phase === 'done' ? 0 : 1,
      }} />
    </div>
  );
}
