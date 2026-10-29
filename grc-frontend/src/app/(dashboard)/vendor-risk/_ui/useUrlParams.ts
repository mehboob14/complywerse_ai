'use client';

// A page's filters, tab and page number live in its address so a link or a reload lands where the person was. Writes replace the
// current history entry (Back is not polluted) and never scroll. The query-string arithmetic is urlParams.ts (tested).
import { useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { applyParamsPatch, type ParamPatch } from './urlParams';

export function useUrlParams(): {
  get(key: string): string | null;
  getAll(key: string): string[];
  set(patch: ParamPatch): void;
} {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const now = search?.toString() ?? '';

  // The address we last wrote, until Next has caught up with it: two set() calls in one event handler must add up, not overwrite.
  // A change that did not come from us (Back, a link) replaces it.
  const seen = useRef(now);
  const latest = useRef(now);
  if (seen.current !== now) {
    seen.current = now;
    latest.current = now;
  }

  const set = useCallback((patch: ParamPatch) => {
    const next = applyParamsPatch(latest.current, patch);
    if (next === latest.current) return;
    latest.current = next;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [router, pathname]);

  return useMemo(() => ({
    get: (key: string) => search?.get(key) ?? null,
    getAll: (key: string) => search?.getAll(key) ?? [],
    set,
  }), [search, set]);
}
