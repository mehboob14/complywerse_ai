'use client';

// "You have unsaved text": a document editor says so with `useUnsavedGuard(dirty)`. The Registers tab (RegistersHost) listens and asks before another item
// replaces the editor; the browser asks before the tab is closed or reloaded. An editor outside the host (a page of its own) is guarded by the browser only.
import { createContext, useContext, useEffect } from 'react';

export const UnsavedContext = createContext<{ set: (dirty: boolean) => void } | null>(null);

export function useUnsavedGuard(dirty: boolean): void {
  const ctx = useContext(UnsavedContext);
  useEffect(() => {
    ctx?.set(dirty);
    return () => ctx?.set(false);
  }, [ctx, dirty]);
  useEffect(() => {
    if (!dirty) return undefined;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);
}
