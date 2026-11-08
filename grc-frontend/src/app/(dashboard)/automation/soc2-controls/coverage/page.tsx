'use client';

// Requirement coverage: every requirement of every framework and what accounts for it. A bare "95% mapped" leaves the other 5% unexplained, which is the first thing an assessor asks about. Most unmapped
// requirements are not gaps: they bind the regulator, the exchange operator or a supervisory authority, and no control the organisation implements can discharge them. Each one carries its disposition and the
// written reason, so the shortfall is auditable. The figures are the server's (GET /automation/common/coverage, across every framework in the catalogue, not only the ones in scope). It sits on the
// Controls strip with Controls and Mapping review.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { AccordionRow, ClampedText, EmptyState, ErrorState, SkeletonRows, StatTile, StatusPill, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { automationApi } from '@/lib/api';
import { formatCount, formatDateTime } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import { requirementDisposition } from '@/lib/statuses/controls';
import { ControlsStrip } from '../_explorer/ControlsStrip';
import { StatusBar } from '../_explorer/StatusBar';
import { DISPOSITIONS, isAccounted, matchWords, matchingUnmapped, orderedFrameworks, totalInferred, type Coverage, type Disposition, type FrameworkCoverage } from './coverageModel';

const wordOf = (data: Coverage, d: Disposition): string => data.labels?.[d] || requirementDisposition.label(d);

function FrameworkRow({ fw, data, query }: { fw: FrameworkCoverage; data: Coverage; query: string }) {
  const rows = useMemo(() => matchingUnmapped(fw, query), [fw, query]);
  const match = matchWords(fw);
  const accounted = isAccounted(fw);
  const parts = DISPOSITIONS.map((d) => ({ key: d, label: wordOf(data, d), value: fw.counts[d] || 0, tone: requirementDisposition.tone(d) }));
  return (
    <AccordionRow
      title={fw.label}
      meta={`${formatCount(fw.total)} requirements · ${fw.mapped_pct}% mapped · ${match.text}`}
      disabled={fw.unmapped.length === 0}
      region={false}
      trailing={(
        <span className="flex items-center gap-[10px]">
          <span className="hidden w-[120px] sm:block"><StatusBar label={fw.label} total={fw.total} parts={parts} /></span>
          <StatusPill size="sm" tone={accounted ? 'success' : 'warning'} label={accounted ? 'All accounted for' : `${formatCount(fw.counts.pending)} to assess`} />
        </span>
      )}
    >
      <p className="m-0 mb-[8px] text-ds-label font-[600] text-ds-fg-muted">{`${formatCount(rows.length)} ${rows.length === 1 ? 'requirement' : 'requirements'} with no control${query.trim() ? ' match the search' : ''}`}</p>
      <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
        {rows.map((u) => (
          <li key={u.code} className="rounded-ds-card border border-ds-border bg-ds-surface p-[10px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <span className="rounded-ds-control bg-ds-surface-hover px-[6px] py-[1px] font-mono text-ds-label font-[600] text-ds-fg-body">{u.reference}</span>
              <StatusPill size="sm" tone={requirementDisposition.tone(u.disposition)} label={wordOf(data, u.disposition)} />
            </div>
            {u.title && <p className="m-0 mt-[6px] text-ds-body font-[600] text-ds-fg">{u.title}</p>}
            {u.reason && <ClampedText className="mt-[4px]" text={u.reason} lines={3} />}
          </li>
        ))}
        {rows.length === 0 && <li className="text-ds-body text-ds-fg-muted">No requirement matches this search.</li>}
      </ul>
    </AccordionRow>
  );
}

export default function CoveragePage() {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['automation-coverage'],
    queryFn: () => automationApi.getRequirementCoverage().then((r) => r.data as Coverage),
    retry: (failures, e) => failures < 3 && canRetry(e),
  });
  const data = q.data;
  const frameworks = useMemo(() => orderedFrameworks(data?.frameworks ?? []), [data]);
  const title = titleFor('/automation/soc2-controls/coverage') ?? 'Requirement coverage';
  const notBuilt = q.isError && !data && (statusOf(q.error) === 404 || statusOf(q.error) === 409 || statusOf(q.error) === 503);
  const pending = data?.counts.pending ?? 0;

  return (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={title}
        info="Every requirement of every framework, and what accounts for it. A requirement with no control is not automatically a gap: most bind the regulator or the exchange operator, and no control you implement can discharge them."
        meta={data ? `${formatCount(data.total)} requirements across ${formatCount(data.frameworks.length)} frameworks` : undefined}
      />
      <ControlsStrip current="coverage" />

      {q.isPending && <SkeletonRows rows={6} columns={4} label="Loading the coverage" />}
      {q.isError && !data && (
        <ErrorState
          title={notBuilt ? 'Coverage has not been worked out yet' : 'Couldn’t load the coverage'}
          message={notBuilt ? 'The requirements of this release have not been classified yet. Ask an administrator to build them.' : errorMessage(q.error)}
          onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined}
        />
      )}

      {data && (
        <>
          <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Mapped to a control" value={`${data.mapped_pct}%`} note={`${formatCount(data.counts.mapped)} of ${formatCount(data.total)}`} />
            <StatTile label="Accounted for" value={`${data.accounted_pct}%`} tone={pending ? 'default' : 'success'} note={pending ? `${formatCount(pending)} still to assess` : 'no requirement is unexplained'} />
            <StatTile label={wordOf(data, 'other_party')} value={formatCount(data.counts.other_party)} note="the regulator, the operator or an authority" />
            <StatTile label="Matched by roll-up" value={formatCount(totalInferred(data.frameworks))} note={`inferred, not matched on the code · ${formatCount(data.counts.out_of_scope)} outside the catalogue`} />
          </div>

          <div className="flex flex-wrap items-center gap-[8px]" role="search" aria-label="Search the unmapped requirements">
            <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the requirements with no control" placeholder="Search a requirement or a reason" autoComplete="off" className="min-w-[200px] max-w-[360px] flex-1" leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />} />
            <ul aria-label="Dispositions" className="m-0 flex list-none flex-wrap items-center gap-[6px] p-0">
              {DISPOSITIONS.map((d) => <li key={d}><StatusPill size="sm" tone={requirementDisposition.tone(d)} label={`${wordOf(data, d)} · ${formatCount(data.counts[d])}`} /></li>)}
            </ul>
          </div>

          {frameworks.length === 0 ? (
            <EmptyState kind="firstUse" title="No frameworks to show" description="No framework has been mapped to the control catalogue yet." />
          ) : (
            <div className="overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
              {frameworks.map((fw) => <FrameworkRow key={fw.key} fw={fw} data={data} query={search} />)}
            </div>
          )}

          <p className="m-0 text-ds-label text-ds-fg-muted">{`Worked out ${formatDateTime(data.generated)}. Each classification records the rule that produced it, so any row can be traced to the phrase it was matched on.`}</p>
        </>
      )}
    </div>
  );
}
