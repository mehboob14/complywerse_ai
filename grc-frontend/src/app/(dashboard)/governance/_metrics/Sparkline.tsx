'use client';

// The small trend line of a metric: the same drawing the report always had (metricModel.sparkGeometry), now said in words as well. The picture is an
// image with a name ("Trend over 6 measurements: rising, from 70% to 88%") so a screen reader and the hover tooltip have the numbers; with fewer than two
// measurements there is nothing to draw and the cell says so. Only the --ds tokens and arbitrary values (the platform CSS repaints the named ones).
import { describeTrend, sparkGeometry, type Point } from './metricModel';

const W = 120;
const H = 36;

export function Sparkline({ points, unit }: { points?: Point[]; unit?: string | null }) {
  const geometry = sparkGeometry(points, W, H);
  if (!geometry) return <span className="whitespace-nowrap text-ds-label font-normal text-ds-fg-muted" title={describeTrend(points, unit)}>Collecting data</span>;
  const words = describeTrend(points, unit);
  return (
    <svg role="img" aria-label={words} viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none" className="block max-w-full">
      <title>{words}</title>
      <path d={geometry.area} className="fill-ds-primary" fillOpacity={0.1} />
      <path d={geometry.line} fill="none" className="stroke-ds-primary" strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={geometry.last.x} cy={geometry.last.y} r={2.2} className="fill-ds-primary" />
    </svg>
  );
}
