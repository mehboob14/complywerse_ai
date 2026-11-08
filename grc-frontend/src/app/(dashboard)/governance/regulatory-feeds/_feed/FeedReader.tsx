'use client';

// The reader of the Feed: one item with everything needed to decide, and the next step as buttons. Read it (the description), let the AI analyse it, then Convert it to a regulatory change, or mark
// it not relevant (Restore brings it back). A converted item says so and opens its change. The AI's analysis is shown in sections; an analysis that could not be used is said in plain words
// with the way to try again, never as the error text it stored. No model is named.
import { AlertTriangle, ArrowRightCircle, Brain, ExternalLink, RotateCcw, XCircle } from 'lucide-react';
import { Button, ClampedText, Notice, StatusPill } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { feedItemStatus } from '@/lib/statuses/regulatory';
import type { FeedItem } from '../../regulatory-changes/_lib/types';
import { changeHref } from '../../regulatory-changes/_overview/overviewModel';
import { actionsOf, analysisFailed, analysisOf, descriptionOf } from './feedModel';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-ds-border pt-[12px]">
      <h3 className="!text-ds-label !font-[600] !text-ds-fg-muted">{title}</h3>
      <div className="mt-[4px]">{children}</div>
    </section>
  );
}

export interface ReaderBusy { analyze: boolean; convert: boolean; dismiss: boolean; restore: boolean }

export function FeedReader({ item, busy, canCreate, onAnalyze, onConvert, onDismiss, onRestore }: {
  item: FeedItem; busy: ReaderBusy; canCreate: boolean; onAnalyze: () => void; onConvert: () => void; onDismiss: () => void; onRestore: () => void;
}) {
  const can = actionsOf(item);
  const analysis = analysisOf(item);
  const description = descriptionOf(item);
  return (
    <article aria-label={item.title} className="flex min-w-0 flex-col gap-[12px]">
      <header className="flex flex-col gap-[6px]">
        <h2 dir="auto" className="m-0 !text-ds-section !font-[600] !text-ds-fg [overflow-wrap:anywhere]">{item.title}</h2>
        <p className="m-0 flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          <StatusPill size="sm" {...statusPill(feedItemStatus, item.status)} />
          <span>{item.feed_source_name || 'A feed'}</span>
          <span>{formatDate(item.published_date, { empty: 'No date' })}</span>
          {item.link && (
            <a href={item.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-[4px] rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
              Read the original<ExternalLink aria-hidden className="h-[12px] w-[12px]" /><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-[8px]">
        {can.analyze && <Button variant={can.convert ? 'secondary' : 'primary'} leftIcon={<Brain aria-hidden />} loading={busy.analyze} onClick={onAnalyze}>{can.analyze === 'again' ? 'Analyze again' : 'Analyze with AI'}</Button>}
        {can.convert && canCreate && <Button variant="primary" leftIcon={<ArrowRightCircle aria-hidden />} loading={busy.convert} onClick={onConvert}>Convert to a regulatory change</Button>}
        {can.openChange && item.regulatory_change_id && <Button variant="primary" href={changeHref(item.regulatory_change_id)} rightIcon={<ArrowRightCircle aria-hidden />}>Open the change</Button>}
        {can.dismiss && <Button leftIcon={<XCircle aria-hidden />} loading={busy.dismiss} onClick={onDismiss}>Not relevant</Button>}
        {can.restore && <Button leftIcon={<RotateCcw aria-hidden />} loading={busy.restore} onClick={onRestore}>Put it back</Button>}
      </div>

      {can.openChange && <Notice tone="info" title="This item became a regulatory change">Follow it there: its obligations, impact and tasks are on the change.</Notice>}
      {analysisFailed(item) && (
        <Notice tone="warning" title="The AI could not use its reading of this item" icon={AlertTriangle}>Try the analysis again. You can also convert it as it is, from the title and description.</Notice>
      )}

      <Block title="What the feed says"><ClampedText text={description || 'No description in the feed.'} lines={6} /></Block>

      {analysis && (
        <>
          <Block title="AI analysis">
            <p className="m-0 flex flex-wrap items-center gap-[8px] text-ds-body text-ds-fg-body">
              {analysis.priority && <StatusPill size="sm" {...statusPill(priority, analysis.priority.toLowerCase())} label={`${priority.label(analysis.priority.toLowerCase())} priority`} />}
              {analysis.summary}
            </p>
          </Block>
          {(analysis.compliance_gaps?.length ?? 0) > 0 && (
            <Block title="Compliance gaps">
              <ul className="m-0 flex list-none flex-wrap gap-[6px] p-0">{analysis.compliance_gaps?.map((g, i) => <li key={i} className="rounded-full bg-ds-danger-soft px-[8px] text-ds-label text-ds-danger">{g}</li>)}</ul>
            </Block>
          )}
          {(analysis.impacted_frameworks?.length ?? 0) > 0 && (
            <Block title="Frameworks it touches">
              <ul className="m-0 list-none p-0">{analysis.impacted_frameworks?.map((f, i) => <li key={i} className="py-[2px]"><span className="text-ds-body font-[600] text-ds-fg">{f.name}</span>{f.reason && <span className="block text-ds-label text-ds-fg-muted">{f.reason}</span>}</li>)}</ul>
            </Block>
          )}
          {(analysis.impacted_controls?.length ?? 0) > 0 && (
            <Block title="Controls it touches">
              <ul className="m-0 list-none p-0">{analysis.impacted_controls?.map((c, i) => <li key={i} className="py-[2px]"><span className="text-ds-body font-[600] text-ds-fg">{[c.id, c.name].filter(Boolean).join(': ')}</span>{c.action_needed && <span className="block text-ds-label text-ds-fg-muted">{c.action_needed}</span>}</li>)}</ul>
            </Block>
          )}
          {(analysis.impacted_policies?.length ?? 0) > 0 && (
            <Block title="Policies it touches">
              <ul className="m-0 list-none p-0">{analysis.impacted_policies?.map((p, i) => <li key={i} className="py-[2px]"><span className="text-ds-body font-[600] text-ds-fg">{p.title}</span>{p.action_needed && <span className="block text-ds-label text-ds-fg-muted">{p.action_needed}</span>}</li>)}</ul>
            </Block>
          )}
          {(analysis.implementation_tasks?.length ?? 0) > 0 && (
            <Block title="Tasks the AI suggests">
              <ul className="m-0 list-none p-0">
                {analysis.implementation_tasks?.map((t, i) => (
                  <li key={i} className="border-b border-ds-border py-[6px] last:border-b-0">
                    <span className="flex flex-wrap items-center gap-[8px]">
                      <span className="text-ds-body font-[600] text-ds-fg">{t.title}</span>
                      {t.priority && <StatusPill size="sm" {...statusPill(priority, t.priority.toLowerCase())} />}
                    </span>
                    {t.description && <span className="block text-ds-label text-ds-fg-muted">{t.description}</span>}
                    {t.suggested_deadline_days ? <span className="block text-ds-label text-ds-fg-muted">{`Suggested: within ${t.suggested_deadline_days} days`}</span> : null}
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </>
      )}
    </article>
  );
}
