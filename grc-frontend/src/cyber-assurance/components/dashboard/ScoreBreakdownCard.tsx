'use client';

/**
 * Score-breakdown section card — the "asset-suite" treatment.
 * Drop-in replacement for score-kit's <SectionGraphCard/> (same props), used on
 * Governance and IT Assets. Two layouts, alternated across the grid:
 *   • "leader" — score ring + dotted-leader metric list
 *   • "bars"   — accent spine + big numeral + labelled progress bars
 *
 * Hand-built from inline-styled divs (no Recharts, no Tailwind utilities) so the
 * globals.css `!important` colour flattening can't touch it. Clicking the card
 * still opens the formula popup, and the weight "Adjust" flow is unchanged —
 * only the visual treatment differs.
 */
import type { CSSProperties } from 'react';
import type { OverviewSection } from './score-kit';

/** Warm paper palette. Each token reads the `.asset-suite` design-system var
 *  when one exists (so this themes correctly on /assets) and falls back to the
 *  reference design's hex everywhere else (e.g. Governance). */
const AS = {
  surface: 'var(--as-card, #fffefb)',
  border: 'var(--as-border, #e9e7e0)',
  divider: 'var(--as-divider, #efeee8)',
  track: 'var(--as-track, #eceae2)',
  leader: 'var(--as-input, #d8d5cb)',
  dot: 'var(--as-disabled, #cfccc2)',
  ink: 'var(--as-ink, #26241f)',
  body: 'var(--as-secondary, #3a372f)',
  muted: 'var(--as-muted, #a09a8e)',
  faint: 'var(--as-faint, #b3aea2)',
  good: 'var(--as-good, #2e7d5b)',
  fair: 'var(--as-warn, #b57d2b)',
  weak: 'var(--as-danger, #b23a55)',
  numeric: 'var(--as-numeric, "Newsreader", Georgia, "Times New Roman", serif)',
};

export type ScoreCardVariant = 'leader' | 'bars';

/** Gap between cards; the cards' flex-basis is derived from it. */
export const SCORE_CARD_GAP = 14;

/**
 * Columns per row for `count` cards. A fixed 4-up grid leaves a hole whenever
 * the count isn't a multiple of 4 (7 sections → 4 + 3 + one empty slot), and
 * simply letting the last row grow strands a single card stretched across the
 * full width (5 → 4 + 1). So: prefer a column count that divides evenly, else
 * one that leaves at least two cards on the final row.
 */
export function scoreCardColumns(count: number): number {
  if (count <= 3) return Math.max(1, count);
  for (const c of [4, 3]) if (count % c === 0) return c;   // 8 → 4+4, 6 → 3+3
  for (const c of [4, 3]) if (count % c >= 2) return c;    // 7 → 4+3, 5 → 3+2
  return 3;
}

/**
 * Row container for these cards. Flex, not grid, so the final row grows to fill
 * the width instead of leaving dead space. Publishes the per-card flex-basis as
 * `--sbc-basis`, which each card reads.
 */
export function scoreCardRow(count: number): CSSProperties {
  const cols = scoreCardColumns(count);
  return {
    display: 'flex',
    flexWrap: 'wrap',
    gap: SCORE_CARD_GAP,
    ['--sbc-basis' as string]: `calc(${100 / cols}% - ${(SCORE_CARD_GAP * (cols - 1)) / cols}px)`,
  } as CSSProperties;
}

/** Band → colour. Uses the app's existing thresholds (strong ≥80 / fair ≥60) so
 *  the card agrees with the formula popup it opens, rendered in the reference
 *  palette. */
function colorFor(score?: number | null): string {
  if (score == null) return AS.muted;
  if (score >= 80) return AS.good;
  if (score >= 60) return AS.fair;
  return AS.weak;
}
function ratingFor(score?: number | null): string {
  if (score == null) return 'NO DATA';
  if (score >= 80) return 'STRONG';
  if (score >= 60) return 'FAIR';
  return 'WEAK';
}
const pct = (n?: number | null) => (n == null ? null : Math.round(n));

/** Hand-built SVG gauge — hairline track + rounded progress arc. */
function Ring({ score, color, size = 74, stroke = 3.5 }: { score: number | null; color: string; size?: number; stroke?: number }) {
  const r = 35;
  const circ = 2 * Math.PI * r;
  const v = score == null ? 0 : Math.max(0, Math.min(100, score));
  // a literal 0 still needs a sliver so "weak" doesn't read as "no data"
  const len = score === 0 ? circ * 0.02 : (v / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      <svg viewBox="-40 -40 80 80" width={size} height={size} style={{ display: 'block' }}>
        <circle cx="0" cy="0" r={r} fill="none" stroke={AS.track} strokeWidth={stroke} />
        <circle cx="0" cy="0" r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${len} ${circ}`} strokeLinecap="round" transform="rotate(-90)" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: AS.numeric, fontSize: size * 0.35, fontWeight: 500, color: AS.ink }}>
          {score == null ? '—' : Math.round(score)}
        </span>
      </div>
    </div>
  );
}

export default function ScoreBreakdownCard({
  section,
  onOpen,
  variant = 'leader',
}: {
  section: OverviewSection;
  onOpen: () => void;
  variant?: ScoreCardVariant;
}) {
  const scoreColor = colorFor(section.score);
  const weightPct = Math.round((section.weight ?? 0) * 100);
  const metrics = section.metrics ?? [];

  const card: CSSProperties = {
    background: AS.surface,
    border: `1px solid ${AS.border}`,
    borderRadius: 14,
    boxShadow: '0 1px 2px rgba(40,36,28,.03)',
    padding: variant === 'bars' ? '20px 22px' : '22px 24px 18px',
    display: 'flex',
    flexDirection: 'column',
    // no explicit height: an explicit one stops the flex item stretching, which
    // leaves the cards in a row with ragged bottom edges.
    width: '100%',
    // basis published by scoreCardRow(); grow fills any short final row.
    // min-width forces the wrap earlier on narrow screens — no media queries.
    flex: `1 1 var(--sbc-basis, calc(25% - ${(SCORE_CARD_GAP * 3) / 4}px))`,
    minWidth: 260,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'box-shadow .18s ease, transform .18s ease, border-color .18s ease',
  };
  const numeral: CSSProperties = { fontFamily: AS.numeric, fontWeight: 500, color: scoreColor, lineHeight: 1 };

  const hoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.boxShadow = '0 6px 16px rgba(40,36,28,.09)';
    e.currentTarget.style.transform = 'translateY(-2px)';
    e.currentTarget.style.borderColor = AS.leader;
  };
  const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.boxShadow = '0 1px 2px rgba(40,36,28,.03)';
    e.currentTarget.style.transform = 'none';
    e.currentTarget.style.borderColor = AS.border;
  };

  // ─────────────────────────────── bars ──────────────────────────────────────
  if (variant === 'bars') {
    return (
      <button type="button" onClick={onOpen} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
        style={card} title={`${section.label} — click for the ${metrics.length} formulas`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <span style={{ width: 8, height: 36, borderRadius: 4, background: scoreColor, flex: '0 0 auto' }} />
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: AS.ink, letterSpacing: '-.005em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {section.label}
            </div>
            <div style={{ fontSize: 11.5, color: AS.muted, marginTop: 2 }}>{weightPct}% of module</div>
          </div>
          <span style={{ ...numeral, fontSize: 32, flex: '0 0 auto' }}>
            {section.score == null ? '—' : Math.round(section.score)}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {metrics.map((m) => {
            const v = pct(m.score);
            const c = colorFor(m.score);
            return (
              <div key={m.key ?? m.label}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
                  <span style={{ flex: '1 1 auto', fontSize: 13.5, fontWeight: 600, color: AS.body, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.label}
                  </span>
                  <span style={{ ...numeral, color: c, fontSize: 16 }}>
                    {v == null ? 'n/a' : v}
                    {v != null && <span style={{ fontSize: 10, color: AS.faint }}>%</span>}
                  </span>
                </div>
                <div style={{ height: 7, borderRadius: 5, background: AS.track, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${v == null ? 0 : Math.max(v === 0 ? 2 : 0, v)}%`, background: c, borderRadius: 5, transition: 'width .6s cubic-bezier(.4,0,.2,1)' }} />
                </div>
              </div>
            );
          })}
        </div>
      </button>
    );
  }

  // ────────────────────────────── leader ─────────────────────────────────────
  return (
    <button type="button" onClick={onOpen} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
      style={card} title={`${section.label} — click for the ${metrics.length} formulas`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 16, borderBottom: `1px solid ${AS.divider}` }}>
        <Ring score={section.score} color={scoreColor} />
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: AS.ink, letterSpacing: '-.005em' }}>{section.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: scoreColor }}>
              {ratingFor(section.score)}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: AS.dot }} />
            <span style={{ fontSize: 11.5, color: AS.muted }}>{weightPct}% of module</span>
          </div>
        </div>
      </div>

      <div style={{ paddingTop: 4 }}>
        {metrics.map((m) => {
          const v = pct(m.score);
          const c = colorFor(m.score);
          return (
            <div key={m.key ?? m.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 0' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flex: '0 0 auto', alignSelf: 'center' }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: AS.body, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '62%' }}>
                {m.label}
              </span>
              <span style={{ flex: '1 1 auto', borderBottom: `1px dotted ${AS.leader}`, transform: 'translateY(-4px)' }} />
              <span style={{ ...numeral, color: c, fontSize: 16 }}>
                {v == null ? 'n/a' : v}
                {v != null && <span style={{ fontSize: 10, color: AS.faint }}>%</span>}
              </span>
            </div>
          );
        })}
      </div>
    </button>
  );
}
