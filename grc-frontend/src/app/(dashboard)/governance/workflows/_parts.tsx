'use client';

// The few pieces the Approvals tab, the Templates tab and the forms of the Approval Workflows page share, on the design-system tokens and the kit
// (components/ui/ds): how a list answer is read and tried again, the title that is a link, a section's heading and the line a form shows when the server refused it.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import type { UseQueryResult } from '@tanstack/react-query';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { asPage, type Page } from './_model';

/** A read is tried twice more when trying again can help (the server is down, the network dropped); a refusal (403) or a missing record (404) is said at once.
 *  The default of React Query is three more tries with a back-off, which made a refusal a seven-second spinner. */
export const retryRead = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

/** A list route's answer as a page, or an error that says it could not be read: a list is never quietly empty because its shape was not what was expected
 *  (the templates route answers { items, total }; the page used to read it as an array, so the list was always empty). */
export async function readPage<T>(request: Promise<{ data: unknown }>): Promise<Page<T>> {
  const page = asPage<T>((await request).data);
  if (!page) throw new Error('The server answered in a form this page cannot read.');
  return page;
}

/** What a list query holds, as a tab uses it: the page it has (null until it has a usable one), and whether it is still loading or could not be had. What is
 *  cached under ['pending-approvals'] may be the Assessments approvals page's ARRAY (it uses the same key): that is not ours to read, so the list waits for
 *  the refetch instead of showing it, and a body that is never a page is a failure, not an empty list. */
export function useRead<T>(q: UseQueryResult<Page<T>, unknown>) {
  const page = useMemo(() => asPage<T>(q.data), [q.data]);
  const loading = !page && !q.isError && (q.isPending || q.isFetching);
  return { page, loading, failed: !page && !loading, error: q.error, refetch: () => { void q.refetch(); } };
}

/** A row that is decided or deleted takes the focus that was on its button with it (the page falls back to <body>): when the list got shorter and the focus is
 *  nowhere, it goes to `selector`, where the list starts. Focus that is somewhere (a dialog, a field) is never taken. */
export function useFocusAfterRemoval(count: number | undefined, selector: string): void {
  const before = useRef(count);
  useEffect(() => {
    if (count !== undefined && before.current !== undefined && count < before.current) {
      const here = document.activeElement;
      if (!here || here === document.body) document.querySelector<HTMLElement>(selector)?.focus();
    }
    before.current = count;
  }, [count, selector]);
}

// the padding and the matching negative margin make the link 24px high (44px on a phone) without moving anything: a line of text is 20px
const LINK = 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] font-medium text-ds-fg underline-offset-[2px] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

/** A title that is a link (a document's, a template's). A long title wraps and is cut at two lines; the whole of it is the tooltip. The cut is on an inner span:
 *  `line-clamp` on the link itself shows its third line through the link's own padding (the phone's 44px target) and over whatever is under it. */
export function TitleLink({ href, title }: { href: string; title: string }) {
  return <Link href={href} scroll={false} title={title} className={clsx('block [overflow-wrap:anywhere]', LINK)}><span className="line-clamp-2">{title}</span></Link>;
}

/** A section's heading. It takes `!` (`!text-ds-section !text-ds-fg`) on purpose, as the kit's own headings do: the platform CSS remaps a bare h2. */
export function SectionHeading({ id, children, meta }: { id?: string; children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[8px]">
      <h2 id={id} className="min-w-0 break-words !text-ds-section !text-ds-fg">{children}</h2>
      {meta && <span className="text-ds-body text-ds-fg-muted">{meta}</span>}
    </div>
  );
}

/** What the server said about a form that did not save, at the top of the form it is about: said once, where the person is looking, with what they typed kept. */
export function FormProblem({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p role="alert" className="break-words rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-[12px] py-[8px] text-ds-body text-ds-danger">{message}</p>;
}
