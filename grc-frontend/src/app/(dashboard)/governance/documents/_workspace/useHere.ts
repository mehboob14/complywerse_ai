'use client';

// The page the person is on, address and all, as the shell's `?from=` wants it (components/shell/withFrom): a link that leaves the library carries it, so the shell keeps Documents
// lit and the way back is the library as it was (its filters, its view and the document whose details were open). A `from` this page was itself opened with is not part of where it is.
import { usePathname, useSearchParams } from 'next/navigation';

export function useHere(): string {
  const path = usePathname() ?? '';
  const params = new URLSearchParams(useSearchParams()?.toString() ?? '');
  params.delete('from');
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
