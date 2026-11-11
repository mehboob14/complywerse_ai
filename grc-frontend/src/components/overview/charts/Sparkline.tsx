'use client';

// Sparkline: the shape of a figure over time, in 80 x 28 px, for a KPI tile. Pure SVG (no recharts: it is a dozen of them on a page). It is a picture with a
// text alternative: `label` says what it is and `summary` says where it went ("From 12 in May to 18 in Oct, up 6": trendText), and a series with fewer than two
// recorded points draws nothing and says so. A missing point breaks the line; it is never drawn as 0. Colour is the tile's (BRAND by default), never the only signal.
import { BRAND, SURFACE } from './palette';
import { sparkGeometry } from './chartModel';

export interface SparklineProps {
  /** the recorded points, oldest first; null for a month with no record */
  values: ReadonlyArray<number | null | undefined>;
  /** what it is: "Open issues, last 12 months" */
  label: string;
  /** where it went, in words: trendText(...) */
  summary?: string;
  color?: string;
  /** the y range starts at this (0 for a share or a count that is never negative), so a small change is not drawn as a cliff */
  floor?: number;
  width?: number;
  height?: number;
}

export function Sparkline({ values, label, summary, color = BRAND, floor, width = 80, height = 28 }: SparklineProps) {
  const g = sparkGeometry(values, width, height, 3, floor);
  if (g.lines.length === 0) return null;
  return (
    <svg role="img" aria-label={summary ? `${label}. ${summary}` : label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block shrink-0">
      {g.area && <path d={g.area} fill={color} fillOpacity={0.12} stroke="none" />}
      {g.lines.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />)}
      {g.last && <circle cx={g.last.x} cy={g.last.y} r={3} fill={color} stroke={SURFACE} strokeWidth={2} />}
    </svg>
  );
}
