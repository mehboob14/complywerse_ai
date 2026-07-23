'use client';

/**
 * IT Assets — Inventory scorecard (board-level, formula-driven). Sits at the top
 * of /assets above the existing donuts/table. Seven scored sections (inventory
 * hygiene, criticality coverage, vulnerability exposure, remediation health, CIS
 * benchmark, scan & monitoring, lifecycle & exposure) blended into one inventory
 * score, each metric's formula one click away. Data: GET
 * /assets/inventory-overview (all scoring server-side).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { AlertTriangle, ShieldCheck, ServerCog, SlidersHorizontal, ChevronDown, LayoutGrid } from 'lucide-react';
import { scoreBand, ScoreRing, SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import ScoreBreakdownCard, { scoreCardRow } from '@/components/dashboard/ScoreBreakdownCard';
import { SectionWeightTunerModal } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';

const ASSETS_TUNING = { configBase: '/assets', invalidateKey: [...SCORECARD_QUERY_KEYS.assets] as unknown[] };

type Payload = {
  as_of: string | null;
  counts: { assets?: number; vulnerabilities?: number; open_vulnerabilities?: number };
  performance: { score: number | null; grade: string | null };
  sections: Record<string, OverviewSection>;
  attention_queue: Record<string, number>;
};

const ORDER = ['hygiene', 'criticality', 'vulnerability', 'vuln_health', 'cis', 'scan', 'lifecycle'];
const ATTENTION: Array<{ key: string; label: string; color: string }> = [
  { key: 'open_critical_high_vulns', label: 'Open critical/high vulnerabilities', color: '#e11d48' },
  { key: 'assets_without_owner', label: 'Assets with no owner', color: '#d97706' },
  { key: 'assets_unassessed', label: 'Assets not criticality-assessed', color: '#8b5cf6' },
  { key: 'stale_assets', label: 'Stale assets (not scanned 30d+)', color: '#64748b' },
  { key: 'internet_facing_unassessed', label: 'Internet-facing, unassessed', color: '#0ea5e9' },
];

function pct(n: number | null | undefined) { return n == null ? '—' : Math.round(n); }

export default function InventoryScorecard() {
  const [open, setOpen] = useState<OverviewSection | null>(null);
  const [tuning, setTuning] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.assets],
    queryFn: async () => {
      try { return (await apiClient.get('/assets/inventory-overview')).data as Payload; }
      catch { return null; }
    },
  });

  if (isLoading) {
    return (
      <div className="mb-5 space-y-3">
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_0.7fr]">{[1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-2xl" />)}</div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">{[1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div>
      </div>
    );
  }

  const payload = data ?? {
    as_of: null,
    counts: { assets: 0, vulnerabilities: 0, open_vulnerabilities: 0 },
    performance: { score: null, grade: null },
    sections: {},
    attention_queue: { total: 0 },
  } as Payload;

  const perf = payload.performance;
  const band = scoreBand(perf.score);
  const sections = ORDER.map((k) => payload.sections[k]).filter((s): s is OverviewSection => Boolean(s));
  const attn = ATTENTION.map((a) => ({ ...a, count: payload.attention_queue?.[a.key] ?? 0 }));
  const attnTotal = payload.attention_queue?.total ?? 0;
  const scoredSections = sections.filter((s) => s.score != null);

  // Design-handoff warm palette. Grade colour by score band (≥80 STRONG green /
  // ≥55 FAIR amber / else WEAK rust); dimension bars ≥70 green / ≥45 amber / rust.
  const s0 = perf.score ?? 0;
  const sColor = s0 >= 80 ? '#0E5A46' : s0 >= 55 ? '#B08420' : '#A33B1F';
  const sBg = s0 >= 80 ? '#E2EDE8' : s0 >= 55 ? '#F4ECD2' : '#F7E4DC';
  const gradeLabel = perf.grade || (s0 >= 80 ? 'STRONG' : s0 >= 55 ? 'FAIR' : 'WEAK');
  const dimColor = (n: number | null | undefined) => ((n ?? 0) >= 70 ? '#0E5A46' : (n ?? 0) >= 45 ? '#B08420' : '#C2542E');

  return (
    <div className="mb-6 space-y-3.5">
      {/* hero — Inventory score + Needs attention (design handoff, warm theme) */}
      <div className="as-hero as-fadeup" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14 }}>
        {/* Inventory score card */}
        <div className="as-card" style={{ padding: '22px 24px', display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ position: 'relative', width: 130, height: 130 }}>
              <svg width="130" height="130" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" style={{ fill: 'none', stroke: 'var(--as-track)', strokeWidth: 9 }} />
                <circle cx="60" cy="60" r="52" transform="rotate(-90 60 60)" style={{ fill: 'none', stroke: sColor, strokeWidth: 9, strokeLinecap: 'round', strokeDasharray: 327, strokeDashoffset: 327 * (1 - s0 / 100), transition: 'stroke-dashoffset .8s ease' }} />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div className="as-mono" style={{ fontSize: 34, fontWeight: 600, color: sColor, lineHeight: 1 }}>{pct(perf.score)}</div>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.8, color: 'var(--as-faint)', marginTop: 4 }}>SCORE</div>
              </div>
            </div>
            {gradeLabel && <span className="as-pill" style={{ fontWeight: 700, letterSpacing: 0.8, color: sColor, background: sBg }}>{gradeLabel}</span>}
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div className="as-label">Inventory score</div>
                <div style={{ fontSize: 12, color: 'var(--as-muted)', marginTop: 2 }}>target <span className="as-mono" style={{ fontWeight: 600, color: 'var(--as-ink)' }}>85</span></div>
              </div>
              {!tuning && (
                <button type="button" onClick={() => setTuning(true)} className="as-btn as-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', fontSize: 12, flex: 'none' }}>
                  <SlidersHorizontal className="h-3 w-3" /> Adjust weights
                </button>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--as-secondary)', marginTop: 4 }}>{payload.counts.assets ?? 0} assets · {payload.counts.open_vulnerabilities ?? 0} open vulns · {attnTotal} attention items</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16 }}>
              {scoredSections.length ? scoredSections.map((s) => {
                const c = dimColor(s.score);
                const w = (s as unknown as { weight?: number }).weight;
                return (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 150, flex: 'none', fontSize: 12.5, color: 'var(--as-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                    {/* weight may arrive as a fraction (0.18) or a percent (18) */}
                    <span className="as-mono" style={{ width: 32, flex: 'none', fontSize: 11, color: 'var(--as-faint)' }}>{w ? `${Math.round(w <= 1 ? w * 100 : w)}%` : ''}</span>
                    <div style={{ flex: 1, height: 6, background: 'var(--as-track)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.score ?? 0}%`, background: c, borderRadius: 3 }} />
                    </div>
                    <span className="as-mono" style={{ width: 28, flex: 'none', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c }}>{pct(s.score)}</span>
                  </div>
                );
              }) : (
                <p style={{ fontSize: 12, color: 'var(--as-faint)' }}>No scored inventory areas yet — add assets or run a vulnerability scan.</p>
              )}
            </div>
          </div>
        </div>

        {/* Needs attention card */}
        <div className="as-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Needs attention</div>
            <span className="as-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-danger-text)', background: 'var(--as-danger-bg)', borderRadius: 99, padding: '3px 10px' }}>{attnTotal}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--as-muted)', marginTop: 3 }}>Assets flagged for follow-up</div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
            {attn.map((i) => (
              <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px', borderRadius: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: i.count > 0 ? i.color : 'var(--as-disabled)', flex: 'none' }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--as-primary)' }}>{i.label}</span>
                <span className="as-mono" style={{ fontSize: 13, fontWeight: 600, color: i.count > 0 ? 'var(--as-ink)' : 'var(--as-disabled)' }}>{i.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* score breakdown — collapsible; the hero bars above already summarise these 7 dimensions,
          so the detailed radial cards are opt-in and laid out to avoid an orphan row (4-up / 7-up). */}
      {sections.length > 0 && (
        <div className="as-card as-fadeup" style={{ overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-expanded={showBreakdown}
            className="group"
            style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 22px', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ display: 'flex', height: 36, width: 36, flex: 'none', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: 'var(--as-green-bg)', color: 'var(--as-green)' }}>
                <LayoutGrid className="h-5 w-5" />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600, color: 'var(--as-ink)' }}>
                  Score breakdown
                  <span className="as-label" style={{ background: 'var(--as-track)', borderRadius: 99, padding: '2px 8px' }}>{sections.length} dimensions</span>
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--as-muted)' }}>Detailed radial scores per inventory area</span>
              </span>
            </span>
            <span className="as-btn as-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12 }}>
              {showBreakdown ? 'Hide' : 'Show'}
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showBreakdown ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {/* 4-up max → 4 + 3 rows. Squeezing all 7 into one row truncated the
              dimension names ("Inve…", "Critic…"), so the grid caps at 4. */}
          {showBreakdown && (
            <div style={{ ...scoreCardRow(sections.length), padding: 16, borderTop: '1px solid var(--as-divider)' }}>
              {sections.map((s, i) => (
                <ScoreBreakdownCard key={s.key} section={s} variant={i % 2 === 0 ? 'leader' : 'bars'} onOpen={() => setOpen(s)} />
              ))}
            </div>
          )}
        </div>
      )}

      {tuning && (
        <SectionWeightTunerModal sections={sections} configBase={ASSETS_TUNING.configBase} invalidateKey={ASSETS_TUNING.invalidateKey} onClose={() => setTuning(false)} />
      )}
      <SectionDetailModal section={open} onClose={() => setOpen(null)} tuning={ASSETS_TUNING} />
    </div>
  );
}
