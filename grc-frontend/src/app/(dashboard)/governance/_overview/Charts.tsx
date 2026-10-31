'use client';

// The two charts of the Overview: the posture radar (each section's score against its target, with the same numbers as a list beside it) and the
// content throughput (documents created and published each month). The charts keep recharts; every label is 12px, the colours are the kit's brand teal
// and the tone table's neutral (hex, because an SVG attribute cannot read a class), and each chart has its numbers in words (role="img" + aria-label,
// from overviewModel) so it is not a picture to a screen reader. recharts' own keyboard layer is off: one text alternative, no extra Tab stop.
import { Shield, TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, SectionCard, Skeleton } from '@/components/ui/ds';
import { EMPTY, formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { scoreBand } from '@/components/dashboard/score-kit';
import {
  BAND_TONE, RADAR_MIN_SPOKES, postureRows, postureSummary, radarSpokes, scoreText, trendIsEmpty, trendRows, trendSummary, trendTotals,
  type Scorecard, type TrendPoint,
} from './overviewModel';
import { FeedError, type Feed } from './parts';

const GRID = '#e1e6eb';          // --ds-border
const INK = '#586472';           // --ds-fg-muted
const BRAND = '#0f766e';         // --ds-primary
const NEUTRAL = TONE.neutral.dot;
const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' };

function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function PostureCard({ feed, onOpenBreakdown }: { feed: Feed<Scorecard>; onOpenBreakdown: () => void }) {
  const rows = postureRows(feed.data?.performance?.components);
  const spokes = radarSpokes(rows);
  const noData = rows.length - spokes.length;
  return (
    <SectionCard
      id="posture"
      title="Governance Posture Radar"
      info="Each section's score against its target. A section with no data yet is left out of the shape and listed as No data."
      meta={noData > 0 ? `${noData} ${noData === 1 ? 'section has' : 'sections have'} no data` : undefined}
      actions={feed.load === 'ready' && rows.length > 0 ? <Button size="sm" onClick={onOpenBreakdown}>How is the score calculated?</Button> : undefined}
    >
      {feed.load === 'loading' ? (
        <Loading label="Loading the posture radar">
          <div className="grid gap-[16px] md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <Skeleton className="mx-auto h-[232px] w-full max-w-[320px]" />
            <div className="space-y-[12px]">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[28px] w-full" />)}</div>
          </div>
        </Loading>
      ) : feed.load === 'error' ? (
        <FeedError title="Couldn't load the posture radar" feed={feed} />
      ) : spokes.length === 0 ? (
        <EmptyState kind="firstUse" icon={Shield} bare title="No section scores yet" description="Scores appear here once there are documents, reviews or approvals to measure." />
      ) : (
        <div className="grid items-center gap-[16px] md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          {spokes.length >= RADAR_MIN_SPOKES && (
            <div role="img" aria-label={postureSummary(rows)} className="mx-auto h-[232px] w-full max-w-[320px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <RadarChart data={spokes} outerRadius={78} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} accessibilityLayer={false}>
                  <PolarGrid stroke={GRID} />
                  <PolarAngleAxis dataKey="short" tick={{ fontSize: 12, fill: INK }} />
                  <PolarRadiusAxis axisLine={false} tick={false} domain={[0, 100]} />
                  <Radar name="Target" dataKey="target" stroke={NEUTRAL} fill="none" strokeWidth={1.5} strokeDasharray="4 3" />
                  <Radar name="Current" dataKey="score" stroke={BRAND} fill={BRAND} fillOpacity={0.18} strokeWidth={2} />
                  <Tooltip contentStyle={TIP} formatter={(value) => `${value}%`} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className={`min-w-0 space-y-[10px] ${spokes.length >= RADAR_MIN_SPOKES ? '' : 'md:col-span-2'}`}>
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-[8px] text-ds-body">
                  <span className="min-w-0 break-words font-[500] text-ds-fg">{r.label}</span>
                  <span className="shrink-0 tabular-nums text-ds-fg-muted">{scoreText(r.score)}</span>
                </div>
                <div aria-hidden className="mt-[4px] h-[6px] rounded-full bg-ds-border">
                  <div className="h-[6px] rounded-full" style={{ width: `${r.score === null ? 0 : Math.max(r.score === 0 ? 2 : 0, Math.min(100, r.score))}%`, background: TONE[BAND_TONE[scoreBand(r.score).label]].dot }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

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

export function ThroughputCard({ feed }: { feed: Feed<{ created?: TrendPoint[]; published?: TrendPoint[] }> }) {
  const rows = trendRows(feed.data);
  const totals = trendTotals(rows);
  const empty = trendIsEmpty(rows);
  return (
    <SectionCard id="throughput" title="Content Throughput" info="Documents created and published each month, over the last six months.">
      {feed.load === 'loading' ? (
        <Loading label="Loading the throughput">
          <div className="mb-[12px] grid grid-cols-3 gap-[8px]">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] w-full" />)}</div>
          <Skeleton className="h-[320px] w-full" />
        </Loading>
      ) : feed.load === 'error' ? (
        <FeedError title="Couldn't load the throughput" feed={feed} />
      ) : empty ? (
        <EmptyState kind="firstUse" icon={TrendingUp} bare title="No documents created or published yet" description="The last six months appear here once documents are created or published." />
      ) : (
        <>
          <div className="mb-[12px] grid grid-cols-3 gap-[8px]">
            <Stat label="Created" value={formatCount(totals.created)} dot={NEUTRAL} />
            <Stat label="Published" value={formatCount(totals.published)} dot={BRAND} />
            <Stat label="Live rate" value={totals.liveRate === null ? EMPTY : `${totals.liveRate}%`} info="Documents published in these months as a share of the documents created in them." />
          </div>
          <div role="img" aria-label={trendSummary(rows)} className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
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
        </>
      )}
    </SectionCard>
  );
}
