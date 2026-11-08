'use client';

// "Issues" on a record's page: the open issues linked to this vulnerability, risk, asset, control, project ... with the "Create issue" button for the same record. Drawn only for a person
// who may read issues (the server refuses everyone else; it used to say "No open issues" to them). The first five open issues, worst first, each with its severity, its state, how late
// it is and who has it; the counts are the server's totals over EVERY linked issue, "View all" opens the register filtered to this record, and the closed ones are shown on request.
// A request that failed says so with Retry: it is never drawn as "no issues". The props are the old panel's.
import { useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button, ErrorState, PersonChip, SkeletonRows, StatusPill, TitleLink,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { issueState } from '@/lib/statuses/issues';
import { severity } from '@/lib/statuses/monitoring';
import { usePermissions } from '@/hooks/usePermissions';
import { CreateIssueButton } from './CreateIssueButton';
import { fetchBySource } from './embedApi';
import { canCreateFrom, panelView, viewAllHref, type CreatableSource, type PanelRowView, type PanelSource, type Presets } from './embedModel';

export const VIEW_ISSUES = 'issue_management:issues:view';

interface Props {
  sourceType: PanelSource;
  sourceId: number;
  /** Optional title (defaults to "Issues"). */
  title?: string;
  /** Optional pre-fill for the Create issue button. */
  createFields?: Presets;
  /** The card without its box, for a nested tab. */
  compact?: boolean;
}

function Row({ row }: { row: PanelRowView }) {
  return (
    <li className="flex min-h-ds-control flex-wrap items-center gap-x-[8px] gap-y-[4px] border-b border-ds-border py-[6px] last:border-b-0">
      {row.code && <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted">{row.code}</span>}
      <TitleLink href={`/issues/${row.id}`} title={row.title} lines={2} className="min-w-0 flex-1 basis-[12rem]" />
      <div className="flex flex-wrap items-center gap-[6px]">
        <StatusPill size="sm" {...statusPill(severity, row.severity)} />
        <StatusPill size="sm" {...statusPill(issueState, row.state)} />
        {row.late && <StatusPill size="sm" tone="danger" label={row.late} />}
      </div>
      <PersonChip name={row.assignee} size={24} className="shrink-0" />
    </li>
  );
}

export function RelatedIssuesPanel({ sourceType, sourceId, title = 'Issues', createFields, compact = false }: Props) {
  const headingId = useId();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canView = hasPermission(VIEW_ISSUES);
  const [showClosed, setShowClosed] = useState(false);
  const issues = useQuery({
    queryKey: ['issues-by-source-panel', sourceType, sourceId, showClosed],
    queryFn: () => fetchBySource(sourceType, sourceId, showClosed),
    staleTime: 15_000,
    retry: 1,                                                               // one more try, then say so (three tries kept the card on its skeleton for seven seconds)
    enabled: !!sourceId && canView,
    placeholderData: keepPreviousData,                                      // "Show closed" does not blank the card while it reads
  });

  if (!permissionsLoading && !canView) return null;                         // the server would refuse: nothing is drawn rather than a false "no issues"
  const view = issues.data ? panelView(issues.data, Date.now()) : null;

  return (
    <section aria-labelledby={headingId} className={compact ? 'min-w-0' : 'min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]'}>
      <div className="mb-[12px] flex flex-wrap items-center gap-x-[8px] gap-y-[8px]">
        <h3 id={headingId} className="min-w-0 break-words !text-ds-section !text-ds-fg">{title}</h3>
        {view && view.totalOpen > 0 && <StatusPill size="sm" tone="neutral" label={`${formatCount(view.totalOpen)} open`} />}
        {view && view.criticalOpen > 0 && <StatusPill size="sm" tone="danger" label={`${formatCount(view.criticalOpen)} critical`} />}
        {canCreateFrom(sourceType) && (
          <div className="ml-auto">
            <CreateIssueButton sourceType={sourceType as CreatableSource} sourceId={sourceId} presetFields={createFields} />
          </div>
        )}
      </div>

      {permissionsLoading || issues.isLoading ? (
        <SkeletonRows rows={2} columns={3} label="Loading issues" />
      ) : issues.isError || !view ? (
        <ErrorState compact title="Couldn't load the issues" message={errorMessage(issues.error)} onRetry={() => { void issues.refetch(); }} />
      ) : (
        <>
          {view.rows.length === 0 ? (
            <p className="py-[8px] text-ds-body text-ds-fg-muted">No open issues.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {view.rows.map((r) => <Row key={r.id} row={r} />)}
            </ul>
          )}
          {(view.totalOpen > 0 || view.totalClosed > 0) && (
            <div className="mt-[8px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
              {view.totalOpen > 0 && (
                <Button variant="link" size="sm" href={viewAllHref(sourceType, sourceId)}>
                  {view.hidden > 0 ? `View all ${formatCount(view.totalOpen)} in the register` : 'Open in the register'}
                </Button>
              )}
              {view.totalClosed > 0 && (
                <Button variant="ghost" size="sm" aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
                  {showClosed ? 'Hide closed' : `Show closed (${formatCount(view.totalClosed)})`}
                </Button>
              )}
            </div>
          )}
          {showClosed && view.closedRows.length > 0 && (
            <div className="mt-[8px]">
              <p className="mb-[2px] text-ds-label font-[600] text-ds-fg-muted">Closed</p>
              <ul className="m-0 flex list-none flex-col p-0">
                {view.closedRows.map((r) => <Row key={r.id} row={r} />)}
              </ul>
              {view.totalClosed > view.closedRows.length && (
                <p className="mt-[4px] text-ds-label text-ds-fg-muted">Showing {formatCount(view.closedRows.length)} of {formatCount(view.totalClosed)} closed. The rest are in the register.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

