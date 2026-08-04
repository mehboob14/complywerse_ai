'use client';

import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

// Module-level cache — survives re-renders and SPA navigations.
// Keyed by full pathname so /assets/135 and /assets/136 are separate.
const _scrollCache = new Map<string, number>();

function useScrollRestoration(mainRef: React.RefObject<HTMLElement>) {
  const [location] = useLocation();
  const prevLocation = useRef<string>(location);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const prev = prevLocation.current;
    prevLocation.current = location;

    // Capture the scroll position of the page we're leaving BEFORE React
    // renders new content into <main>.  useEffect fires synchronously after
    // the DOM paint but before the next user interaction, so scrollTop still
    // reflects the outgoing page at this moment.
    if (prev !== location) {
      _scrollCache.set(prev, el.scrollTop);
    }

    // Restore the saved position for the incoming page (0 if first visit).
    const savedPos = _scrollCache.get(location) ?? 0;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = savedPos;
      // Lazy-loaded content may not have stretched the page yet — retry once.
      if (savedPos > 0 && el.scrollTop < savedPos - 2) {
        setTimeout(() => { el.scrollTop = savedPos; }, 250);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [location, mainRef]);
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null!);
  useScrollRestoration(mainRef);

  return (
    <div className="platform-ui compact-density cw-dashboard flex h-screen overflow-hidden bg-[var(--color-subtle)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main
          ref={mainRef}
          className="flex-1 overflow-auto bg-[var(--color-subtle)] p-4 lg:p-5 scrollbar-thin"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
