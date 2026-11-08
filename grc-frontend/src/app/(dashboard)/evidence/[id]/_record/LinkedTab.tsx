'use client';

// The Linked tab: what the file is linked to, one kind at a time (a strip of the kinds with their true counts), each linked record with a way to open it and to remove the link, and below
// the suggestions for more. Every count has a list behind it. A kind whose request failed says so with a Retry instead of a 0; "Link records" opens the one sheet that links any kind.
import { ExternalLink, Link2, Unlink } from 'lucide-react';
import { Button, ErrorState, FilterChips, Notice, SkeletonRows, StatusPill, type FilterChip } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { LINKABLE, LINK_LABEL, LINK_ONE, LINK_TYPES, SUGGEST_TARGETS, coverageSummary, linkedItems, type LinkType, type LinkedItem, type SuggestTarget } from './linkModel';
import { SuggestionsFeed } from './SuggestionsFeed';
import type { ControlRef } from './ControlDetails';
import type { LinkRequest } from './recordActions';
import type { AllLinks, ControlsResponse } from './recordTypes';

const MUTED = 'text-ds-fg-muted';
interface Source<T> { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

/** The kinds that the controls request answers; the rest come from the links request. */
const FROM_CONTROLS: readonly LinkType[] = ['common_controls', 'framework_controls'];
const HINT: Partial<Record<LinkType, string>> = {
  assessments: 'Assessments link evidence from the assessment item itself.',
  framework_controls: 'A framework requirement is linked when you press Link on an AI clause suggestion.',
};

function Row({ item, type, busy, onUnlink, onDetails }: { item: LinkedItem; type: LinkType; busy: boolean; onUnlink: (item: LinkedItem, type: LinkType) => void; onDetails: (c: ControlRef) => void }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[6px] border-b border-ds-border px-[12px] py-[10px] last:border-b-0">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <div className="flex flex-wrap items-center gap-[6px]">
          {item.code && <span className={`text-ds-label ${MUTED}`}>{item.code}</span>}
          {item.tag && <StatusPill size="sm" tone="neutral" label={item.tag.replace(/_/g, ' ')} />}
        </div>
        {item.control ? (
          <button
            type="button" onClick={() => onDetails(item.control!)} aria-label={`Details of ${item.code ?? item.title}: ${item.title}`}
            className="-mx-[6px] block max-w-full rounded-ds-control px-[6px] py-[2px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
          >
            <span dir="auto" className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{item.title}</span>
          </button>
        ) : (
          <p dir="auto" className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{item.title}</p>
        )}
        {item.subtitle && <p className={`break-words text-ds-label ${MUTED}`}>{item.subtitle}</p>}
        {!!item.chips?.length && (
          <ul className="m-0 mt-[4px] flex list-none flex-wrap gap-[4px] p-0" aria-label="Frameworks it fulfils requirements of">
            {item.chips.map((c) => (
              <li key={c.label} className="inline-flex items-center gap-[4px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[1px] text-ds-label text-ds-fg-body">
                {c.label}<span className="font-[600] text-ds-fg">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-[4px]">
        {item.control && <Button variant="link" size="sm" href={`/evidence?control=${encodeURIComponent(item.control.scfId)}&kind=common`}>All its evidence</Button>}
        {item.href && <Button variant="link" size="sm" href={item.href} rightIcon={<ExternalLink aria-hidden />}>Open</Button>}
        {item.unlink && <Button variant="ghost" size="sm" leftIcon={<Unlink aria-hidden />} disabled={busy} onClick={() => onUnlink(item, type)}>Unlink</Button>}
        {item.locked && <span title={item.locked} className={`text-ds-label ${MUTED}`}>Test sample</span>}
      </div>
    </li>
  );
}

export function LinkedTab({ evidenceId, controls, links, type, onType, onLinkRecords, onUnlink, unlinking, onDetails, aiReady, linking, onLink }: {
  evidenceId: number;
  controls: Source<ControlsResponse>;
  links: Source<AllLinks>;
  type: LinkType;
  onType: (t: LinkType) => void;
  onLinkRecords: (t: LinkType | null) => void;
  onUnlink: (item: LinkedItem, type: LinkType) => void;
  unlinking: boolean;
  onDetails: (c: ControlRef) => void;
  aiReady: boolean;
  linking: boolean;
  onLink: (req: LinkRequest) => void;
}) {
  const sourceOf = (t: LinkType) => (FROM_CONTROLS.includes(t) ? controls : links);
  const items = linkedItems(controls.data, links.data);
  const chips: FilterChip[] = LINK_TYPES.map((t) => {
    const s = sourceOf(t);
    return { key: t, label: LINK_LABEL[t], active: t === type, count: s.data ? items[t].length : undefined };
  });
  const source = sourceOf(type);
  const list = items[type];
  const summary = type === 'common_controls' ? coverageSummary(controls.data) : null;
  const canLinkType = (LINKABLE as readonly string[]).includes(type);
  const focus: SuggestTarget | null = (SUGGEST_TARGETS as readonly string[]).includes(type) ? (type as SuggestTarget) : null;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div className="min-w-0 flex-1 basis-[20rem]">
          <FilterChips label="Kinds of linked record" chips={chips} overflow="scroll" onToggle={(k) => onType(k as LinkType)} />
        </div>
        <Button variant="primary" leftIcon={<Link2 aria-hidden />} onClick={() => onLinkRecords(canLinkType ? type : null)}>Link records</Button>
      </div>

      <section aria-label={`${LINK_LABEL[type]} linked`} className="rounded-ds-card border border-ds-border bg-ds-surface">
        {source.isPending ? (
          <div className="p-[12px]"><SkeletonRows rows={4} columns={2} label="Loading what is linked" /></div>
        ) : source.isError && !source.data ? (
          <ErrorState compact title={`Couldn't load the ${LINK_LABEL[type].toLowerCase()}`} message={errorMessage(source.error)} onRetry={canRetry(source.error) ? () => { void source.refetch(); } : undefined} />
        ) : (
          <>
            {summary && <p className="border-b border-ds-border bg-ds-surface-hover px-[12px] py-[6px] text-ds-label text-ds-fg-body">{summary}</p>}
            {list.length === 0 ? (
              <div className="flex flex-col items-start gap-[8px] px-[12px] py-[16px]">
                <p className={`text-ds-body ${MUTED}`}>Nothing is linked yet. {HINT[type] ?? ''}</p>
                {canLinkType && <Button size="sm" leftIcon={<Link2 aria-hidden />} onClick={() => onLinkRecords(type)}>Link a {LINK_ONE[type]}</Button>}
              </div>
            ) : (
              <ul className="m-0 list-none p-0">{list.map((item) => <Row key={item.key} item={item} type={type} busy={unlinking} onUnlink={onUnlink} onDetails={onDetails} />)}</ul>
            )}
          </>
        )}
      </section>
      {(controls.isError || links.isError) && (controls.data || links.data) && (
        <Notice tone="warning" action={<Button size="sm" onClick={() => { if (controls.isError) void controls.refetch(); if (links.isError) void links.refetch(); }}>Retry</Button>}>
          Some of what is linked could not be loaded, so its count is left out.
        </Notice>
      )}

      <SuggestionsFeed evidenceId={evidenceId} controls={controls.data} links={links.data} aiReady={aiReady} focus={focus} linking={linking} onLink={onLink} onDetails={onDetails} />
    </div>
  );
}
