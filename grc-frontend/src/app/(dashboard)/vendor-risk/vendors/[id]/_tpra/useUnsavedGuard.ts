'use client';

import { useEffect } from 'react';

// Warn the user before they navigate away / close the tab while a form has
// unsaved input. Active only while `dirty` is true, so it never nags otherwise.
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
