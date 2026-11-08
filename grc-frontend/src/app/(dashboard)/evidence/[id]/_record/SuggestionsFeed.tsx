'use client';

// Suggestions for the Linked tab: ONE list that every kind of record fans out into, the best match first (linkModel.offered). The common-control one is a rule, not a model (it asks the
// control library which controls want a document like this one) and runs as soon as the tab opens; the others are the AI's and wait until the file has a rating (or the review is over
// without one: they can still match on its name and description), exactly as they did on the old page. Each suggestion can be linked, dismissed (for this visit) or, for a common
// control, opened. "Link N strong matches" sends the ones at 80% and over, one request per kind. A suggestion that failed to load says so with a way to ask again.
import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import apiClient from '@/lib/api';
import { Button, ClampedText, Notice, SectionCard, StatusPill } from '@/components/ui/ds';
import {
  IMMEDIATE, SUGGEST_TARGETS, TARGET_LABEL, bandOf, linkedIdsOf, matchPct, offered, strongByTarget, suggestionCounts, type Offered, type Suggestion, type SuggestTarget,
} from './linkModel';
import type { LinkRequest } from './recordActions';
import type { AllLinks, ControlsResponse } from './recordTypes';
import type { ControlRef } from './ControlDetails';

const MUTED = 'text-ds-fg-muted';
const BAND = { strong: 'success', fair: 'warning', weak: 'neutral' } as const;

/** What linking one suggestion sends. */
function requestFor(target: SuggestTarget, recs: readonly Suggestion[]): LinkRequest | null {
  switch (target) {
    case 'common_controls': {
      const withId = recs.filter((r) => r.meta?.scf_id);
      return withId.length ? { kind: 'common_controls', recs: withId.map((r) => ({ scfId: r.meta!.scf_id!, artifactName: r.meta?.artifact_name ?? null })) } : null;
    }
    case 'audit_observations':
      return { kind: 'audit_observations', recs: recs.map((r) => ({ auditKind: r.meta?.kind === 'issue' ? 'issue' : 'observation', recordId: r.meta?.record_id ?? Math.abs(r.id) })) };
    default:
      return { kind: target, ids: recs.map((r) => r.id) };
  }
}

export function SuggestionsFeed({ evidenceId, controls, links, aiReady, focus, linking, onLink, onDetails }: {
  evidenceId: number;
  controls: ControlsResponse | undefined;
  links: AllLinks | undefined;
  /** the file has a rating (or the review is over without one): the AI's suggestions may run */
  aiReady: boolean;
  /** the kind chosen in the strip, when it is one the feed has: only its suggestions show */
  focus: SuggestTarget | null;
  linking: boolean;
  onLink: (req: LinkRequest) => void;
  onDetails: (control: ControlRef) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const results = useQueries({
    queries: SUGGEST_TARGETS.map((target) => ({
      queryKey: ['evidence-ai-suggest', evidenceId, target, aiReady || IMMEDIATE.includes(target) ? 1 : 0],
      queryFn: async () => (await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/recommend-links`, null, { params: { target } })).data as { recommendations: Suggestion[]; ai_available: boolean },
      enabled: aiReady || IMMEDIATE.includes(target),
      staleTime: Infinity,
      retry: false,
    })),
  });

  const anyLoading = results.some((q) => q.isFetching);
  const started = aiReady || results.some((q) => q.isFetching || !!q.data);
  const failed = results.some((q) => q.isError);
  const allFailed = results.length > 0 && results.filter((_, i) => aiReady || IMMEDIATE.includes(SUGGEST_TARGETS[i])).every((q) => q.isError);

  const all = useMemo(() => offered(
    SUGGEST_TARGETS.map((target, i) => ({ target, recs: results[i].data?.recommendations, linked: linkedIdsOf(target, controls, links) })), dismissed,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [results.map((q) => q.dataUpdatedAt).join(','), controls, links, dismissed]);
  const counts = suggestionCounts(all);
  const visible: Offered[] = focus ? all.filter((o) => o.target === focus) : all;
  const strong = strongByTarget(visible);
  const strongCount = Array.from(strong.values()).reduce((n, list) => n + list.length, 0);

  const linkStrong = () => strong.forEach((recs, target) => { const req = requestFor(target, recs); if (req) onLink(req); });
  const rerun = () => results.forEach((q) => { void q.refetch(); });
  const dismiss = (o: Offered) => setDismissed((prev) => new Set(prev).add(`${o.target}:${o.rec.id}`));

  return (
    <SectionCard
      id="suggestions" title="Suggestions"
      info="Where this file could be used, found for you. Check each one before you link it."
      meta={<span className="inline-flex items-center gap-[6px]">{visible.length > 0 ? `${visible.length} to review` : null}{anyLoading && <Loader2 aria-hidden className="h-[14px] w-[14px] animate-spin motion-reduce:animate-none" />}</span>}
      actions={strongCount > 0
        ? <Button variant="primary" size="sm" leftIcon={<Sparkles aria-hidden />} loading={linking} onClick={linkStrong}>Link {strongCount} strong {strongCount === 1 ? 'match' : 'matches'}</Button>
        : started ? <Button variant="link" size="sm" disabled={anyLoading} onClick={rerun}>Look again</Button> : undefined}
    >
      <div className="flex flex-col gap-[8px]">
        {failed && !allFailed && <Notice tone="warning" action={<Button size="sm" onClick={rerun}>Look again</Button>}>Some suggestions could not be loaded.</Notice>}
        {allFailed ? (
          <Notice tone="warning" title="Suggestions could not be loaded" action={<Button size="sm" onClick={rerun}>Try again</Button>}>Nothing was linked or changed.</Notice>
        ) : !started ? (
          <p className={`text-ds-body ${MUTED}`}>Suggestions appear here once the file has been rated.</p>
        ) : anyLoading && visible.length === 0 ? (
          <p role="status" className={`flex items-center gap-[8px] text-ds-body ${MUTED}`}><Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin motion-reduce:animate-none" />Looking for matches…</p>
        ) : visible.length === 0 ? (
          <p className={`text-ds-body ${MUTED}`}>{focus ? 'No suggestions for this kind of record.' : 'No strong matches found.'}</p>
        ) : (
          <>
            {!focus && Object.keys(counts).length > 1 && (
              <p className={`text-ds-label ${MUTED}`}>{SUGGEST_TARGETS.filter((t) => counts[t]).map((t) => `${TARGET_LABEL[t]} ${counts[t]}`).join(' · ')}</p>
            )}
            <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
              {visible.map((o) => {
                const pct = matchPct(o.rec.confidence);
                const req = requestFor(o.target, [o.rec]);
                return (
                  <li key={`${o.target}-${o.rec.id}`} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]">
                    <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[6px]">
                      <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
                        <StatusPill size="sm" tone="progress" label={TARGET_LABEL[o.target]} />
                        {o.rec.code && <span className={`text-ds-label ${MUTED}`}>{o.rec.code}</span>}
                        <StatusPill size="sm" tone={BAND[bandOf(pct)]} label={`${pct}% match`} />
                      </div>
                      <div className="flex flex-wrap items-center gap-[4px]">
                        {o.target === 'common_controls' && o.rec.meta?.scf_id && (
                          <Button variant="link" size="sm" onClick={() => onDetails({ scfId: o.rec.meta!.scf_id!, title: o.rec.title })}>Details</Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => dismiss(o)}>Dismiss</Button>
                        <Button variant="primary" size="sm" disabled={linking || !req} onClick={() => { if (req) onLink(req); }}>Link</Button>
                      </div>
                    </div>
                    {o.rec.title && <p dir="auto" className="mt-[6px] break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{o.rec.title}</p>}
                    {o.rec.subtitle && <p className={`break-words text-ds-label ${MUTED}`}>{o.rec.subtitle}</p>}
                    {o.rec.rationale && <ClampedText className="mt-[2px]" text={o.rec.rationale} lines={2} />}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </SectionCard>
  );
}
