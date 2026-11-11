'use client';

// "Classification and mappings": the two cuts of the library the charts above do not draw. Classification is one whole in four ordered parts (public to restricted:
// one hue, darker for more sensitive, never a rainbow); the mappings are the documents linked to each kind of record, against the documents there are (a document can
// be linked to several, so the bars do not add up). Each part rests on its own request and loads, fails and has nothing on its own; a refusal is "No access" and a
// failure is never read as 0. What each shows, and its words, are visualsModel.ts (classificationParts, mappingRows).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { BarList, SegmentBar } from '@/components/overview/charts';
import { InfoTip } from '@/components/ui/InfoTip';
import { Skeleton } from '@/components/ui/ds';
import type { DocumentsSummary, Scorecard } from './overviewModel';
import { Denied, FOCUS, FeedError, link, refused, type Feed } from './parts';
import { classificationParts, mappingRows } from './visualsModel';

function Block({ label, what, feed, failTitle, info, empty, children }: {
  label: string; what: string; feed: Feed<unknown>; failTitle: string; info?: string; /** the line that says there is nothing to draw, or null */ empty: string | null; children: ReactNode;
}) {
  return (
    <div className="border-t border-ds-border py-[12px] first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-[8px] flex items-center gap-[4px]">
        <h3 className="!text-ds-label !text-ds-fg-muted">{label}</h3>
        {info && feed.load === 'ready' && <InfoTip text={info} label={`About ${label.toLowerCase()}`} />}
      </div>
      {feed.load === 'loading' ? (
        <div role="status" aria-busy="true" className="space-y-[8px]">
          <span className="sr-only">{`Loading ${label.toLowerCase()}`}</span>
          <Skeleton className="h-[16px] w-full" />
          <Skeleton className="h-[12px] w-[70%]" />
        </div>
      ) : refused(feed) ? (
        <Denied what={what} />
      ) : feed.load === 'error' ? (
        <FeedError title={failTitle} feed={feed} quiet />
      ) : empty ? (
        <p className="text-ds-body text-ds-fg-muted">{empty}</p>
      ) : children}
    </div>
  );
}

export function LibraryBody({ summary, scorecard }: { summary: Feed<DocumentsSummary>; scorecard: Feed<Scorecard> }) {
  const classes = classificationParts(summary.data);
  const maps = mappingRows(scorecard.data);
  return (
    <div>
      <Block
        label="Classification" what="the document counts" feed={summary} failTitle="Couldn't load the classification"
        info="Every document, archived ones too, by how sensitive it is, from public to restricted: the darker, the more sensitive."
        empty={classes.length === 0 ? 'No documents yet.' : null}
      >
        <SegmentBar label="Documents by classification" parts={classes.map((c) => ({ ...c, href: link(c.href) }))} height={16} />
      </Block>
      <Block
        label="Mapped to" what="the mappings" feed={scorecard} failTitle="Couldn't load the mappings"
        info="Documents linked to each kind of record, out of the documents that are not archived. A document can be linked to several kinds, so the bars do not add up."
        empty={maps === null ? 'No mapping figures yet.' : maps.rows.length === 0 ? 'No documents to map yet.' : null}
      >
        {maps && <BarList label="Documents mapped, by kind of record" rows={maps.rows.map((r) => ({ key: r.key, label: r.label, value: r.value, valueText: r.text }))} max={maps.of} nameWidth={90} />}
        <Link href={link('/governance/mappings')} className={`mt-[8px] inline-flex min-h-ds-control items-center rounded-ds-control text-ds-body text-ds-primary-text hover:underline ${FOCUS}`}>Open the mappings</Link>
      </Block>
    </div>
  );
}
