'use client';

/**
 * Asset Inventory — KPI strip + charts row (design handoff, warm theme).
 * All figures computed live from the real asset list: portfolio totals, the
 * criticality mix, a 6-month "added over time" trend, and total valuation.
 */
import type { ITAsset } from '@/types';
import { SegmentedMixCard } from '@/components/charts/MixCharts';

const CRIT: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: '#A33B1F' },
  high: { label: 'High', color: '#C2542E' },
  medium: { label: 'Medium', color: '#C79A2A' },
  low: { label: 'Low', color: '#0E5A46' },
};
const CRIT_ORDER = ['critical', 'high', 'medium', 'low'] as const;

function fmtMoney(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

const critOf = (a: ITAsset) => (a.criticality || '').toLowerCase();

export function InventoryStats({ assets, onCrit }: { assets: ITAsset[]; onCrit?: (c: string) => void }) {
  const total = assets.length;
  const critical = assets.filter((a) => critOf(a) === 'critical').length;
  const needCia = assets.filter((a) => !(a.confidentiality_rating && a.integrity_rating && a.availability_rating)).length;
  const cde = assets.filter((a) => a.cde_environment).length;
  const now = Date.now();
  const stale = assets.filter((a) => !a.last_seen_at || (now - new Date(a.last_seen_at).getTime()) > 30 * 864e5).length;

  const kpis = [
    { value: total, label: 'Total assets', color: 'var(--as-ink)' },
    { value: critical, label: 'Critical', color: '#A33B1F' },
    { value: needCia, label: 'Need CIA', color: '#B08420' },
    { value: cde, label: 'CDE / PCI', color: 'var(--as-ink)' },
    { value: stale, label: 'Stale > 30d', color: '#A33B1F' },
  ];

  const critCounts = CRIT_ORDER.map((k) => ({ k, ...CRIT[k], count: assets.filter((a) => critOf(a) === k).length }));
  const critMax = Math.max(1, ...critCounts.map((c) => c.count));
  const totalValue = assets.reduce((s, a) => s + (a.valuation || a.purchase_cost || 0), 0);

  // 6-month "added over time", stacked by criticality (from created_at).
  const d0 = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(d0.getFullYear(), d0.getMonth() - (5 - i), 1);
    return { y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleString('en-US', { month: 'short' }) };
  });
  const buckets = months.map((mo) => {
    const inMonth = assets.filter((a) => {
      if (!a.created_at) return false;
      const c = new Date(a.created_at);
      return c.getFullYear() === mo.y && c.getMonth() === mo.m;
    });
    return {
      label: mo.label,
      total: inMonth.length,
      segs: CRIT_ORDER.map((k) => ({ k, color: CRIT[k].color, count: inMonth.filter((a) => critOf(a) === k).length })),
    };
  });
  const barMax = Math.max(1, ...buckets.map((b) => b.total));

  return (
    <div className="as-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI strip */}
      <div className="as-card as-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {kpis.map((k, i) => (
          <div key={k.label} style={{ padding: '13px 18px', borderRight: i < kpis.length - 1 ? '1px solid var(--as-divider)' : 'none', display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
            <div className="as-mono" style={{ fontSize: 20, fontWeight: 600, color: k.color, flex: 'none' }}>{k.value}</div>
            <div style={{ fontSize: 12, color: 'var(--as-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* charts row */}
      <div className="as-hero" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14, alignItems: 'stretch' }}>
        {/* Assets added over time */}
        <div className="as-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Assets added over time</div>
            <div style={{ fontSize: 12, color: 'var(--as-muted)' }}>last 6 months · stacked by criticality</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, height: 120, marginTop: 16 }}>
            {buckets.map((b) => {
              const h = b.total > 0 ? Math.max(6, (b.total / barMax) * 104) : 0;
              return (
                <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  {b.total > 0 && <span className="as-mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--as-secondary)' }}>{b.total}</span>}
                  {/* The bar previously showed only its total, so a stack of four
                      colours gave no way to tell how many were critical vs low.
                      Each band now carries its own count when the band is tall
                      enough to hold a legible number, and the hover title spells
                      out the full split either way. */}
                  <div
                    title={`${b.label}: ${b.total} added — ` + b.segs.filter((s) => s.count > 0).map((s) => `${CRIT[s.k].label} ${s.count}`).join(', ')}
                    style={{ width: '100%', maxWidth: 56, height: h, display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}
                  >
                    {b.segs.map((s) => {
                      if (s.count <= 0) return null;
                      const pct = (s.count / Math.max(1, b.total)) * 100;
                      // Only label a band that is genuinely tall enough — a number
                      // crammed into a 6px sliver is worse than no number.
                      const tall = (pct / 100) * h >= 15;
                      return (
                        <div
                          key={s.k}
                          style={{ height: `${pct}%`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          {tall && (
                            <span className="as-mono" style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                              {s.count}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <span className="as-mono" style={{ fontSize: 11, color: 'var(--as-faint)' }}>{b.label}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 14, borderTop: '1px solid var(--as-divider)', paddingTop: 12, flexWrap: 'wrap' }}>
            {CRIT_ORDER.map((k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--as-secondary)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: CRIT[k].color }} /> {CRIT[k].label}
              </div>
            ))}
          </div>
        </div>

        {/* Criticality breakdown — moved here from AssetsWorkspace, which
            rendered the same card lower down the same page. This is the 1fr
            column of the charts row; it sat empty after the old, differently
            styled "By criticality" card was removed as a duplicate.
            `critCounts` already carries label/color/count, which is exactly
            the MixSlice shape this card expects. */}
        <SegmentedMixCard
          totalLabel="assets by criticality"
          data={critCounts.map((c) => ({ name: c.label, value: c.count, color: c.color }))}
        />
      </div>
    </div>
  );
}

export default InventoryStats;
