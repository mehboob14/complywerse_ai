'use client';

// What a task made by a document review, approval or acknowledgement request offers in Task Management: the person's own step
// (it opens the document with that popup) and the document. Rules and words: lib/documentTasks.ts.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, Lock, PenLine } from 'lucide-react';
import { authedFetch } from '@/lib/auth-fetch';
import { closesWhen, requestLine, taskButtons, type DocumentRequest } from '@/lib/documentTasks';

/** The signed-in user's id (same query as My Work), or null while it loads. */
export function useMyUserId(): number | null {
  const { data } = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const r = await authedFetch('/api/auth/me');
      const d = await r.json();
      return (d?.authenticated && d.user) ? d.user : null;
    },
    staleTime: 5 * 60_000,
  });
  return data?.id != null ? Number(data.id) : null;
}

const PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#0b6b58] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/40';
const SECONDARY = 'inline-flex items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-white px-3 py-1.5 text-[13px] font-medium text-[#26323d] hover:bg-[#f4f6f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/40';

/** The card on a task's page: the document, where the request stands, the buttons, and what closes the task. */
export function DocumentTaskCard({ request, meId }: { request: DocumentRequest | null | undefined; meId: number | null }) {
  if (!request) {
    return (
      <div className="rounded-lg border border-[#d5dbe1] bg-[#f4f6f8] px-4 py-3 text-[13px] text-[#26323d]" role="status">
        This task came from a document request that no longer exists. It changes nothing in the document.
      </div>
    );
  }
  const mine = meId != null && request.user_id === meId;
  const buttons = taskButtons(request, meId);
  return (
    <section aria-label="Document request" className="rounded-lg border border-[#99d5cc] bg-[#effaf8] px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#0f766e]"><FileText size={16} aria-hidden /></span>
          <div className="min-w-0">
            <p className="break-words text-[14px] font-semibold text-[#1f2933]">{request.document_title || `Document #${request.document_id}`}</p>
            <p className={`mt-0.5 text-[12px] ${request.overdue ? 'font-semibold text-[#b42318]' : 'text-[#26323d]'}`}>{requestLine(request)}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {buttons.map((b) => (
            <Link key={b.href} href={b.href} className={b.primary ? PRIMARY : SECONDARY}>
              {b.primary ? <PenLine size={14} aria-hidden /> : <ArrowUpRight size={14} aria-hidden />} {b.label}
            </Link>
          ))}
        </div>
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-[#26323d]">
        <Lock size={12} className="mt-1 shrink-0 text-[#0f766e]" aria-hidden />
        <span>{closesWhen(request, mine)}</span>
      </p>
    </section>
  );
}

/** A small link for a row in a list: the person's own step when it is theirs, else the document. */
export function DocumentTaskLink({ request, meId, className = '' }: { request: DocumentRequest | null | undefined; meId: number | null; className?: string }) {
  const [first] = taskButtons(request, meId);
  if (!first) return null;
  return (
    <Link href={first.href} className={`inline-flex items-center gap-1 text-xs font-medium text-[#0b6b58] hover:underline ${className}`}>
      {first.label} <ArrowUpRight size={12} aria-hidden />
    </Link>
  );
}
