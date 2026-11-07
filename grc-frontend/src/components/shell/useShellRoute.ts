'use client';

// The address of the page as `withFrom(href, here)` wants it. (The Stage 2 shell that also read `?from=` for its trail was taken out; links still carry it, harmlessly.)
import { usePathname, useSearchParams } from 'next/navigation';
import { cleanQuery } from './currentPage';

/** The address of the page as `withFrom(href, here)` wants it ("/needs-my-action?section=ack"): what the page shows, without the parameters that only say how it was opened (a `from`
 *  of its own would nest). A link that opens a record carries it, and the record's trail and lit menu entry know where it came from. */
export function useHere(): string {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  return `${pathname}${cleanQuery(search)}`;
}
