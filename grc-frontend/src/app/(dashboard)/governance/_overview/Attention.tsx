'use client';

// "Needs attention": all eight counters of the scorecard, each with its label, its number and a link to where its records are (the table is
// ATTENTION in overviewModel.ts, with what each destination can and cannot filter). A counter loads, fails and has nothing on its own:
// a skeleton while it loads, "Unavailable" with Retry when its request failed (never 0), a dash when the answer carries nothing for it.
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Button, ErrorState, SectionCard, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EMPTY, formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { ATTENTION, allUnavailable, attentionTotal, counterFor, type Attention, type AttentionSources, type Counter, type SourceName } from './overviewModel';
import { FOCUS, type Feed } from './parts';

export type AttentionFeeds = { [K in SourceName]: Feed<NonNullable<AttentionSources[K]['data']>> };

const ROW = 'flex min-h-ds-control items-center justify-between gap-[8px] rounded-ds-control px-[8px] py-[4px]';
const LABEL = 'min-w-0 break-words text-ds-body text-ds-fg';

/** The tone of a counter above 0 (a reading aid: the label and the number carry the meaning); a hollow ring while it is 0 or unknown. */
function Dot({ def, lit }: { def: Attention; lit: boolean }) {
  return <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={lit ? { background: TONE[def.tone].dot } : { boxShadow: 'inset 0 0 0 1px var(--ds-border-strong)' }} />;
}

function Name({ def, lit }: { def: Attention; lit: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-[8px]">
      <Dot def={def} lit={lit} />
      <span className={LABEL}>{def.label}</span>
    </span>
  );
}

function Row({ def, counter, retry, canAsk }: { def: Attention; counter: Counter; retry: (names: SourceName[]) => void; canAsk: (names: SourceName[]) => boolean }) {
  if (counter.state === 'ready') {
    return (
      <Link href={def.href} aria-label={`${def.label}: ${formatCount(counter.value)}`} className={`${ROW} hover:bg-ds-surface-hover ${FOCUS}`}>
        <Name def={def} lit={counter.value > 0} />
        <span className="flex shrink-0 items-center gap-[4px]">
          <span className={`text-ds-body font-[600] tabular-nums ${counter.value > 0 ? 'text-ds-fg' : 'text-ds-fg-muted'}`}>{formatCount(counter.value)}</span>
          <ChevronRight aria-hidden className="h-[16px] w-[16px] text-ds-fg-muted" strokeWidth={1.75} />
        </span>
      </Link>
    );
  }
  if (counter.state === 'error') {
    const names = counter.retry;
    return (
      <div className={`${ROW} items-start`}>
        <div className="min-w-0">
          <Name def={def} lit={false} />
          <div className="ml-[16px] flex items-center gap-[4px]">
            <span className="text-ds-label text-ds-fg-muted">Unavailable</span>
            {canAsk(names) && <Button variant="link" size="sm" onClick={() => retry(names)} aria-label={`Retry: ${def.label}`}>Retry</Button>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={ROW}>
      <Name def={def} lit={false} />
      {counter.state === 'loading' ? <Skeleton className="h-[16px] w-[28px]" /> : <span className="text-ds-body text-ds-fg-muted" title="Not recorded">{EMPTY}</span>}
    </div>
  );
}

export function AttentionCard({ feeds }: { feeds: AttentionFeeds }) {
  const sources: AttentionSources = feeds;
  const counters = ATTENTION.map((def) => ({ def, counter: counterFor(def, sources) }));
  const total = attentionTotal(sources);
  const retry = (names: SourceName[]) => names.forEach((name) => feeds[name].retry());
  const canAsk = (names: SourceName[]) => names.some((name) => canRetry(feeds[name].error));
  const busy = counters.some((c) => c.counter.state === 'loading');
  const failed = feeds.scorecard.error;
  return (
    <SectionCard
      id="attention"
      title="Needs attention"
      info="Each count opens the records it counts, or the page that lists them."
      meta={
        total.state === 'ready' ? `${formatCount(total.value)} in total`
          : total.state === 'loading' ? <Skeleton className="inline-block h-[14px] w-[72px] align-middle" />
          : total.state === 'error' ? 'Total unavailable' : undefined
      }
    >
      {allUnavailable(counters.map((c) => c.counter)) ? (
        <ErrorState
          compact
          title="Couldn't load what needs attention"
          message={errorMessage(failed)}
          onRetry={canRetry(failed) ? () => retry(['scorecard', 'pending', 'overdue', 'expiring', 'exceptions']) : undefined}
        />
      ) : (
        <ul aria-busy={busy || undefined} className="grid gap-x-[16px] sm:grid-cols-2 xl:grid-cols-4">
          {counters.map(({ def, counter }) => (
            <li key={def.key} className="min-w-0 border-b border-ds-border last:border-b-0 sm:border-b-0">
              <Row def={def} counter={counter} retry={retry} canAsk={canAsk} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
