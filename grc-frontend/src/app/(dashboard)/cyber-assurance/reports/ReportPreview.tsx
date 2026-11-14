'use client';

// In-app EXECUTIVE report dashboard for the definition the Report Builder holds. Built to the
// same DENSITY and visual language as the Vulnerability / Inventory / Performance dashboards:
//   • a grid of many titled breakdown cards at once (not one toggled chart), each with a
//     one-line C-level description — donut for <=6 slices, else a share-list (label · count ·
//     share% · bar) modelled on Inventory's "External attack surface — By Type" list;
//   • a "Top N" ranked card for the richest dimension, mirroring the Vuln dashboard's
//     "Top 10 — Fix These First";
//   • an honest headline score (ScoreRing, reused from the dashboards' score-kit) where the
//     dataset has one — CIS pass rate today; skipped, never fabricated, otherwise.
//
// Counts come from /reporting/aggregate (exact, whole filtered set); the table is the first
// PREVIEW_ROWS rows from /reporting/query. "Print" prints just this block. A global Auto/Donut/
// Bars control overrides each card's chart type; the default (Auto) picks by slice count.
import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, AlertCircle, Printer, X, BarChart3, PieChart as PieIcon, Sparkles, Table2,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer } from 'recharts';
import { ScoreRing, scoreBand } from '@/cyber-assurance/components/dashboard/score-kit';
import { reportingApi, type ReportFilter } from '@/cyber-assurance/lib/api';
import { labelize } from './shared';
import {
  breakdownColumns, buildKpis, columnBlurb, coverageScore, datasetNoun, sliceName, topSlices,
  type Breakdowns, type Kpi, type Slice,
} from './reportInsights';

const PREVIEW_ROWS = 100;
// The single house card shadow (grc dashboards' tokens.css) — the one knob that makes cards "lift".
const CARD_SHADOW = 'shadow-[0_1px_2px_rgba(16,24,40,.06),0_4px_14px_rgba(16,24,40,.08)]';
const CARD = `rounded-[14px] border border-[#E2E5EC] bg-white ${CARD_SHADOW}`;
const PALETTE = ['#005B96', '#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b', '#84cc16'];
const NAMED_COLORS: Record<string, string> = {
  critical: '#991B1B', high: '#EA580C', medium: '#F59E0B', low: '#2563EB', info: '#64748B',
  passed: '#047857', failed: '#B91C1C', error: '#d97706', other: '#94a3b8', unknown: '#94a3b8',
};
const TONE_COLOR: Record<NonNullable<Kpi['tone']>, string> = {
  danger: '#B91C1C', warn: '#B45309', good: '#047857',
};
type ChartMode = 'auto' | 'donut' | 'bars';

export interface PreviewRequest {
  dataset: string;
  label: string;
  columns: string[];
  filters: ReportFilter[];
  logic: 'AND' | 'OR';
  assetCategories?: string[];
  // Bumped by "Update report" so an identical config still forces a fresh fetch after an
  // error (otherwise react-query serves the cached failure and the preview can't recover).
  nonce?: number;
}

interface PreviewData { total: number; rows: Record<string, unknown>[]; breakdowns: Breakdowns; cols: string[] }

async function loadPreview(req: PreviewRequest, filterable: Record<string, string>): Promise<PreviewData> {
  const cols = breakdownColumns(req.dataset, filterable);
  const base = {
    dataset: req.dataset, filters: req.filters, logic: req.logic, asset_categories: req.assetCategories,
  };
  const [q, ...counts] = await Promise.all([
    reportingApi.query({ ...base, limit: PREVIEW_ROWS }),
    // A failed breakdown just drops that card; it must not blank the whole preview.
    ...cols.map((c) => reportingApi.countBy({ ...base, group_by: [c] }).catch(() => null)),
  ]);
  const breakdowns: Breakdowns = {};
  cols.forEach((c, i) => {
    const res = counts[i]?.data;
    if (!res || res.warnings?.skipped_group_by?.includes(c)) return;
    breakdowns[c] = res.rows.map((r) => ({ name: sliceName(r[c]), value: Number(r.m_n) || 0 }));
  });
  return { total: q.data.total, rows: q.data.rows, breakdowns, cols: cols.filter((c) => c in breakdowns) };
}

const sliceColor = (s: Slice, i: number) => NAMED_COLORS[s.name.toLowerCase()] ?? PALETTE[i % PALETTE.length];
const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
const sumOf = (slices: Slice[]) => slices.reduce((s, d) => s + d.value, 0);

function cellText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function filterSummary(req: PreviewRequest): string {
  if (!req.filters.length) return 'No filters — every row';
  const parts = req.filters.map((f) => `${labelize(f.col)} ${f.op} ${f.value ?? ''}`.trim());
  return parts.join(req.logic === 'OR' ? '  OR  ' : '  AND  ');
}

// ── Executive summary band — bordered-left accent, with an honest headline ScoreRing where the
//    dataset has a derivable score (reuses the dashboards' score-kit); mirrors the Performance header. ──
function SummaryBand({ req, total, noun, when, score, views }: {
  req: PreviewRequest; total: number; noun: string; when: string; score: number | null; views: number;
}) {
  const band = score == null ? null : scoreBand(score);
  const fact = (value: React.ReactNode, label: string) => (
    <div className="text-center">
      <div className="text-[19px] font-bold leading-none tabular-nums text-[#0F172A]">{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
  return (
    <section className={`flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5 ${CARD}`} style={{ borderLeft: '3px solid var(--color-base)' }}>
      <div className="min-w-0 flex-1 basis-[260px]">
        <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[.07em] text-slate-500">Report preview</p>
        <h3 className="m-0 mt-0.5 text-[17px] font-semibold leading-tight text-[#0F172A]">{req.label} report</h3>
        <p className="m-0 mt-1 text-[12px] leading-[1.5] text-slate-500">
          <b className="font-semibold text-[#0F172A]">{total.toLocaleString('en-US')}</b> {total === 1 ? noun.replace(/s$/, '') : noun}
          {' · '}{filterSummary(req)}{' · '}Generated {when}
        </p>
      </div>
      {band ? (
        <div className="flex items-center gap-3 border-slate-200 sm:border-l sm:pl-6">
          <ScoreRing score={score} size={64} />
          <div>
            <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[.07em] text-slate-500">Pass rate</p>
            <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${band.pill}`}>{band.label}</span>
          </div>
        </div>
      ) : (
        // No derivable score for this dataset — fill the right with real at-a-glance facts
        // instead of leaving the band empty.
        <div className="flex items-center gap-6 border-slate-200 sm:border-l sm:pl-6">
          {fact(total.toLocaleString('en-US'), noun)}
          {fact(views, views === 1 ? 'breakdown' : 'breakdowns')}
          {fact(req.columns.length, 'columns')}
        </div>
      )}
    </section>
  );
}

// ── KPI stat tiles: big tone-coloured number, thin tone accent, hover-lift (house tile style) ──
function KpiCards({ kpis }: { kpis: Kpi[] }) {
  return (
    // auto-fit so the tiles always stretch to fill the row — no empty trailing column
    // when a dataset has 4 KPIs instead of 5.
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      {kpis.map((k) => {
        const color = k.tone ? TONE_COLOR[k.tone] : 'var(--color-base)';
        return (
          <div key={k.label} className={`relative flex flex-col overflow-hidden px-4 py-3.5 transition hover:-translate-y-px hover:shadow-[0_8px_22px_rgba(16,24,40,.12)] ${CARD}`}>
            <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />
            <div className="text-[26px] font-bold leading-none tabular-nums" style={{ color: k.tone ? color : '#0F172A' }}>
              {k.value}
            </div>
            <div className="mt-2 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ data, total }: { data: Slice[]; total: number }) {
  return (
    <ul className="min-w-0 flex-1 space-y-1.5 text-[12px]">
      {data.map((s, i) => (
        <li key={s.name} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: sliceColor(s, i) }} />
          <span className="min-w-0 flex-1 truncate capitalize text-slate-600">{s.name}</span>
          <span className="font-semibold tabular-nums text-slate-800">{s.value.toLocaleString('en-US')}</span>
          <span className="w-9 text-right tabular-nums text-slate-400">{pct(s.value, total)}%</span>
        </li>
      ))}
    </ul>
  );
}

function Donut({ data, total }: { data: Slice[]; total: number }) {
  return (
    <div className="flex flex-1 items-center gap-4">
      <div className="relative h-36 w-36 flex-none">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={66} paddingAngle={2} stroke="none">
              {data.map((s, i) => <Cell key={s.name} fill={sliceColor(s, i)} />)}
            </Pie>
            <RTooltip formatter={(v, n) => [`${Number(v).toLocaleString('en-US')} (${pct(Number(v), total)}%)`, String(n)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-slate-800">{total.toLocaleString('en-US')}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-400">total</span>
        </div>
      </div>
      <Legend data={data} total={total} />
    </div>
  );
}

// Share-list — label · count · share% · filled bar, in two columns when there are many rows.
// Modelled on Inventory's "External attack surface — By Type" list.
function BarsList({ data, total }: { data: Slice[]; total: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className={`grid flex-1 content-start gap-x-6 gap-y-2.5 ${data.length > 8 ? 'sm:grid-cols-2' : ''}`}>
      {data.map((s, i) => (
        <li key={s.name} className="min-w-0">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate capitalize text-slate-600">{s.name}</span>
            <span className="flex-none tabular-nums">
              <b className="font-semibold text-slate-800">{s.value.toLocaleString('en-US')}</b>
              <span className="ml-1 text-slate-400">{pct(s.value, total)}%</span>
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, background: sliceColor(s, i) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// One breakdown dimension: title + C-level blurb + donut (<=6 slices) or share-list (else),
// overridable by the global Auto/Donut/Bars control.
function BreakdownCard({ col, slices, noun, mode }: { col: string; slices: Slice[]; noun: string; mode: ChartMode }) {
  const data = topSlices(slices);
  const total = sumOf(data);
  const type = mode === 'auto' ? (data.length <= 6 ? 'donut' : 'bars') : mode;
  return (
    <div className={`flex flex-col p-4 break-inside-avoid ${CARD}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">By {labelize(col)}</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{columnBlurb(col, noun)}</p>
      </div>
      {data.length === 0
        ? <p className="flex flex-1 items-center justify-center py-8 text-xs text-slate-400">No data for this breakdown</p>
        : type === 'donut' ? <Donut data={data} total={total} /> : <BarsList data={data} total={total} />}
    </div>
  );
}

// Ranked "Top N" of the richest dimension — rank · label · bar · count · share%.
// Mirrors the Vuln dashboard's "Top 10 — Fix These First".
function TopNCard({ col, slices, noun }: { col: string; slices: Slice[]; noun: string }) {
  const total = sumOf(slices);
  const ranked = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
  const max = Math.max(1, ...ranked.map((s) => s.value));
  return (
    <div className={`flex flex-col p-4 break-inside-avoid ${CARD}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Top {ranked.length} — By {labelize(col)}</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">The most frequent {labelize(col).toLowerCase()} values across the {noun}.</p>
      </div>
      <ol className="flex flex-1 flex-col justify-center gap-2">
        {ranked.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2.5 text-[12px]">
            <span className="w-4 flex-none text-right font-mono text-[11px] text-slate-400">{i + 1}</span>
            <span className="w-28 flex-none truncate capitalize text-slate-700" title={s.name}>{s.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(3, (s.value / max) * 100)}%`, background: 'var(--color-base)' }} />
            </span>
            <b className="w-11 flex-none text-right font-semibold tabular-nums text-slate-800">{s.value.toLocaleString('en-US')}</b>
            <span className="w-9 flex-none text-right tabular-nums text-slate-400">{pct(s.value, total)}%</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PreviewTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  return (
    <div className={`overflow-hidden ${CARD}`}>
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-800">Detailed records</h3>
        <span className="text-[11px] tabular-nums text-slate-500">{rows.length.toLocaleString('en-US')} shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left font-semibold text-slate-600">{labelize(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={Math.max(1, columns.length)} className="px-3 py-6 text-center text-slate-400">No rows match the selected filters.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-50/60' : 'bg-white'}>
                {columns.map((c) => (
                  <td key={c} className="max-w-[260px] truncate border-t border-slate-100 px-3 py-1.5 text-slate-700">{cellText(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Print only the report block: copy it (plus the page's stylesheets) into a hidden iframe and
// print that. shortcut: relies on the app's CSS being re-fetchable by the iframe; if a deploy
// ever inlines styles differently, switch to a dedicated /reports/print route.
function printReport(el: HTMLElement, title: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) { frame.remove(); return; }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => (n instanceof HTMLLinkElement ? `<link rel="stylesheet" href="${n.href}">` : n.outerHTML))
    .join('');
  const safeTitle = title.replace(/[<>&"]/g, '');
  frame.onload = () => {
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 1500);
  };
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>${styles}` +
    '<style>@page{size:A4 landscape;margin:10mm}body{background:#fff;margin:0;padding:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'svg{max-width:100%;height:auto}.no-print{display:none!important}.overflow-x-auto{overflow:visible!important}.report-canvas{zoom:1!important}' +
    'tr,.break-inside-avoid{break-inside:avoid}</style></head>' +
    `<body>${el.outerHTML}</body></html>`,
  );
  doc.close();
}

// Global chart-type control (Auto / Donut / Bars). Auto picks per-card by slice count.
function ModeToggle({ mode, setMode }: { mode: ChartMode; setMode: (m: ChartMode) => void }) {
  const opts: { id: ChartMode; icon: typeof PieIcon; label: string }[] = [
    { id: 'auto', icon: Sparkles, label: 'Auto' },
    { id: 'donut', icon: PieIcon, label: 'Donut' },
    { id: 'bars', icon: BarChart3, label: 'Bars' },
  ];
  return (
    <div className="no-print inline-flex overflow-hidden rounded-lg border border-slate-200" role="group" aria-label="Chart style">
      {opts.map((o) => (
        <button key={o.id} onClick={() => setMode(o.id)} title={`${o.label} charts`} aria-pressed={mode === o.id}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium"
          style={mode === o.id ? { background: 'var(--color-base)', color: '#fff' } : { color: '#64748b' }}>
          <o.icon size={13} /> {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ReportPreview({
  req, filterable, onClose,
}: { req: PreviewRequest; filterable: Record<string, string>; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('auto');
  const [showTable, setShowTable] = useState(true);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-preview', req, filterable],
    queryFn: () => loadPreview(req, filterable),
    staleTime: 0,
  });

  const noun = datasetNoun(req.dataset);
  const kpis = data ? buildKpis(req.dataset, data.total, data.breakdowns, data.cols, noun) : [];
  const score = data ? coverageScore(req.dataset, data.breakdowns) : null;
  // The richest dimension (>6 distinct values) becomes the dedicated Top-N ranked card; the
  // rest render as breakdown cards — so the two are additive, never the same column twice.
  const rankCol = data
    ? data.cols
        .map((c) => ({ c, n: (data.breakdowns[c] ?? []).filter((s) => s.value > 0).length }))
        .filter((x) => x.n > 6)
        .sort((a, b) => b.n - a.n)[0]?.c ?? null
    : null;
  const gridCols = data ? data.cols.filter((c) => c !== rankCol) : [];
  const when = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-4 border-t border-[var(--color-border)] pt-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          <BarChart3 size={14} /> Report preview
        </span>
        <div className="flex items-center gap-2">
          <ModeToggle mode={chartMode} setMode={setChartMode} />
          <button
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            title={showTable ? 'Hide the data table' : 'Show the data table'}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium"
            style={showTable
              ? { borderColor: 'var(--color-base)', color: 'var(--color-base)', background: 'var(--color-base-soft)' }
              : { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}
          >
            <Table2 size={14} /> Table
          </button>
          <button
            onClick={() => rootRef.current && printReport(rootRef.current, `${req.label} report`)}
            disabled={!data}
            title="Print this dashboard (or save it as PDF from the print dialog)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)] disabled:opacity-60"
          >
            <Printer size={14} /> Print
          </button>
          <button onClick={onClose} aria-label="Close preview"
            className="rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-subtle)]"><X size={15} /></button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Loader2 size={15} className="animate-spin" /> Building preview…
        </div>
      )}
      {isError && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-danger)]">
          <AlertCircle size={15} /> Could not build the preview. Your session may have expired or the server is unavailable — reload the page, then click Update report.
        </div>
      )}

      {data && (
        // Density scale to match the Vulnerability / Inventory dashboards (which render inside a
        // zoom:0.8 wrapper) — otherwise the reporting canvas reads visibly "zoomed in" vs them.
        // Reset to 1 for print (see printReport) so the PDF stays full size.
        <div ref={rootRef} className="report-canvas space-y-4 [zoom:0.8]">
          <SummaryBand req={req} total={data.total} noun={noun} when={when} score={score} views={data.cols.length} />
          <KpiCards kpis={kpis} />
          {data.cols.length > 0 && (
            <div className="grid items-stretch gap-3 md:grid-cols-2">
              {gridCols.map((c) => (
                <BreakdownCard key={c} col={c} slices={data.breakdowns[c] ?? []} noun={noun} mode={chartMode} />
              ))}
              {rankCol && <TopNCard col={rankCol} slices={data.breakdowns[rankCol] ?? []} noun={noun} />}
            </div>
          )}
          {showTable && <PreviewTable columns={req.columns} rows={data.rows} />}
          {showTable && data.total > data.rows.length && (
            <p className="text-[11px] text-[var(--color-muted)]">
              Showing the first {data.rows.length.toLocaleString('en-US')} of {data.total.toLocaleString('en-US')} rows — export CSV / XLSX for the full set.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
