'use client';

// Content throughput: documents created and published each month over the last six months, with the totals and the live rate. The chart keeps recharts; every
// label is 12px, the colours are the kit's brand teal and the tone table's neutral (hex, because an SVG attribute cannot read a class), and the chart has its
// numbers in words (role="img" + aria-label, from overviewModel) so it is not a picture to a screen reader. recharts' own keyboard layer is off: one text
// alternative, no extra Tab stop. Beside the chart on a wide card, above it on a narrow one.
import { TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { InfoTip } from '@/components/ui/InfoTip';
import { EmptyState, Skeleton } from '@/components/ui/ds';
import { EMPTY, formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { trendIsEmpty, trendRows, trendSummary, trendTotals } from './overviewModel';
import type { TrendPoint } from './overviewModel';
import { Denied, FeedError, refused, type Feed } from './parts';

const GRID = '#e1e6eb';          // --ds-border
const INK = '#586472';           // --ds-fg-muted
const BRAND = '#0f766e';         // --ds-primary
const NEUTRAL = TONE.neutral.dot;
const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' };

function Stat({ label, value, dot, info }: { label: string; value: string; dot?: string; info?: string }) {
  return (
    <div className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
      <div className="flex items-center gap-[6px] text-ds-label text-ds-fg-muted">
        {dot && <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: dot }} />}
        <span className="min-w-0 break-words">{label}</span>
        {info && <InfoTip text={info} label={`About ${label.toLowerCase()}`} />}
      </div>
      <p className="text-ds-section tabular-nums text-ds-fg">{value}</p>
    </div>
  );
}

export function ThroughputBody({ feed }: { feed: Feed<{ created?: TrendPoint[]; published?: TrendPoint[] }> }) {
  const rows = trendRows(feed.data);
  const totals = trendTotals(rows);
  if (feed.load === 'loading') {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">Loading the throughput</span>
        <div className="mb-[12px] grid grid-cols-3 gap-[8px]">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] w-full" />)}</div>
        <Skeleton className="h-[180px] w-full" />
      </div>
    );
  }
  if (refused(feed)) return <Denied what="the throughput" />;
  if (feed.load === 'error') return <FeedError title="Couldn't load the throughput" feed={feed} />;
  if (trendIsEmpty(rows)) {
    return <EmptyState kind="firstUse" icon={TrendingUp} bare title="No documents created or published yet" description="The last six months appear here once documents are created or published." />;
  }
  return (
    <div className="grid gap-[12px] sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="grid grid-cols-3 gap-[8px] sm:grid-cols-1 sm:content-start">
        <Stat label="Created" value={formatCount(totals.created)} dot={NEUTRAL} />
        <Stat label="Published" value={formatCount(totals.published)} dot={BRAND} />
        <Stat label="Live rate" value={totals.liveRate === null ? EMPTY : `${totals.liveRate}%`} info="Documents published in these months as a share of the documents created in them." />
      </div>
      <div role="img" aria-label={trendSummary(rows)} className="h-[200px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minHeight={160}>
          <AreaChart data={rows.map((r) => ({ label: r.label, Created: r.created, Published: r.published }))} margin={{ top: 8, right: 12, left: -14, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid strokeDasharray="2 2" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TIP} />
            <Area type="monotone" dataKey="Created" stroke={NEUTRAL} strokeWidth={2} fill={NEUTRAL} fillOpacity={0.1} dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }} />
            <Area type="monotone" dataKey="Published" stroke={BRAND} strokeWidth={2} fill={BRAND} fillOpacity={0.14} dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
