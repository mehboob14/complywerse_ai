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

    </div>
  );
}

export default InventoryStats;
