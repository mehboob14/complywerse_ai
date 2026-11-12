'use client';

// The graphic of the frameworks (the Departments view): where the attention sits, a heat table of the four kinds of attention (overdue reviews, documents waiting for
// approval, documents expiring within 30 days, exceptions) against the weakest frameworks. It reads the posture aggregate the page already asks for (true totals over
// every document the person may read, weakest group first) and draws the weakest few: the table beside it (Groups.tsx) lists every framework and opens each. A refusal
// is "No access", a failure says so with Retry, and a group list that is empty says what fills it. Frameworks are the whole organisation's, whatever department is picked.
import { Heatmap, ChartCard } from '@/components/overview/charts';
import { useNarrow } from '@/components/overview/useNarrow';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { isRefused } from './overviewModel';
import { link } from './parts';
import type { PostureQuery } from './postureApi';
import { groupNoun } from './postureModel';
import { ATTENTION_COLUMNS, GROUP_BARS, groupHeat, groupsDrawn, wholeOrganisation } from './visualsModel';

const rowsOf = (q: PostureQuery) => q.data?.pages.flatMap((p) => p.rows) ?? [];

export function AttentionHeatCard({ query, scoped }: { query: PostureQuery; scoped: boolean }) {
  const narrow = useNarrow();
  const first = query.data?.pages[0];
  const heat = groupHeat(rowsOf(query), 'framework', GROUP_BARS, narrow ? 18 : 30);
  const noun = groupNoun('framework', 2);
  const empty = `No ${noun} yet. Documents mapped to a framework appear here.`;
  const state = query.isPending ? ({ state: 'loading' } as const)
    : query.isError && !first ? (isRefused(query.error)
      ? ({ state: 'denied', deniedText: 'Your account cannot read the documents of the programme.' } as const)
      : ({ state: 'error', error: { message: errorMessage(query.error), onRetry: canRetry(query.error) ? () => { void query.refetch(); } : undefined } } as const))
      : ({ state: !first || heat.rows.length === 0 ? 'empty' : 'ready', emptyText: empty } as const);
  const said = wholeOrganisation(scoped, `${first?.notes.needs_attention ?? 'Overdue reviews, documents waiting for review or approval, documents expiring within 30 days, and exceptions waiting for a decision or about to lapse, for each framework.'} Columns: ${ATTENTION_COLUMNS.map((c) => c.noun).join(', ')}. A number opens the documents it counts; exceptions have no list.`);
  return (
    <ChartCard
      id="attention-map"
      title="Where attention sits"
      meta={[state.state === 'ready' && first ? groupsDrawn(heat.rows.length, first.total, noun) : '', said.meta].filter(Boolean).join(' · ') || undefined}
      info={said.info}
      {...state}
      loadingHeight={280}
    >
      <Heatmap
        label="Where attention sits by framework"
        rowTitle="Framework"
        colTitle="Needs attention"
        rows={heat.rows}
        cols={heat.cols}
        cells={heat.cells}
        href={(r, c) => { const h = heat.hrefs[r]?.[c]; return h ? link(h) : undefined; }}
        noun="items"
      />
    </ChartCard>
  );
}
