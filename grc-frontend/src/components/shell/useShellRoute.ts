'use client';

// Where the person is, for every part of the shell: the path, the page they were opened from (`?from=`, an in-app path the shell honours for the way back and the lit
// entry), and the one lit menu entry (navActive, or the entry of the page it was opened from).
import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cleanQuery } from './currentPage';
import { litFor } from './railModel';
import { useShellAccess } from './ShellProvider';

/** The address of the page as `withFrom(href, here)` wants it ("/needs-my-action?section=ack"): what the page shows, without the parameters that only say how it was opened (a `from`
 *  of its own would nest). A link that opens a record carries it, and the record's trail and lit menu entry know where it came from. */
export function useHere(): string {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  return `${pathname}${cleanQuery(search)}`;
}

export function useShellRoute(): { pathname: string; from: string | null; litHref: string | undefined } {
  const pathname = usePathname() ?? '';
  const from = useSearchParams()?.get('from') ?? null;
  const { nav } = useShellAccess();
  const litHref = useMemo(() => litFor(nav, pathname, from), [nav, pathname, from]);
  return { pathname, from, litHref };
}
