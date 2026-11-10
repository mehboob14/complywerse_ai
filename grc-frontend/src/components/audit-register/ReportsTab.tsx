'use client';

// The Reports tab: one line for every audit report or exam, and how its findings stand (open, past due, closed, when the next one is due and who owns them). A line opens to its findings; from it
// Audit Services (the create right) add a finding on that report, anyone can show the report's findings in the Register, and Manage reports leads to the list the report is picked from (Setup).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, EmptyState, RegisterTable, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate, moreCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { findingStatus } from '@/lib/statuses/auditRegister';
import { can, type RegisterRights } from '@/lib/auditRegister/rights';
import { dueOf, ownerName, referenceOf, type RegisterRow } from '@/lib/auditRegister/registerDef';

type ReportLine = {
  source: string; source_title: string; key: string | null; report: string; report_number: string | null; report_date: string | null; regulator: string | null;
  findings: number; issues: number; recommendations: number; open: number; closed: number; past_due: number; statuses: Record<string, number>;
  next_due: string | null; owners: string[]; template: string | null; prefill: Record<string, unknown>;
};
const idOf = (r: ReportLine): string => `${r.source}|${r.key ?? r.report}`;
const nameOf = (r: ReportLine): string => `${r.regulator ? `${r.regulator} · ` : ''}${r.report}${r.report_number && r.report_number !== r.report ? ` (${r.report_number})` : ''}`;
const muted = 'text-ds-fg-muted';

export function ReportsTab({ rows, rights, onOpen, onAdd, onShow, onManage }: {
  rows: readonly RegisterRow[]; rights: RegisterRights; onOpen: (issueId: number) => void;
  onAdd: (template: string | null, prefill: Record<string, unknown>) => void; onShow: (line: { source: string; key: string | null; report: string }) => void; onManage?: () => void;
}) {
  const [open, setOpen] = useState<Array<string | number>>([]);
  const reports = useQuery<ReportLine[]>({
    queryKey: ['audit-register-reports'],
    queryFn: async () => (await auditRegisterApi.reports()).data as ReportLine[],
  });
  const byReport = useMemo(() => {
    const m = new Map<string, RegisterRow[]>();
    rows.forEach((r) => { const k = `${r.source}|${r.report_key ?? ''}`; m.set(k, (m.get(k) ?? []).concat(r)); });
    return m;
  }, [rows]);
  const canAdd = can(rights, 'addFinding');
  const add = (r: ReportLine) => (r.template && canAdd ? <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => onAdd(r.template, r.prefill)}>Add a finding</Button> : null);

  const columns: RegisterColumn<ReportLine>[] = [
    { key: 'report', header: 'Report', isRowHeader: true, cell: (r) => <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]" title={nameOf(r)}>{nameOf(r)}</span>, card: 'hide' },
    { key: 'source', header: 'Source', priority: 2, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{r.source_title}</span>, card: 'meta' },
    { key: 'date', header: 'Report date', priority: 3, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.report_date, { calendar: true })}</span>, card: 'hide' },
    { key: 'findings', header: 'Findings', align: 'right', cell: (r) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(r.issues)}{r.recommendations ? <span className={muted}> + {formatCount(r.recommendations)} recommendations</span> : null}</span>, card: 'meta' },
    { key: 'open', header: 'Open', align: 'right', cell: (r) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(r.open)}</span>, card: 'meta' },
    { key: 'past', header: 'Past due', align: 'right', cell: (r) => <span className={`tabular-nums text-ds-body ${r.past_due ? 'font-[600] text-ds-danger' : muted}`}>{formatCount(r.past_due)}</span>, card: 'meta' },
    { key: 'closed', header: 'Closed', align: 'right', priority: 3, cell: (r) => <span className="tabular-nums text-ds-body text-ds-fg-body">{formatCount(r.closed)}</span>, card: 'hide' },
    { key: 'next', header: 'Next due', priority: 2, cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.next_due, { calendar: true })}</span>, card: 'meta' },
    {
      key: 'owners', header: 'Owners', priority: 3, card: 'meta',
      cell: (r) => { const o = moreCount(r.owners, 2); return <span className="block max-w-[240px] truncate text-ds-body text-ds-fg-body" title={r.owners.join(', ')}>{o.shown.join(', ') || '—'}{o.more ? ` +${o.more}` : ''}</span>; },
    },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className={`m-0 text-ds-body ${muted}`}>Every audit report and exam, with how its findings stand. Open a report to see its findings.</p>
        {onManage && <Button onClick={onManage}>Manage reports</Button>}
      </div>
      <RegisterTable<ReportLine>
        caption="Audit reports and exams"
        rows={reports.data ?? []}
        getRowId={idOf}
        loading={reports.isLoading}
        error={reports.isError ? { message: errorMessage(reports.error), onRetry: () => { void reports.refetch(); } } : null}
        empty={<EmptyState bare kind="firstUse" title="No reports yet" description="Add the first one, or upload the workbook." />}
        columns={columns}
        cardTitle={(r) => <span className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{nameOf(r)}</span>}
        cardActions={undefined}
        expand={{
          open, onChange: setOpen, label: (r) => `Details of ${nameOf(r)}`,
          render: (r) => {
            const mine = byReport.get(`${r.source}|${r.key ?? ''}`) ?? [];
            return (
              <div className="flex flex-col gap-[8px]">
                {mine.length === 0 ? <p className={`m-0 text-ds-body ${muted}`}>No findings are listed on this report.</p> : (
                  <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
                    {mine.map((f) => (
                      <li key={f.issue_id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[2px]">
                        <button type="button" onClick={() => onOpen(f.issue_id)} className="min-h-ds-control min-w-0 flex-1 rounded-ds-control px-[4px] text-left text-ds-body text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
                          <span className="font-[600]">{referenceOf(f) || '—'}</span> <span className="break-words [overflow-wrap:anywhere]">{f.title}</span>
                        </button>
                        <span className="text-ds-label text-ds-fg-muted">{ownerName(f) || 'Unassigned'} · {formatDate(dueOf(f), { calendar: true })}</span>
                        <StatusPill size="sm" {...statusPill(findingStatus, f.status)} />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-[8px]">
                  {add(r)}
                  <Button size="sm" onClick={() => onShow(r)}>Show in the register</Button>
                </div>
              </div>
            );
          },
        }}
      />
    </div>
  );
}
