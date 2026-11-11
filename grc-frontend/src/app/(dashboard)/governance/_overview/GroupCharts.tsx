'use client';

// The two graphics of the groups (per framework or per department, the Overview's own pivot): how the review dates of each group's documents stand (stacked bars:
// on time, due in 30 days, overdue, no date) and where the attention sits (a heat table of the four kinds of attention against the same groups). Both read the
// posture aggregate the page already asks for (true totals over every document the person may read, weakest group first) and draw the weakest few: the table
// under them lists every group and opens each. A refusal is "No access", a failure says so with Retry, and a group list that is empty says what fills it.
import { Heatmap, ChartCard, StackedBars } from '@/components/overview/charts';
import { useNarrow } from '@/components/overview/useNarrow';
import { SegmentedControl } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { isRefused } from './overviewModel';
import { link } from './parts';
import type { PostureQuery } from './postureApi';
import { groupNoun, type GroupBy } from './postureModel';
import { ATTENTION_COLUMNS, GROUP_BARS, REVIEW_SERIES, groupHeat, groupStacks, groupsDrawn, hasReviewBars } from './visualsModel';

function stateOf(q: PostureQuery, by: GroupBy, empty: boolean) {
  if (q.isPending) return { state: 'loading' as const };
  const first = q.data?.pages[0];
  if (q.isError && !first) {
    if (isRefused(q.error)) return { state: 'denied' as const, deniedText: 'Your account cannot read the documents of the programme.' };
    return { state: 'error' as const, error: { message: errorMessage(q.error), onRetry: canRetry(q.error) ? () => { void q.refetch(); } : undefined } };
  }
  return { state: empty ? ('empty' as const) : ('ready' as const), emptyText: `No ${groupNoun(by, 2)} yet. Documents ${by === 'framework' ? 'mapped to a framework' : 'filed under a department'} appear here.` };
}

const rowsOf = (q: PostureQuery) => q.data?.pages.flatMap((p) => p.rows) ?? [];

export function ReviewHealthCard({ query, by, onBy }: { query: PostureQuery; by: GroupBy; onBy: (next: GroupBy) => void }) {
  const narrow = useNarrow();
  const first = query.data?.pages[0];
  const stacks = groupStacks(rowsOf(query), by);
  const s = stateOf(query, by, !first || stacks.length === 0 || !hasReviewBars(stacks));
  const noun = groupNoun(by, 2);
  return (
    <ChartCard
      id="review-health"
      title="Review health"
      meta={s.state === 'ready' && first ? groupsDrawn(stacks.length, first.total, noun) : undefined}
      info={first?.notes.review_health ?? 'Where the review dates of each group stand, on the documents a review is owed on, weakest group first.'}
      actions={(
        <SegmentedControl<GroupBy>
          label="Group the charts by" name="charts-by" value={by} onChange={onBy}
          options={[{ value: 'framework', label: 'Framework' }, { value: 'department', label: 'Department' }]}
        />
      )}
      {...s}
      loadingHeight={280}
    >
      <StackedBars
        label={`Review health by ${by}`}
        firstColumn={by === 'framework' ? 'Framework' : 'Department'}
        categories={stacks.map((x) => ({ key: x.key, label: x.label, cells: x.cells, href: link(x.href) }))}
        series={REVIEW_SERIES.map((x) => ({ key: x.key, label: x.label, color: x.color }))}
        nameWidth={narrow ? 100 : 150}
      />
    </ChartCard>
  );
}

export function AttentionHeatCard({ query, by }: { query: PostureQuery; by: GroupBy }) {
  const narrow = useNarrow();
  const first = query.data?.pages[0];
  const heat = groupHeat(rowsOf(query), by, GROUP_BARS, narrow ? 18 : 30);
  const s = stateOf(query, by, !first || heat.rows.length === 0);
  const noun = groupNoun(by, 2);
  return (
    <ChartCard
      id="attention-map"
      title="Where attention sits"
      meta={s.state === 'ready' && first ? groupsDrawn(heat.rows.length, first.total, noun) : undefined}
      info={`${first?.notes.needs_attention ?? 'Overdue reviews, documents waiting for review or approval, documents expiring within 30 days, and exceptions waiting for a decision or about to lapse, for each group.'} Columns: ${ATTENTION_COLUMNS.map((c) => c.noun).join(', ')}. A number opens the documents it counts; exceptions have no list.`}
      {...s}
      loadingHeight={280}
    >
      <Heatmap
        label={`Where attention sits by ${by}`}
        rowTitle={by === 'framework' ? 'Framework' : 'Department'}
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
