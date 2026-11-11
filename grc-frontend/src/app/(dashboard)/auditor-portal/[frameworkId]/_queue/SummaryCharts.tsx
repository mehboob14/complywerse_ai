'use client';

// The two graphs of a journey's Summary tab: its files by decision and its requirements by scope. They read the counts the queue already loaded (nothing more is asked), so they agree
// with the chips of the queue; a part with something in it opens the list it counts. The old Overview of this page drew gauges; these are the same facts as lists you can follow.
import type { UseQueryResult } from '@tanstack/react-query';
import { Cell, ChartCard, ChartGrid, DonutChart } from '@/components/overview/charts';
import { formatCount } from '@/lib/format';
import { journeyFileSlices, journeyScopeSlices } from '@/lib/auditorPortal/frontModel';
import type { QueuePayload } from '@/lib/auditorPortal/portalModel';
import { cardState } from '../../_front/cardState';

export function SummaryCharts({ journeyId, queue }: { journeyId: number; queue: UseQueryResult<QueuePayload, Error> }) {
  const counts = queue.data?.counts;
  const files = journeyFileSlices(journeyId, counts?.files);
  const scope = journeyScopeSlices(journeyId, counts);
  const filesTotal = counts?.files.total ?? 0;
  const requirements = counts ? counts.scope.total + counts.untouched : 0;
  return (
    <ChartGrid>
      <Cell span={6}>
        <ChartCard
          id="summary-files"
          title="Files by decision"
          meta={counts ? `${formatCount(filesTotal)} sent` : undefined}
          info="Every file sent for review on this journey: approved, turned down, or still waiting for an auditor. Approved and turned down open the Decisions tab, waiting opens the queue."
          loadingHeight={160}
          {...cardState(queue, !files || filesTotal === 0)}
          emptyText="No file has been sent for review yet. Files appear here once they are."
        >
          {files && <DonutChart label="Files by decision" slices={files} centre={{ value: formatCount(filesTotal), caption: 'files' }} noun="files" />}
        </ChartCard>
      </Cell>
      <Cell span={6}>
        <ChartCard
          id="scope"
          title="Requirements by scope"
          meta={counts ? `${formatCount(requirements)} requirements` : undefined}
          info="Every requirement of this journey's framework by where its scope decision stands. A request waits until a reviewer decides it; the requirement stays as it is until then."
          loadingHeight={160}
          {...cardState(queue, !scope || requirements === 0)}
          emptyText="No requirements yet. They appear here once the framework has some."
        >
          {scope && <DonutChart label="Requirements by scope decision" slices={scope} centre={{ value: formatCount(requirements), caption: 'in all' }} noun="requirements" />}
        </ChartCard>
      </Cell>
    </ChartGrid>
  );
}
