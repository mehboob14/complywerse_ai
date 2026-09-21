'use client';

/**
 * The monthly pack — the client's SUMMARY sheet, section by section.
 *
 * Roll-forward, status of resolution, aging, status by source, what closed
 * this month and the recommendations they do not track: all computed from the
 * register, with the figures their own workbook reported shown beside ours so a
 * difference is called out rather than quietly reconciled. Exports as .xlsx in
 * their layout.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { auditRegisterApi } from '@/lib/api';

type BySource = { by_source: Record<string, number>; total: number };
type Pack = {
  months: string[]; month: string; title: string; as_of: string;
  columns: Array<{ source: string; title: string }>;
  roll_forward: {
    rows: Array<{ source: string; beginning: number; opened: number; closed: number; ending: number;
      reported: Record<string, number> | null; matches: boolean }>;
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
  ['beginning', 'Beginning Number of Issues'],
  ['opened', 'Add: Issues opened this month'],
  ['closed', 'Less: Issues closed this month'],
  ['ending', 'Ending Number of Issues'],
] as const;

const card = 'overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm';
const th = 'whitespace-nowrap px-3 py-2 text-right font-medium';
const td = 'px-3 py-2 text-right tabular-nums text-slate-900';

function Theirs({ ours, theirs }: { ours: number; theirs?: number | null }) {
  if (theirs == null || theirs === ours) return <>{ours}</>;
  return (
    <span title={`The workbook reported ${theirs}`} className="font-semibold text-amber-700">
      {ours} <span className="text-[10px] font-normal text-amber-600">({theirs})</span>
    </span>
  );
}

function SourceTable({ columns, rows, total, onCell }: {
  columns: Pack['columns'];
  rows: Array<{ key: string; label: string; cells: Record<string, number>; theirs?: Record<string, number> | null; bold?: boolean }>;
  total?: boolean;
  onCell?: (source: string, rowKey: string) => void;   // a count opens the findings behind it
}) {
  const count = (n: number, source: string, rowKey: string, children: React.ReactNode) =>
    onCell && n > 0 ? (
      <button onClick={() => onCell(source, rowKey)} title="Show these findings in the register"
              className="tabular-nums underline decoration-slate-300 underline-offset-2 hover:text-primary-700 hover:decoration-primary-500">
        {children}
      </button>
    ) : children;
  return (
    <div className={card}>
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Source</th>
            {columns.map((c) => <th key={c.source} className={th}>{c.title}</th>)}
            {total !== false && <th className={th}>Total</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.key} className={row.bold ? 'bg-slate-50 font-semibold' : ''}>
              <td className="whitespace-nowrap px-3 py-2 text-slate-700">{row.label}</td>
              {columns.map((c) => (
                <td key={c.source} className={td}>
                  {count(row.cells[c.source] ?? 0, c.source, row.key,
                    <Theirs ours={row.cells[c.source] ?? 0} theirs={row.theirs?.[c.source]} />)}
                </td>
              ))}
              {total !== false && (
                <td className={`${td} font-semibold`}>
                  {(() => {
                    const sum = columns.reduce((s, c) => s + (row.cells[c.source] ?? 0), 0);
                    return count(sum, '', row.key, sum);
                  })()}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RegisterSummary({ onDrill }: { onDrill?: (source: string, status: string) => void }) {
  const [month, setMonth] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const pack = useQuery<Pack>({
    queryKey: ['audit-register-pack', month],
    queryFn: async () => (await auditRegisterApi.pack(month || undefined)).data,
  });

  const download = async () => {
    setExporting(true);
    try {
      const res = await auditRegisterApi.exportPack(month || pack.data?.month);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Issue Summary ${pack.data?.month || ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (pack.isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>;
  }
  if (pack.isError || !pack.data) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-red-600">
        <AlertTriangle className="h-4 w-4" /> Could not load the summary.
        <button onClick={() => pack.refetch()} className="font-semibold underline">Retry</button>
      </p>
    );
  }
  const data = pack.data;
  if (!data.columns.length) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Nothing imported yet — the pack appears once the register has findings.
      </p>
    );
  }

  const rf = data.roll_forward;
  const mismatched = rf.rows.filter((r) => !r.matches).length
    + data.status_rows.filter((r) => r.reported && Object.entries(r.reported)
      .some(([s, n]) => n != null && n !== (r.by_source[s] ?? 0))).length;
  const res = data.resolution;
  const asOf = new Date(`${data.as_of}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Audit Services</p>
          <h2 className="text-sm font-semibold text-slate-900">{data.title}</h2>
        </div>
        <select
          value={month || data.month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
        >
          {(data.months.length ? data.months : [data.month]).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          onClick={download}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export (.xlsx)
        </button>
      </div>

      {data.has_reported && (
        <p className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${
          mismatched ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {mismatched
            ? <><AlertTriangle className="h-3.5 w-3.5" /> {mismatched} line(s) differ from the client&apos;s workbook — their figure is shown in brackets.</>
            : <><CheckCircle2 className="h-3.5 w-3.5" /> Matches the figures in the client&apos;s workbook for this month.</>}
        </p>
      )}

      <SourceTable
        columns={data.columns}
        rows={MEASURES.map(([key, label]) => ({
          key, label, bold: key === 'ending',
          cells: Object.fromEntries(rf.rows.map((r) => [r.source, r[key]])),
          theirs: data.has_reported
            ? Object.fromEntries(rf.rows.filter((r) => r.reported).map((r) => [r.source, r.reported![key]]))
            : null,
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-900">Open issue status as of {asOf}</p>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status of issue resolution progress</p>
          <table className="mt-2 w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {([
                ['Not Started', res.not_started], ['In Progress', res.in_progress],
                ['Delayed / Past Due', res.delayed_past_due],
                ['Extended (Audit Committee Approval Required)', res.extended],
                ...(res.unstated ? [['Other or no status (RM, N/A, blank)', res.unstated]] : []),
                ['Closed this month', res.closed_this_month],
              ] as Array<[string, number]>).map(([label, n]) => (
                <tr key={label}><td className="py-1.5 text-slate-700">{label}</td><td className={td}>{n}</td></tr>
              ))}
              <tr className="font-semibold"><td className="py-1.5 text-slate-700">Subtotal of issues</td><td className={td}>{res.subtotal}</td></tr>
              <tr><td className="py-1.5 text-slate-700">Less: issues closed this month</td><td className={td}>({res.less_closed})</td></tr>
              <tr className="bg-slate-50 font-semibold"><td className="py-1.5 text-slate-700">Total issues as of {asOf}</td><td className={td}>{res.total}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-900">Issue aging analysis</p>
          <p className="text-[11px] text-slate-500">Days past the target (or revised target) date, open issues</p>
          <table className="mt-2 w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {data.aging.map((a) => (
                <tr key={a.bucket}>
                  <td className="py-1.5 text-slate-700">{a.bucket} days</td>
                  <td className="py-1.5 text-[11px] text-slate-500">
                    {data.columns.filter((c) => a.by_source[c.source]).map((c) => `${c.title} ${a.by_source[c.source]}`).join(' · ')}
                  </td>
                  <td className={td}>{a.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SourceTable
        columns={data.columns}
        onCell={onDrill}
        rows={[
          ...data.status_rows.map((r) => ({ key: r.status, label: r.label, cells: r.by_source, theirs: r.reported })),
          { key: 'open', label: 'Total Open Issues', cells: data.total_open.by_source, theirs: data.total_open.reported, bold: true },
        ]}
      />
      {onDrill && <p className="-mt-2 text-[11px] text-slate-500">Click a count to see those findings in the register.</p>}
      {data.total_open.check !== 0 && (
        <p className="text-[11px] text-amber-700">Check: open issues differ from the ending count by {data.total_open.check}.</p>
      )}

      <div className={card}>
        <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-900">
          List of issues closed this month <span className="font-normal text-slate-500">· {data.closed.length}</span>
        </p>
        {!data.closed.length ? (
          <p className="px-3 py-4 text-xs text-slate-500">None closed this month.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {data.closed.map((c) => (
                <tr key={c.issue_id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {data.columns.find((x) => x.source === c.source)?.title || c.source}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{c.reference || '—'}</td>
                  <td className="px-3 py-2"><Link href={`/issues/${c.issue_id}`} className="text-slate-900 hover:underline">{c.title}</Link></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">{c.closed_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SourceTable
        columns={data.columns}
        rows={[{ key: 'recs', label: 'Recommendations (not tracked)', cells: data.recommendations.by_source, theirs: data.recommendations.reported }]}
      />

      <p className="text-[11px] text-slate-500">
        Opened on the report or event date; closed on the date Audit Services validated it.
        Past Due follows the client&apos;s definition — the action plan was not implemented by the agreed
        (or revised) target date. Status is as the register has it now.
      </p>
    </div>
  );
}
