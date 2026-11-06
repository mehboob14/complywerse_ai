'use client';

// "Library and exceptions": the three figures the old page opened with, kept as the lower card of the cockpit. Documents (the active count opens the library,
// Published and In review open it on that status), Coverage (the share of documents mapped, the server's formula behind the (i)) and Exceptions (the total opens the
// exceptions, with the ones waiting for a decision and the ones about to lapse). Each figure reads one request and loads, fails and has nothing on its own:
// a skeleton while it loads, "No access" when the server refused it, an error row with Retry when it failed, a dash when there is nothing to score (never 0).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { InfoTip } from '@/components/ui/InfoTip';
import { Skeleton, StatusPill } from '@/components/ui/ds';
import { EMPTY, formatCount } from '@/lib/format';
import { documentStatus, exceptionStatus, statusPill } from '@/lib/status';
import { coverageTile, documentsHref, documentsTile, type DocumentsSummary, type Scorecard } from './overviewModel';
import { Denied, FOCUS, FeedError, refused, type Feed } from './parts';

const NUMBER = 'min-w-[24px] w-fit rounded-ds-control text-[24px] leading-[32px] font-[600] tabular-nums text-ds-fg';

function Figure({ label, what, feed, failTitle, info, children }: { label: string; what: string; feed: Feed<unknown>; failTitle: string; info?: string; children: ReactNode }) {
  return (
    <div className="border-t border-ds-border py-[10px] first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-center gap-[4px]">
        <p className="text-ds-label text-ds-fg-muted">{label}</p>
        {info && feed.load === 'ready' && <InfoTip text={info} label={`How ${label.toLowerCase()} is counted`} />}
      </div>
      {feed.load === 'loading' ? (
        <div role="status" aria-busy="true" className="mt-[6px] space-y-[8px]">
          <span className="sr-only">{`Loading ${label.toLowerCase()}`}</span>
          <Skeleton className="h-[28px] w-[96px]" />
          <Skeleton className="h-[12px] w-[70%]" />
        </div>
      ) : refused(feed) ? (
        <Denied what={what} className="mt-[4px]" />
      ) : feed.load === 'error' ? (
        <FeedError title={failTitle} feed={feed} quiet className="mt-[4px]" />
      ) : children}
    </div>
  );
}

function StatusLink({ href, status, n }: { href: string; status: string; n: number }) {
  return (
    <Link href={href} aria-label={`${documentStatus.label(status)}: ${formatCount(n)}`} className={`inline-flex min-h-ds-control items-center gap-[6px] rounded-ds-control text-ds-label text-ds-fg-body hover:text-ds-fg ${FOCUS}`}>
      <StatusPill size="sm" {...statusPill(documentStatus, status)} />
      <span className="font-[600] tabular-nums text-ds-fg">{formatCount(n)}</span>
    </Link>
  );
}

export function LibraryBody({ summary, scorecard, exceptions }: {
  summary: Feed<DocumentsSummary>;
  scorecard: Feed<Scorecard>;
  exceptions: Feed<{ total?: number; pending_approval?: number; expiring_soon?: number }>;
}) {
  const d = documentsTile(summary.data);
  const docNoun = d.active === 1 ? 'document' : 'documents';
  const cover = coverageTile(scorecard.data);
  const e = exceptions.data;
  const total = e?.total ?? 0;
  const excNoun = total === 1 ? 'exception' : 'exceptions';
  return (
    <div>
      <Figure label="Documents" what="the document counts" feed={summary} failTitle="Couldn't load documents">
        <div className="mt-[2px] flex flex-wrap items-center gap-x-[8px]">
          <Link href={documentsHref.all} aria-label={`${formatCount(d.active)} ${docNoun}. Open the library`} className={`${NUMBER} hover:underline ${FOCUS}`}>{formatCount(d.active)}</Link>
          <span className="text-ds-body text-ds-fg-muted">{docNoun}</span>
          {d.archived > 0 && (
            <Link href={documentsHref.archived} className={`inline-flex min-h-ds-control items-center rounded-ds-control text-ds-label text-ds-fg-muted hover:text-ds-fg hover:underline ${FOCUS}`}>{`${formatCount(d.archived)} archived`}</Link>
          )}
        </div>
        <div className="flex flex-wrap gap-x-[12px]">
          <StatusLink href={documentsHref.published} status="published" n={d.published} />
          <StatusLink href={documentsHref.inReview} status="pending_review" n={d.inReview} />
        </div>
      </Figure>

      <Figure label="Coverage" what="coverage" feed={scorecard} failTitle="Couldn't load coverage" info={cover?.formula}>
        <p className={`mt-[2px] ${NUMBER}`}>{cover && cover.percent !== null ? `${Math.round(cover.percent)}%` : EMPTY}</p>
        {cover && cover.percent !== null && (
          <div aria-hidden className="mt-[6px] h-[6px] rounded-full bg-ds-border">
            <div className="h-[6px] rounded-full bg-ds-primary" style={{ width: `${Math.max(0, Math.min(100, Math.round(cover.percent)))}%` }} />
          </div>
        )}
        <p className="mt-[6px] text-ds-label text-ds-fg-muted">{!cover || cover.of === 0 ? 'No documents to map yet' : `${formatCount(cover.mapped)} of ${formatCount(cover.of)} documents mapped`}</p>
      </Figure>

      <Figure label="Exceptions" what="the exceptions" feed={exceptions} failTitle="Couldn't load exceptions">
        <div className="mt-[2px] flex flex-wrap items-center gap-x-[8px]">
          <Link href="/governance/exceptions" aria-label={`${formatCount(total)} ${excNoun}. Open the exceptions`} className={`${NUMBER} hover:underline ${FOCUS}`}>{formatCount(total)}</Link>
          <span className="text-ds-body text-ds-fg-muted">{excNoun}</span>
        </div>
        <div className="mt-[4px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-label">
          <span className="inline-flex items-center gap-[6px]">
            <StatusPill size="sm" {...statusPill(exceptionStatus, 'pending_approval')} />
            <span className="font-[600] tabular-nums text-ds-fg">{formatCount(e?.pending_approval ?? 0)}</span>
          </span>
          <span className="inline-flex items-center gap-[6px]">
            <StatusPill size="sm" tone="warning" label="Expiring soon" />
            <span className="font-[600] tabular-nums text-ds-fg">{formatCount(e?.expiring_soon ?? 0)}</span>
          </span>
        </div>
      </Figure>
    </div>
  );
}
