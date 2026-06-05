'use client';

export const dynamic = 'force-dynamic';

// Criticality Assessments — Analytics
// ─────────────────────────────────────────────────────────────────────────
// KPI tiles + band donut + per-kind split + overdue-approvals table.
// Sources: /criticality-assessments/coverage for the headline counters,
// /criticality-assessments/{kind} list endpoints for the per-row drill
// (overdue approvals + top-by-score). Everything renders on the client
// so the page reflects writes immediately.

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart,
  Bar, XAxis, YAxis,
} from 'recharts';
import { ArrowLeft, ShieldCheck, Layers, AlertTriangle, Clock } from 'lucide-react';
import {
  criticalityApi,
  type CriticalityCoverage,
  type IscaItem,
  type IacaItem,
} from '@/lib/api';

const BAND_COLOR: Record<string, string> = {
  mission_critical: '#f43f5e',
  high: '#fb923c',
  moderate: '#facc15',
  low: '#34d399',
};
const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8',
  submitted: '#3b82f6',
  business_owner_review: '#f59e0b',
  ciso_review: '#8b5cf6',
  approved: '#10b981',
  rejected: '#f43f5e',
  returned: '#fb923c',
};

const SLA_DAYS = 14;

export default function CriticalityAnalyticsPage() {
  const coverageQ = useQuery<CriticalityCoverage>({
    queryKey: ['criticality.coverage'],
    queryFn: async () => (await criticalityApi.coverage()).data,
  });
  const iscaQ = useQuery<IscaItem[]>({
    queryKey: ['criticality.isca.list'],
    queryFn: async () => (await criticalityApi.infoSystem.list()).data,
  });
  const iacaQ = useQuery<IacaItem[]>({
    queryKey: ['criticality.iaca.list'],
    queryFn: async () => (await criticalityApi.infraAsset.list()).data,
  });

  const coverage = coverageQ.data;
  const iscas = iscaQ.data ?? [];
  const iacas = iacaQ.data ?? [];

  // Per-band donut data — only non-zero bands.
  const bandData = useMemo(() => {
    if (!coverage) return [];
    return Object.entries(coverage.by_band)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: k.replace('_', ' '), key: k, value: v, color: BAND_COLOR[k] || '#cbd5e1' }));
  }, [coverage]);

  // Per-kind split
  const kindData = useMemo(() => {
    if (!coverage) return [];
    return Object.entries(coverage.by_kind).map(([k, v]) => ({
      name: k.toUpperCase(), value: v, color: k === 'isca' ? '#3b82f6' : '#10b981',
    }));
  }, [coverage]);

  // Top 10 by score (combined ISCA + IACA — IACA scores are 0-4, ISCA 6-32,
  // so we normalise by criticality band weight rather than raw score).
  const bandWeight: Record<string, number> = { mission_critical: 4, high: 3, moderate: 2, low: 1 };
  const topByScore = useMemo(() => {
    const combined: Array<{ id: number; name: string; kind: 'isca' | 'iaca'; band: string; score: number }> = [];
    for (const i of iscas) {
      combined.push({
        id: i.id, name: i.name, kind: 'isca', band: i.criticality_level || '—',
        score: bandWeight[i.criticality_level || ''] || 0,
      });
    }
    for (const i of iacas) {
      combined.push({
        id: i.id, name: i.name, kind: 'iaca', band: i.criticality_level || '—',
        score: bandWeight[i.criticality_level || ''] || 0,
      });
    }
    return combined.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [iscas, iacas]);

  // Overdue approvals — items still in a review state >SLA_DAYS since
  // `submitted_at`. We don't keep timestamps on the approve tier
  // transitions so we use the original submission age.
  const overdue = useMemo(() => {
    const now = Date.now();
    const cutoff = SLA_DAYS * 86_400_000;
    const all: Array<{ id: number; name: string; kind: 'isca' | 'iaca'; status: string; submittedDaysAgo: number }> = [];
    for (const i of [...iscas, ...iacas]) {
      const kind = (iscas.includes(i as IscaItem) ? 'isca' : 'iaca') as 'isca' | 'iaca';
      if (!i.submitted_at) continue;
      const status = i.approval_status || 'draft';
      if (status !== 'submitted' && status !== 'business_owner_review' && status !== 'ciso_review') continue;
      const ageMs = now - new Date(i.submitted_at).getTime();
      if (ageMs > cutoff) {
        all.push({
          id: i.id, name: i.name, kind, status,
          submittedDaysAgo: Math.floor(ageMs / 86_400_000),
        });
      }
    }
    return all.sort((a, b) => b.submittedDaysAgo - a.submittedDaysAgo);
  }, [iscas, iacas]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link
            href="/assets/criticality-assessments"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to assessments
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Criticality Analytics</h1>
        </div>
      </header>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Total assessments"
          value={(coverage?.by_kind.isca ?? 0) + (coverage?.by_kind.iaca ?? 0)}
          icon={Layers}
          tone="slate"
        />
        <KpiTile
          label="Assets covered"
          value={`${coverage?.assessed_assets ?? 0} / ${coverage?.total_assets ?? 0}`}
          icon={ShieldCheck}
          tone="indigo"
          hint={coverage && coverage.total_assets > 0
            ? `${Math.round((coverage.assessed_assets / coverage.total_assets) * 100)}% coverage`
            : undefined}
        />
        <KpiTile
          label="Approved sign-offs"
          value={coverage?.by_approval_status.approved ?? 0}
          icon={ShieldCheck}
          tone="emerald"
        />
        <KpiTile
          label="Overdue approvals"
          value={overdue.length}
          icon={Clock}
          tone={overdue.length > 0 ? 'rose' : 'slate'}
          hint={`> ${SLA_DAYS} days in review`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title="Band distribution">
          {bandData.length === 0 ? (
            <Empty label="No assessments yet" />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={bandData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                       innerRadius={50} outerRadius={80} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                    {bandData.map((d) => <Cell key={d.key} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="By kind">
          {kindData.length === 0 ? (
            <Empty label="No assessments yet" />
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={kindData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                       innerRadius={50} outerRadius={80} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                    {kindData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Approval status mix">
          {!coverage ? <Empty label="Loading…" /> : (
            <div className="space-y-2 mt-2">
              {Object.entries(coverage.by_approval_status)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => (
                  <div key={k}>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-700 capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="font-semibold text-slate-900">{v}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mt-0.5">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (v / Math.max(1, (coverage.by_kind.isca + coverage.by_kind.iaca))) * 100)}%`,
                          backgroundColor: STATUS_COLOR[k] || '#cbd5e1',
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>

      {/* Top 10 by band weight */}
      <Card title="Top 10 by criticality">
        {topByScore.length === 0 ? <Empty label="No data" /> : (
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={topByScore} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
                <XAxis type="number" domain={[0, 4]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#334155' }} width={170} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={((v: number, _n: string, p: { payload: { band: string } }) => [String(v), p.payload.band.replace('_', ' ')]) as never} />
                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                  {topByScore.map((d) => <Cell key={`${d.kind}-${d.id}`} fill={BAND_COLOR[d.band] || '#cbd5e1'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Overdue approvals */}
      <Card title={`Overdue approvals (> ${SLA_DAYS} days in review)`}>
        {overdue.length === 0 ? (
          <p className="text-xs text-slate-500">All in-flight approvals are within SLA.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Assessment</th>
                  <th className="px-3 py-2">Current status</th>
                  <th className="px-3 py-2 text-right">Days in review</th>
                  <th className="px-3 py-2 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overdue.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs uppercase font-mono text-slate-600">{r.kind}</td>
                    <td className="px-3 py-2 text-sm text-slate-900">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-slate-700">{r.status.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-right text-sm font-mono text-rose-700">{r.submittedDaysAgo}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/assets/criticality-assessments?open=${r.kind}:${r.id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiTile({
  label, value, icon: Icon, tone, hint,
}: {
  label: string;
  value: number | string;
  icon: typeof ShieldCheck;
  tone: 'slate' | 'indigo' | 'emerald' | 'rose';
  hint?: string;
}) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${tones}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 truncate">{label}</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        </div>
      </div>
      {hint && <p className="mt-1 text-[10px] text-slate-500 truncate">{hint}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2 inline-flex items-center gap-1.5">
        <AlertTriangle className="hidden" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-center text-xs text-slate-500 py-10">{label}</p>;
}
