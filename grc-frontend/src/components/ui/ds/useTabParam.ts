'use client';

// The open tab kept in the address (?tab=risk), so a link, a reload and the Back button land where the person was. Picking a tab replaces the
// address (Back is not filled with tab clicks) and never scrolls; every other param stays, and the default tab has the plain address. An old
// ?tab= name from an email, a task or a bookmark still opens the tab that holds its content now (`aliases`). The rules are lib/tabsModel.ts (tested).
//
//   const [tab, setTab] = useTabParam('tab', ['document', 'approvals', 'versions'], { fallback: 'document', aliases: { lifecycle: 'approvals' } });
//   <Tabs tabs={…} value={tab} onChange={setTab} ariaLabel="…">
//
// Pass only the keys that are on offer today (a tab that is hidden is not a key), so an address that asks for it opens the fallback.
// This is not `@/lib/useTabParam`, the older hook that holds the tab in React state and writes ?tab= with history.replaceState.
//
// What the person picks is shown at once and the address follows: the router's replace is a round trip to the server (200 to 300 ms measured
// on a local dev server), and waiting for it left the focused tab with aria-selected=false and the old panel on screen for that long.
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { resolveTab, withTab } from '@/lib/tabsModel';

export function useTabParam<K extends string>(
  paramName: string,
  keys: readonly K[],
  { aliases = {}, fallback }: { aliases?: Readonly<Record<string, K>>; fallback: K },
): [K, (key: K) => void] {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const fromAddress = resolveTab(search, paramName, keys, aliases, fallback) as K;
  const [picked, setPicked] = useState<K | null>(null);
  useEffect(() => { setPicked(null); }, [search]);                  // the address changed (the router caught up, Back, a link): it is the truth again

  const select = useCallback((key: K) => {
    setPicked(key);
    const next = withTab(search, paramName, key, fallback);
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [router, pathname, search, paramName, fallback]);

  return [picked ?? fromAddress, select];
}
