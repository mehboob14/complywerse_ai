'use client';
// Every page names itself in the browser tab and in the screen reader's window list (WCAG 2.4.2).
// The app's pages share one title; these say where you are.

import { useEffect } from 'react';

export function usePageTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = `${title} · Access reviews · CompliverseAI`;
    return () => { document.title = before; };
  }, [title]);
}
