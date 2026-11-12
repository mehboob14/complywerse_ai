'use client';

// ScoreRing: the one score of a page as a ring, 0 to 100, with the figure in the middle, an optional tick for its target and the words under it (the grade the
// SERVER gives it: this component never decides what a score means). `tone` is the grade's colour and the words repeat it, so the ring is never the only signal.
// A score that is not recorded (value null) is a grey ring and "Not recorded", never an empty ring that reads as 0.
//
//   <ScoreRing value={72} target={80} tone="good" caption="Governance score" below={<StatusPill … />} href="/reports" />
// With `href` the ring is a link to the records the score is made of (Overview rule R6): a 24px-tall target is the whole ring, the name says where it goes, and the
// focus ring is drawn round it.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { openLinkName, ringDash } from './chartModel';
import { INK_STRONG, STATUS, TRACK, type StatusColor } from './palette';

export interface ScoreRingProps {
  /** 0 to 100; null: not recorded */
  value: number | null;
  /** the target on the same scale, drawn as a tick on the ring */
  target?: number | null;
  /** the colour of the arc: what the server's grade says (good / warn / bad); default progress blue */
  tone?: StatusColor;
  /** names the score for a screen reader: "Governance score" */
  caption: string;
  /** diameter in px (default 132) */
  size?: number;
  /** what goes under the ring: the grade pill, the target in words */
  below?: ReactNode;
  /** the ring opens the records behind the score */
  href?: string;
  /** the link's name for a screen reader when "Open <caption>" is not enough: "Open the governance scorecard" */
  hrefLabel?: string;
}

const STROKE = 12;

export function ScoreRing({ value, target, tone = 'progress', caption, size = 132, below, href, hrefLabel }: ScoreRingProps) {
  const r = (size - STROKE) / 2;
  const c = size / 2;
  const { circumference, dash } = ringDash(value ?? 0, r);
  const text = value === null ? `${caption}: not recorded` : `${caption}: ${Math.round(value)} out of 100${target != null ? `, target ${Math.round(target)}` : ''}`;
  const tick = target != null && target >= 0 && target <= 100 ? (target / 100) * 2 * Math.PI - Math.PI / 2 : null;
  const ring = (
    <>
      <div className="relative" style={{ width: size, height: size }}>
        <svg {...(href ? { 'aria-hidden': true } : { role: 'img', 'aria-label': text })} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
          <circle cx={c} cy={c} r={r} fill="none" stroke={TRACK} strokeWidth={STROKE} />
          {value !== null && dash > 0 && (
            <circle cx={c} cy={c} r={r} fill="none" stroke={STATUS[tone]} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`} transform={`rotate(-90 ${c} ${c})`} />
          )}
          {tick !== null && (
            <line x1={c + (r - STROKE / 2 - 2) * Math.cos(tick)} y1={c + (r - STROKE / 2 - 2) * Math.sin(tick)} x2={c + (r + STROKE / 2 + 2) * Math.cos(tick)} y2={c + (r + STROKE / 2 + 2) * Math.sin(tick)} stroke={INK_STRONG} strokeWidth={2} strokeLinecap="round" />
          )}
        </svg>
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[32px] font-[600] leading-[36px] tabular-nums text-ds-fg">{value === null ? '—' : Math.round(value)}</span>
          <span className="text-ds-label text-ds-fg-muted">{value === null ? 'Not recorded' : 'out of 100'}</span>
        </div>
      </div>
    </>
  );
  return (
    <div className="flex flex-col items-center gap-[8px]">
      {href ? (
        <Link href={href} title={`${text}. ${openLinkName(caption, hrefLabel)}`} aria-label={`${text}. ${openLinkName(caption, hrefLabel)}`} className="block rounded-full hover:opacity-90 focus-visible:outline-none focus-visible:shadow-ds-ring">{ring}</Link>
      ) : ring}
      {below}
    </div>
  );
}
