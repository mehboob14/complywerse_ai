'use client';

// The Summary tab: the monthly pack, the client's SUMMARY sheet section by section. Roll-forward, status of resolution, aging, status by source, what closed this month and the recommendations
// they do not track are all computed by the server from the register, and shown here exactly as received, with the figures THEIR workbook reported beside ours ("ours (theirs)") so a difference is
// called out rather than quietly reconciled. A count opens the findings behind it in the Register. Exports as .xlsx in their layout. Nothing on this page is computed in the browser.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormField, Notice, SectionCard, Select, SkeletonRows, Table, TableFrame, TBody, Td, Th, THead, Tr, RowHeaderCell, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { saveBlob } from './registerData';

type BySource = { by_source: Record<string, number>; total: number };
type Pack = {
  months: string[]; month: string; title: string; as_of: string;
  columns: Array<{ source: string; title: string }>;
  roll_forward: {
    rows: Array<{ source: string; beginning: number; opened: number; closed: number; ending: number; reported: Record<string, number> | null; matches: boolean }>;
    totals: Record<string, number>;
  };
  resolution: Record<string, number>;
  aging: Array<BySource & { bucket: string }>;
  status_rows: Array<BySource & { status: string; label: string; reported: Record<string, number> | null }>;
  total_open: BySource & { reported: Record<string, number> | null; check: number };
  closed: Array<{ issue_id: number; source: string; reference: string | null; title: string; closed_on: string }>;
  recommendations: BySource & { reported: Record<string, number> | null };
  has_reported: boolean;
};

const MEASURES = [
  ['beginning', 'Beginning number of issues'],
  ['opened', 'Add: issues opened this month'],
  ['closed', 'Less: issues closed this month'],
  ['ending', 'Ending number of issues'],
] as const;

const NUM = 'tabular-nums';

/** Our figure, and theirs in brackets when the workbook reported a different one. */
function Figure({ ours, theirs }: { ours: number; theirs?: number | null }) {
  if (theirs == null || theirs === ours) return <>{formatCount(ours)}</>;
  return (
    <span className="font-[600] text-ds-warning">
      {formatCount(ours)} <span className="font-[400]" aria-hidden>({formatCount(theirs)})</span>
      <span className="sr-only">; the workbook reported {formatCount(theirs)}</span>
    </span>
  );
}

function SourceTable({ caption, columns, rows, total = true, onCell }: {
  caption: string;
  columns: Pack['columns'];
  rows: Array<{ key: string; label: string; cells: Record<string, number>; theirs?: Record<string, number> | null; bold?: boolean }>;
  total?: boolean;
  onCell?: (source: string, rowKey: string) => void;      // a count opens the findings behind it
}) {
  const count = (n: number, source: string, row: string, label: string, children: React.ReactNode) => (onCell && n > 0
    ? <Button variant="link" className={NUM} aria-label={`Show the ${formatCount(n)} in the register: ${label}`} onClick={() => onCell(source, row)}>{children}</Button>
    : children);
  return (
    <TableFrame aria-label={caption}>
      <Table caption={caption}>
        <THead>
          <Tr>
            <Th className="min-w-[180px]">Source</Th>
            {columns.map((c) => <Th key={c.source} align="right" className="whitespace-nowrap">{c.title}</Th>)}
            {total && <Th align="right">Total</Th>}
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => {
            const sum = columns.reduce((s, c) => s + (row.cells[c.source] ?? 0), 0);
            return (
              <Tr key={row.key}>
                <RowHeaderCell className={`min-w-[180px] ${row.bold ? 'font-[600]' : ''}`}>{row.label}</RowHeaderCell>
                {columns.map((c) => (
                  <Td key={c.source} align="right" className={`${NUM} ${row.bold ? 'font-[600]' : ''}`}>
                    {count(row.cells[c.source] ?? 0, c.source, row.key, `${row.label}, ${c.title}`, <Figure ours={row.cells[c.source] ?? 0} theirs={row.theirs?.[c.source]} />)}
                  </Td>
                ))}
                {total && <Td align="right" className={`${NUM} font-[600]`}>{count(sum, '', row.key, `${row.label}, all sources`, formatCount(sum))}</Td>}
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableFrame>
  );
}

export function SummaryTab({ canExport, onDrill, onOpen }: {
  canExport: boolean; onDrill: (source: string, rowKey: string) => void; onOpen: (issueId: number) => void;
}) {
  const [month, setMonth] = useState('');
  const pack = useQuery<Pack>({
    queryKey: ['audit-register-pack', month],
    queryFn: async () => (await auditRegisterApi.pack(month || undefined)).data as Pack,
  });
  const exportPack = useReportedMutation({
    mutationFn: async () => saveBlob((await auditRegisterApi.exportPack(month || pack.data?.month)).data as Blob, `Issue Summary ${pack.data?.month || ''}.xlsx`),
    failure: "Couldn't export the summary",
    toast: 'errors',
  });

  if (pack.isLoading) return <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={5} label="Loading the summary" /></div>;
  if (pack.isError || !pack.data) return <ErrorState title="Couldn't load the summary" message={errorMessage(pack.error)} onRetry={() => { void pack.refetch(); }} />;
  const data = pack.data;
  if (!data.columns.length) return <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState bare kind="firstUse" title="Nothing imported yet" description="The pack appears once the register has findings." /></div>;

  const rf = data.roll_forward;
  const mismatched = rf.rows.filter((r) => !r.matches).length
    + data.status_rows.filter((r) => r.reported && Object.entries(r.reported).some(([s, n]) => n != null && n !== (r.by_source[s] ?? 0))).length;
  const res = data.resolution;
  const asOf = formatDate(data.as_of, { calendar: true });
  const resolution: Array<[string, number]> = [
    ['Not started', res.not_started], ['In progress', res.in_progress], ['Delayed or past due', res.delayed_past_due],
    ['Extended (Audit Committee approval required)', res.extended],
    ...(res.unstated ? [['Other or no status (RM, N/A, blank)', res.unstated] as [string, number]] : []),
    ['Closed this month', res.closed_this_month],
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div className="min-w-0">
          <p className="m-0 text-ds-label font-[600] text-ds-fg-muted">Audit Services</p>
          <p className="m-0 break-words text-ds-section font-[600] text-ds-fg">{data.title}</p>
        </div>
        <div className="flex flex-wrap items-end gap-[8px]">
          <FormField label="Month" className="w-[160px]">
            <Select value={month || data.month} onChange={(e) => setMonth(e.target.value)}>
              {(data.months.length ? data.months : [data.month]).map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </FormField>
          {canExport && <Button leftIcon={<Download aria-hidden />} loading={exportPack.isPending} onClick={() => exportPack.mutate()}>Export (.xlsx)</Button>}
        </div>
      </div>

      {data.has_reported && (
        mismatched
          ? <Notice tone="warning" icon={AlertTriangle} title={`${formatCount(mismatched)} ${mismatched === 1 ? 'line differs' : 'lines differ'} from the client’s workbook`}>Their figure is shown in brackets beside ours.</Notice>
          : <Notice tone="info" icon={CheckCircle2}>Matches the figures in the client’s workbook for this month.</Notice>
      )}

      <SourceTable
        caption="Roll-forward of issues by source"
        columns={data.columns}
        rows={MEASURES.map(([key, label]) => ({
          key, label, bold: key === 'ending',
          cells: Object.fromEntries(rf.rows.map((r) => [r.source, r[key]])),
          theirs: data.has_reported ? Object.fromEntries(rf.rows.filter((r) => r.reported).map((r) => [r.source, r.reported![key]])) : null,
        }))}
      />

      <div className="grid gap-[16px] lg:grid-cols-2">
        <SectionCard id="pack-resolution" title={`Open issue status as of ${asOf}`} info="Status of issue resolution progress">
          <TableFrame aria-label="Status of issue resolution progress">
            <Table caption="Status of issue resolution progress">
              <TBody>
                {resolution.map(([label, n]) => <Tr key={label}><RowHeaderCell>{label}</RowHeaderCell><Td align="right" className={NUM}>{formatCount(n)}</Td></Tr>)}
                <Tr><RowHeaderCell className="font-[600]">Subtotal of issues</RowHeaderCell><Td align="right" className={`${NUM} font-[600]`}>{formatCount(res.subtotal)}</Td></Tr>
                <Tr><RowHeaderCell>Less: issues closed this month</RowHeaderCell><Td align="right" className={NUM}>({formatCount(res.less_closed)})</Td></Tr>
                <Tr><RowHeaderCell className="font-[600]">Total issues as of {asOf}</RowHeaderCell><Td align="right" className={`${NUM} font-[600]`}>{formatCount(res.total)}</Td></Tr>
              </TBody>
            </Table>
          </TableFrame>
        </SectionCard>
        <SectionCard id="pack-aging" title="Issue aging analysis" info="Days past the target (or revised target) date, open issues.">
          <TableFrame aria-label="Issue aging analysis">
            <Table caption="Issue aging analysis">
              <TBody>
                {data.aging.map((a) => (
                  <Tr key={a.bucket}>
                    <RowHeaderCell>{a.bucket} days</RowHeaderCell>
                    <Td className="text-ds-fg-muted">{data.columns.filter((c) => a.by_source[c.source]).map((c) => `${c.title} ${formatCount(a.by_source[c.source])}`).join(' · ')}</Td>
                    <Td align="right" className={NUM}>{formatCount(a.total)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        </SectionCard>
      </div>

      <div className="flex flex-col gap-[6px]">
        <SourceTable
          caption="Open issues by status and source"
          columns={data.columns}
          onCell={onDrill}
          rows={[
            ...data.status_rows.map((r) => ({ key: r.status, label: r.label, cells: r.by_source, theirs: r.reported })),
            { key: 'open', label: 'Total open issues', cells: data.total_open.by_source, theirs: data.total_open.reported, bold: true },
          ]}
        />
        <p className="m-0 text-ds-label text-ds-fg-muted">Select a count to see those findings in the Register.</p>
        {data.total_open.check !== 0 && <p className="m-0 text-ds-label text-ds-warning">Check: open issues differ from the ending count by {formatCount(data.total_open.check)}.</p>}
      </div>

      <SectionCard id="pack-closed" title="Issues closed this month" meta={formatCount(data.closed.length)}>
        {!data.closed.length ? <p className="m-0 p-[12px] text-ds-body text-ds-fg-muted">None closed this month.</p> : (
          <TableFrame aria-label="Issues closed this month">
            <Table caption="Issues closed this month">
              <TBody>
                {data.closed.map((c) => (
                  <Tr key={c.issue_id} onActivate={() => onOpen(c.issue_id)}>
                    <Td className="whitespace-nowrap text-ds-fg-body">{data.columns.find((x) => x.source === c.source)?.title || c.source}</Td>
                    <Td className="whitespace-nowrap font-[600] text-ds-fg-body">{c.reference || '—'}</Td>
                    <RowHeaderCell><span className="break-words text-ds-fg [overflow-wrap:anywhere]">{c.title}</span></RowHeaderCell>
                    <Td align="right" className="whitespace-nowrap text-ds-fg-body">{formatDate(c.closed_on, { calendar: true })}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        )}
      </SectionCard>

      <SourceTable
        caption="Recommendations that are not tracked"
        columns={data.columns}
        rows={[{ key: 'recs', label: 'Recommendations (not tracked)', cells: data.recommendations.by_source, theirs: data.recommendations.reported }]}
      />

      <p className="m-0 text-ds-label text-ds-fg-muted">
        Opened on the report or event date; closed on the date Audit Services validated it. Past due follows the client’s definition: the action plan was not implemented by the agreed (or revised)
        target date. Status is as the register has it now.
      </p>
    </div>
  );
}
