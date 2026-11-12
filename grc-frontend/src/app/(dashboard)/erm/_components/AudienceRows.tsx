'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, HelpCircle } from 'lucide-react';
import AttentionQueue from '@/components/dashboard/erm/AttentionQueue';
import ModulePerformanceCard from '@/components/dashboard/erm/ModulePerformanceCard';
import RiskHeatmap from '@/components/dashboard/erm/RiskHeatmap';
import type { ModulePerformance, Section } from '@/components/dashboard/erm/types';
import { formatMoney } from '../incidents/lossEvents';
import { type AudienceRow, barWidths, changeLabel, drillHref, formatRowValue, toMatrix } from './audienceModel';

type Item = Record<string, unknown>;

// Attention queue keys → labels + the page that clears them + tile rail color.
const ATTENTION_META: Array<{ key: string; label: string; href: string; color: string }> = [
  { key: 'critical_open_risks', label: 'Critical open risks', href: '/erm/risks/list?filter=critical_open', color: '#dc2626' },
  { key: 'unscored_active_risks', label: 'Unscored active risks', href: '/erm/risks/list?filter=unscored', color: '#d97706' },
  { key: 'blocked_questions', label: 'Blocked framework questions', href: '/erm/risk-assessments/framework', color: '#8b5cf6' },
  { key: 'overdue_ai_reviews', label: 'Overdue AI reviews', href: '/erm/risk-assessments/ai-risk-assessment', color: '#2563eb' },
  { key: 'rcsa_open_findings', label: 'RCSA open findings', href: '/erm/rcsa/findings', color: '#ea580c' },
  { key: 'controls_tests_overdue', label: 'Control tests overdue', href: '/erm/internal-controls', color: '#0891b2' },
  { key: 'vendor_overdue_reassessments', label: 'Vendor overdue reassessments', href: '/vendor-risk/vendors', color: '#c026d3' },
  { key: 'vendor_critical_findings', label: 'Vendor critical findings', href: '/vendor-risk/findings', color: '#e11d48' },
  { key: 'vendor_overdue_remediations', label: 'Vendor overdue remediations', href: '/vendor-risk/findings', color: '#0d9488' },
  { key: 'red_kris', label: 'Red KRIs', href: '/erm/kris', color: '#f43f5e' },
  { key: 'appetite_breaches', label: 'Appetite breaches', href: '/erm/appetite', color: '#9333ea' },
  { key: 'overdue_mitigation_actions', label: 'Overdue risk actions', href: '/erm/mitigation-actions?filter=overdue', color: '#f59e0b' },
  { key: 'overdue_risk_reviews', label: 'Overdue risk reviews', href: '/erm/reviews', color: '#0284c7' },
  { key: 'open_critical_incidents', label: 'Open critical loss events', href: '/erm/incidents', color: '#b91c1c' },
];

const BAND_CHIP: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  unscored: 'bg-slate-100 text-slate-600 border-slate-200',
};
const BANDS = ['critical', 'high', 'medium', 'low', 'unscored'];
const WIDE = new Set(['ranked', 'table', 'paired_bars']);

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => Number(v) || 0;
const day = (v: unknown): string => (v ? new Date(String(v)).toLocaleDateString() : '');
const words = (v: unknown): string => text(v).replace(/_/g, ' ');

interface Props {
  questions: Array<{ question: string; rows: AudienceRow[] }>;
  perf: ModulePerformance;
  sections: Section[];
  onOpenProgramme: () => void;
}

/** One audience's questions as section headings, each with its measures. */
export default function AudienceRows({ questions, perf, sections, onOpenProgramme }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {questions.map((q) => (
        <section key={q.question}>
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">{q.question}</h2>
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            {q.rows.map((row) => (
              <div key={row.key} className={WIDE.has(row.visual) ? 'lg:col-span-2' : ''}>
                <Measure row={row} perf={perf} sections={sections} onOpenProgramme={onOpenProgramme} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Measure({ row, perf, sections, onOpenProgramme }: { row: AudienceRow } & Omit<Props, 'questions'>) {
  // The template reuses three existing widgets as they are.
  if (row.value !== null) {
    if (row.key === 'attention_queue') {
      const items = ATTENTION_META.map((m) => ({ ...m, count: num((row.items || []).find((i) => i.key === m.key)?.count) }));
      return <AttentionQueue items={items} total={num(row.value)} />;
    }
    if (row.visual === 'score_card') return <ModulePerformanceCard perf={perf} sections={sections} onClick={onOpenProgramme} />;
    if (row.visual === 'heatmap' && row.cells) {
      return <RiskHeatmap data={{ inherent: toMatrix(row.cells.inherent), residual: toMatrix(row.cells.residual) }} />;
    }
  }
  const href = drillHref(row);
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{row.label}</h3>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{row.definition}</p>
        </div>
        {href && (
          <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline">
            Open <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <p className={`mt-2.5 font-bold leading-tight ${row.value === null ? 'text-base text-slate-400' : 'text-2xl text-slate-900'}`}>
        {formatRowValue(row)}
      </p>
      {row.value === null ? (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-slate-500">
          <HelpCircle className="mt-px h-3 w-3 shrink-0" />{row.reason}
        </p>
      ) : (
        <div className="mt-2">{body(row)}</div>
      )}
      {row.note && <p className="mt-2 text-[10.5px] text-slate-400">{row.note}</p>}
    </div>
  );
}

function body(row: AudienceRow): ReactNode {
  const items = row.items || [];
  switch (row.visual) {
    case 'figure':
      return row.denominator !== undefined
        ? <p className="text-[11px] text-slate-500">{row.numerator} of {row.denominator}{row.target ? ` · target ${row.target}%` : ''}</p>
        : <ItemList items={items.map((i) => ({ ...i, title: `${text(i.label)}: ${text(i.count)}` }))}
            empty={row.checked?.length ? `None found. Checked: ${row.checked.join(', ')}.` : 'None found.'} />;
    case 'category_bars':
      return <Bars rows={items.map((i) => ({ label: `${words(i.category)} · ${num(i.outside)} of ${num(i.scored)} above ${text(i.tolerance)}`, value: num(i.outside), href: text(i.link) }))} />;
    case 'unit_bars':
      return <Bars rows={items.map((i) => ({ label: `${text(i.unit)} · ${num(i.count)}`, value: num(i.count) }))} />;
    case 'stacked_bars':
      return <Stacked items={items} />;
    case 'paired_bars':
      return <PairedLosses items={items} />;
    case 'ranked':
      return <Ranked items={items} />;
    case 'two_counts':
      return (
        <div className="grid grid-cols-2 gap-2">
          {items.map((i) => (
            <Link key={text(i.key)} href={text(i.link)} className="rounded-xl border border-slate-100 p-2.5 hover:border-slate-300 hover:bg-slate-50/70">
              <div className={`text-[22px] font-bold leading-none ${num(i.count) ? 'text-slate-900' : 'text-slate-300'}`}>{num(i.count)}</div>
              <div className="mt-1.5 text-[10.5px] text-slate-500">{text(i.label)}</div>
            </Link>
          ))}
        </div>
      );
    case 'band_list':
      return (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {BANDS.map((b) => (
              <span key={b} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${BAND_CHIP[b]}`}>
                {b === 'unscored' ? 'Not scored' : b} {row.bands?.[b] ?? 0}
              </span>
            ))}
          </div>
          <ItemList items={items.map((i) => ({ ...i, detail: i.review_date ? `Next review ${day(i.review_date)}` : 'No review date' }))} />
        </>
      );
    case 'table':
      return <ChangeTable items={items} />;
    case 'matrix':
      return <Matrix items={items} />;
    case 'list':
    case 'count_list':
      return <ItemList items={items} />;
    default:
      return null;
  }
}

function detailOf(i: Item): string {
  const due = i.due_date ?? i.next_due_date ?? i.expires_at ?? i.due;
  const parts = [
    due ? `${i.expires_at ? 'Ends' : 'Due'} ${day(due)}` : '',
    i.overdue || i.state === 'expired' ? (i.expires_at ? 'expired' : 'overdue') : '',
    i.pending_review ? 'waiting for its check' : '',
    text(i.note),
  ];
  return text(i.detail) || parts.filter(Boolean).join(' · ');
}

function ItemList({ items, empty = 'Nothing here.' }: { items: Item[]; empty?: string }) {
  if (!items.length) return <p className="text-[11px] text-slate-400">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((i, idx) => {
        const title = text(i.title ?? i.name ?? i.code);
        const detail = detailOf(i);
        const inner = (
          <>
            <span className="block truncate text-[12.5px] font-medium text-slate-800">{title}</span>
            {detail && <span className="block truncate text-[10.5px] text-slate-500">{detail}</span>}
          </>
        );
        return (
          <li key={`${text(i.id ?? i.source ?? title)}-${idx}`} className="py-1.5">
            {i.link ? <Link href={text(i.link)} className="block hover:text-blue-700">{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}

function Bars({ rows }: { rows: Array<{ label: string; value: number; href?: string }> }) {
  if (!rows.length) return <p className="text-[11px] text-slate-400">Nothing here.</p>;
  const widths = barWidths(rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r, idx) => (
        <div key={r.label}>
          <p className="mb-0.5 text-[11px] text-slate-600 first-letter:uppercase">{r.label}</p>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-rose-500" style={{ width: `${widths[idx]}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stacked({ items }: { items: Item[] }) {
  return (
    <div className="space-y-2">
      {items.map((u) => {
        const assigned = num(u.assigned) || 1;
        return (
          <Link key={text(u.unit)} href={text(u.link)} className="block hover:opacity-80">
            <p className="mb-0.5 text-[11px] text-slate-600">
              {text(u.unit)} · {num(u.submitted)} of {num(u.assigned)} submitted · {num(u.approved)} approved
            </p>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-500" style={{ width: `${(num(u.approved) / assigned) * 100}%` }} />
              <div className="bg-blue-400" style={{ width: `${((num(u.submitted) - num(u.approved)) / assigned) * 100}%` }} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** Two bars per event type, this quarter and last; each currency on its own scale, never added together. */
function PairedLosses({ items }: { items: Item[] }) {
  if (!items.length) return <p className="text-[11px] text-slate-400">No net loss booked this quarter or last.</p>;
  const currencies = Array.from(new Set(items.map((i) => text(i.currency))));
  return (
    <div className="space-y-3">
      <p className="flex gap-3 text-[10.5px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-800" />This quarter</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-300" />Last quarter</span>
      </p>
      {currencies.map((cur) => {
        const rows = items.filter((i) => text(i.currency) === cur);
        const widths = barWidths(rows.flatMap((r) => [num(r.this_quarter), num(r.last_quarter)]));
        return (
          <div key={cur} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{cur || 'No currency'}</p>
            {rows.map((r, idx) => (
              <div key={text(r.event_type)}>
                <p className="mb-0.5 text-[11px] text-slate-600">
                  {text(r.label)} · {formatMoney(num(r.this_quarter), text(r.currency))} vs {formatMoney(num(r.last_quarter), text(r.currency))}
                </p>
                <div className="space-y-0.5">
                  <div className="h-1.5 rounded-full bg-slate-800" style={{ width: `${widths[idx * 2]}%` }} />
                  <div className="h-1.5 rounded-full bg-slate-300" style={{ width: `${widths[idx * 2 + 1]}%` }} />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="text-[10px] text-slate-300">—</span>;
  const max = Math.max(...points, 1);
  const path = points.map((p, i) => `${(i / (points.length - 1)) * 60},${18 - (p / max) * 16}`).join(' ');
  return (
    <svg width="60" height="20" viewBox="0 0 60 20" aria-label={`Residual history: ${points.join(', ')}`}>
      <polyline points={path} fill="none" stroke="#64748b" strokeWidth="1.5" />
    </svg>
  );
}

function Ranked({ items }: { items: Item[] }) {
  if (!items.length) return <p className="text-[11px] text-slate-400">No scored open risks.</p>;
  return (
    <table className="min-w-full text-sm">
      <thead className="text-left text-[10.5px] uppercase tracking-wide text-slate-500">
        <tr><th className="py-1 pr-2">Risk</th><th className="px-2">Before</th><th className="px-2">After</th><th className="px-2">Since last review</th><th className="pl-2">History</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((r) => {
          const Arrow = r.direction === 'up' ? ArrowUpRight : r.direction === 'down' ? ArrowDownRight : null;
          return (
            <tr key={text(r.id)}>
              <td className="max-w-[260px] truncate py-1.5 pr-2"><Link href={text(r.link)} className="font-medium text-slate-800 hover:text-blue-700">{text(r.title)}</Link></td>
              <td className="px-2 text-slate-600">{text(r.inherent) || '—'}</td>
              <td className="px-2 font-semibold text-slate-900">{text(r.residual) || '—'}</td>
              <td className={`px-2 text-[12px] ${r.direction === 'up' ? 'text-rose-600' : r.direction === 'down' ? 'text-emerald-600' : 'text-slate-400'}`}>
                <span className="inline-flex items-center gap-0.5">{Arrow && <Arrow className="h-3 w-3" />}{changeLabel(r.change as number | null)}</span>
              </td>
              <td className="pl-2"><Sparkline points={(r.history as number[]) || []} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChangeTable({ items }: { items: Item[] }) {
  if (!items.length) return <p className="text-[11px] text-slate-400">No score changes in the period.</p>;
  return (
    <table className="min-w-full text-sm">
      <thead className="text-left text-[10.5px] uppercase tracking-wide text-slate-500">
        <tr><th className="py-1 pr-2">When</th><th className="px-2">Risk</th><th className="px-2">Who</th><th className="px-2">Why</th><th className="pl-2">After</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((h, idx) => (
          <tr key={`${text(h.risk_id)}-${idx}`}>
            <td className="whitespace-nowrap py-1.5 pr-2 text-[12px] text-slate-600">{day(h.when)}</td>
            <td className="max-w-[220px] truncate px-2"><Link href={text(h.link)} className="font-medium text-slate-800 hover:text-blue-700">{text(h.risk_title)}</Link></td>
            <td className="px-2 text-[12px] text-slate-600">{text(h.by) || 'Not recorded'}</td>
            <td className="max-w-[260px] truncate px-2 text-[12px] text-slate-600">{text(h.reason) || text(h.label) || '—'}</td>
            <td className="pl-2 text-[12px] text-slate-700">{text(h.residual) || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Matrix({ items }: { items: Item[] }) {
  // rows by materiality (third party, wave 4) carry their own label; older rows are tiers
  const byLabel = items.some((r) => r.label);
  return (
    <table className="min-w-full text-center text-[12px]">
      <thead className="text-[10px] uppercase tracking-wide text-slate-500">
        <tr><th className="py-1 text-left">{byLabel ? 'Materiality' : 'Tier'} \ band</th>{BANDS.map((b) => <th key={b} className="px-1">{b === 'unscored' ? 'not scored' : b}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {items.map((r) => (
          <tr key={text(r.label ?? r.tier)}>
            <td className={`py-1 text-left text-slate-700 ${byLabel ? '' : 'capitalize'}`}>{text(r.label ?? r.tier)}</td>
            {BANDS.map((b) => <td key={b} className={num(r[b]) ? 'font-semibold text-slate-900' : 'text-slate-300'}>{num(r[b])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
