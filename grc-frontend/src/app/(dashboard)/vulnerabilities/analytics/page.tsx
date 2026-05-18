'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, Bug, Cloud, FileCheck, Layers,
  Loader2, Shield, Target, TrendingUp, Users as UsersIcon,
} from 'lucide-react';
import { searchApi, reportsApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';

type Tab = 'executive' | 'analyst' | 'correlation' | 'vendor';

export default function VulnerabilityAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('executive');

  const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
    { id: 'executive', label: 'Executive', icon: TrendingUp },
    { id: 'analyst', label: 'My Work', icon: Target },
    { id: 'correlation', label: 'Patch Correlation', icon: Layers },
    { id: 'vendor', label: 'Vendor Risk', icon: Cloud },
  ];

  return (
    <div className="space-y-4">
      <div className="border-b border-slate-200 bg-white rounded-t-xl">
        <div className="flex items-center gap-0 overflow-x-auto px-3">
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'executive' && <ExecutiveTab />}
      {activeTab === 'analyst' && <AnalystTab />}
      {activeTab === 'correlation' && <CorrelationTab />}
      {activeTab === 'vendor' && <VendorTab />}
    </div>
  );
}

// ── Executive ───────────────────────────────────────────────────────────────

function ExecutiveTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['executive-dashboard'],
    queryFn: () => searchApi.executiveDashboard().then((r) => r.data),
  });
  const { data: aging } = useQuery({
    queryKey: ['exception-aging'],
    queryFn: () => searchApi.exceptionAging().then((r) => r.data),
  });

  if (isLoading) return <PageLoader className="h-64" />;
  if (!data) return <p className="text-sm text-slate-500">No data.</p>;

  const open_total = Number(data.open_total ?? 0);
  const by_sev = (data.open_by_severity ?? {}) as Record<string, number>;
  const kev = Number(data.kev_open ?? 0);
  const overdue = Number(data.overdue_open ?? 0);
  const sla_pct = Number(data.sla_performance_pct ?? 100);
  const total_assets = Number(data.assets_total ?? 0);
  const cloud_assets = Number(data.cloud_assets ?? 0);
  const top = (data.top_affected_assets ?? []) as Array<Record<string, unknown>>;
  const sources = (data.assets_by_source ?? {}) as Record<string, number>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Open vulnerabilities"
          value={open_total}
          icon={Bug}
          tone="slate"
        />
        <KpiCard
          label="Critical"
          value={by_sev.critical || 0}
          icon={AlertCircle}
          tone="rose"
        />
        <KpiCard
          label="KEV exposure"
          value={kev}
          icon={Shield}
          tone="rose"
          subLabel="Actively exploited"
        />
        <KpiCard
          label="SLA performance"
          value={`${sla_pct}%`}
          icon={TrendingUp}
          tone={sla_pct >= 90 ? 'emerald' : sla_pct >= 70 ? 'amber' : 'rose'}
          subLabel={`${overdue} overdue`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Layers size={14} /> Open by severity
          </h3>
          <div className="space-y-2 text-sm">
            {['critical', 'high', 'medium', 'low', 'info'].map((sev) => {
              const n = by_sev[sev] || 0;
              const pct = open_total ? (n / open_total) * 100 : 0;
              return (
                <div key={sev}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="capitalize text-slate-600">{sev}</span>
                    <span className="text-slate-700">{n}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${SEVERITY_BAR_COLOR[sev] || 'bg-slate-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Cloud size={14} /> Asset coverage by source
          </h3>
          <p className="text-xs text-slate-500 mb-2">
            {cloud_assets} of {total_assets} assets ingested from cloud connectors.
          </p>
          <div className="space-y-1.5 text-xs">
            {Object.entries(sources)
              .sort(([, a], [, b]) => b - a)
              .map(([src, n]) => (
                <div key={src} className="flex justify-between border-b border-slate-100 py-1">
                  <span className="text-slate-700">{src}</span>
                  <span className="text-slate-600">{n}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Exception aging */}
      {aging && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <FileCheck size={14} /> Exception aging
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <MiniStat label="Active exceptions" value={Number(aging.counts_by_state?.approved ?? 0)} />
            <MiniStat label="Pending review" value={Number(aging.counts_by_state?.requested ?? 0)} tone="amber" />
            <MiniStat label="Expiring in 7d" value={Number(aging.expiring_within?.['7d'] ?? 0)} tone="amber" />
            <MiniStat label="Expired-unactioned" value={Number(aging.expired_unactioned ?? 0)} tone="rose" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <BucketList title="Active aging" buckets={aging.active_aging_buckets} />
            <BucketList title="Pending request aging" buckets={aging.pending_request_aging} />
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Top 10 affected assets</h3>
        {top.length === 0 ? (
          <p className="text-xs text-slate-500">No assets with open vulnerabilities.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-1.5">Asset</th>
                <th className="text-left">Criticality</th>
                <th className="text-left">Source</th>
                <th className="text-right">Open vulns</th>
              </tr>
            </thead>
            <tbody>
              {top.map((a) => (
                <tr key={String(a.id)} className="border-b border-slate-100">
                  <td className="py-1.5">
                    <Link href={`/assets/${a.id}`} className="text-blue-600 hover:underline">
                      {String(a.name || '')}
                    </Link>
                  </td>
                  <td className="capitalize text-slate-700">{String(a.criticality || '')}</td>
                  <td className="text-slate-600 text-xs">{String(a.source || 'manual')}</td>
                  <td className="text-right font-semibold text-slate-900">{Number(a.open_vuln_count || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Analyst ────────────────────────────────────────────────────────────────

function AnalystTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['analyst-dashboard'],
    queryFn: () => searchApi.analystDashboard().then((r) => r.data),
  });
  if (isLoading) return <PageLoader className="h-64" />;
  if (!data) return null;

  const my_open = (data.my_open_vulnerabilities ?? []) as Array<Record<string, unknown>>;
  const due_this_week = (data.due_this_week ?? []) as Array<Record<string, unknown>>;
  const pending_approvals = (data.pending_approvals ?? []) as Array<Record<string, unknown>>;
  const recent_count = Number(data.recent_ingest_count_7d ?? 0);
  const stale = (data.stale_assets ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="My open" value={my_open.length} icon={Bug} tone="slate" />
        <KpiCard label="Due this week" value={due_this_week.length} icon={ArrowDown} tone="amber" />
        <KpiCard label="Pending approvals" value={pending_approvals.length} icon={FileCheck} tone="blue" />
        <KpiCard label="Recently ingested (7d)" value={recent_count} icon={ArrowUp} tone="emerald" />
      </div>

      <VulnTable
        title="My open vulnerabilities"
        rows={my_open}
        empty="Nothing assigned to you."
      />
      <VulnTable
        title="Due this week"
        rows={due_this_week}
        empty="Nothing due in the next 7 days."
      />
      <VulnTable
        title="Pending exception approvals"
        rows={pending_approvals}
        empty="No pending approvals."
      />

      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <UsersIcon size={14} /> Stale assets (not seen 30+ days)
        </h3>
        {stale.length === 0 ? (
          <p className="text-xs text-slate-500">All assets seen recently.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-1.5">Asset</th>
                <th className="text-left">Source</th>
                <th className="text-left">Criticality</th>
                <th className="text-right">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {stale.map((a) => (
                <tr key={String(a.id)} className="border-b border-slate-100">
                  <td className="py-1.5">
                    <Link href={`/assets/${a.id}`} className="text-blue-600 hover:underline">
                      {String(a.name || '')}
                    </Link>
                  </td>
                  <td className="text-xs text-slate-600">{String(a.last_seen_source || 'manual')}</td>
                  <td className="text-slate-700 capitalize">{String(a.criticality || '')}</td>
                  <td className="text-right text-xs text-slate-600">
                    {a.last_seen_at ? new Date(String(a.last_seen_at)).toLocaleDateString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Correlation ────────────────────────────────────────────────────────────

function CorrelationTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['patch-correlation'],
    queryFn: () => searchApi.correlation().then((r) => r.data),
  });
  if (isLoading) return <PageLoader className="h-64" />;
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Layers size={14} /> KB articles fixing the most findings
        </h3>
        {data.by_kb.length === 0 ? (
          <p className="text-xs text-slate-500">No patch references synced yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-1.5">KB</th>
                <th className="text-right">Findings</th>
                <th className="text-right">Assets</th>
              </tr>
            </thead>
            <tbody>
              {data.by_kb.slice(0, 25).map((r) => (
                <tr key={r.kb_id} className="border-b border-slate-100">
                  <td className="py-1.5 font-mono text-xs">
                    <a
                      href={`https://support.microsoft.com/help/${r.kb_id.replace(/^KB/i, '')}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {r.kb_id}
                    </a>
                  </td>
                  <td className="text-right font-semibold text-slate-900">{r.finding_count}</td>
                  <td className="text-right text-slate-700">{r.affected_assets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Layers size={14} /> Top CVEs by finding count
        </h3>
        {data.by_cve.length === 0 ? (
          <p className="text-xs text-slate-500">No CVE-tagged vulns yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-1.5">CVE</th>
                <th className="text-right">Findings</th>
              </tr>
            </thead>
            <tbody>
              {data.by_cve.slice(0, 25).map((r) => (
                <tr key={r.cve_id} className="border-b border-slate-100">
                  <td className="py-1.5 font-mono text-xs">
                    <a
                      href={`https://nvd.nist.gov/vuln/detail/${r.cve_id}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {r.cve_id}
                    </a>
                  </td>
                  <td className="text-right font-semibold text-slate-900">{r.finding_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Vendor risk ────────────────────────────────────────────────────────────

function VendorTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['vendor-risk'],
    queryFn: () => searchApi.vendorRisk().then((r) => r.data),
  });
  if (isLoading) return <PageLoader className="h-64" />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">
          Open vulnerabilities by vendor
        </h3>
        {data.by_vendor.length === 0 ? (
          <p className="text-xs text-slate-500">No vendor-tagged assets / vulns yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-1.5">Vendor</th>
                <th className="text-right">Total</th>
                <th className="text-right text-rose-700">Critical</th>
                <th className="text-right text-amber-700">High</th>
                <th className="text-right text-blue-700">Medium</th>
                <th className="text-right text-slate-500">Low</th>
              </tr>
            </thead>
            <tbody>
              {data.by_vendor.slice(0, 30).map((r) => (
                <tr key={r.vendor} className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-700">{r.vendor}</td>
                  <td className="text-right font-semibold text-slate-900">{r.vuln_count}</td>
                  <td className="text-right text-rose-700">{r.critical_count}</td>
                  <td className="text-right text-amber-700">{r.high_count}</td>
                  <td className="text-right text-blue-700">{r.medium_count}</td>
                  <td className="text-right text-slate-500">{r.low_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">CWE distribution</h3>
        {data.by_cwe.length === 0 ? (
          <p className="text-xs text-slate-500">No CWE-tagged vulns yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.by_cwe.map((r) => (
              <span key={r.cwe_id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                <span className="font-mono">{r.cwe_id}</span>
                <span className="text-slate-500">·</span>
                <span className="font-semibold text-slate-700">{r.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <ReportsPanel />
    </div>
  );
}

// ── Reports panel (shared at the bottom of Vendor tab) ─────────────────────

function ReportsPanel() {
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (
    label: string,
    fetcher: () => Promise<{ data: Blob }>,
    filename: string,
  ) => {
    setBusy(label);
    try {
      const r = await fetcher();
      const blob = new Blob([r.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } finally {
      setBusy(null);
    }
  };

  const reportDefs: Array<{ key: string; label: string; description: string; csv: () => Promise<{ data: Blob }>; xlsx: () => Promise<{ data: Blob }>; filenameStem: string }> = [
    {
      key: 'exceptions',
      label: 'All active exceptions',
      description: 'Every exception currently in request/approved/expired state with the auditor-relevant context.',
      csv: () => reportsApi.exceptionsActive({ format: 'csv' }) as Promise<{ data: Blob }>,
      xlsx: () => reportsApi.exceptionsActive({ format: 'xlsx' }) as Promise<{ data: Blob }>,
      filenameStem: 'exceptions_active',
    },
    {
      key: 'remediation',
      label: 'Remediation timeline by CVE',
      description: 'Discovered → resolved dates + time-to-close for every closed vuln.',
      csv: () => reportsApi.remediationTimeline({ format: 'csv' }) as Promise<{ data: Blob }>,
      xlsx: () => reportsApi.remediationTimeline({ format: 'xlsx' }) as Promise<{ data: Blob }>,
      filenameStem: 'remediation_timeline',
    },
    {
      key: 'asset-register',
      label: 'Asset register (ISO 27001 A.8)',
      description: 'Full asset register snapshot — ownership chain + classification + lifecycle.',
      csv: () => reportsApi.assetRegister({ format: 'csv' }) as Promise<{ data: Blob }>,
      xlsx: () => reportsApi.assetRegister({ format: 'xlsx' }) as Promise<{ data: Blob }>,
      filenameStem: 'asset_register',
    },
    {
      key: 'patch-evidence',
      label: 'Patch deployment evidence',
      description: 'Vuln-to-closure with the KB articles that resolved each. Auditable patch chain.',
      csv: () => reportsApi.patchEvidence({ format: 'csv' }) as Promise<{ data: Blob }>,
      xlsx: () => reportsApi.patchEvidence({ format: 'xlsx' }) as Promise<{ data: Blob }>,
      filenameStem: 'patch_evidence',
    },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <FileCheck size={14} /> Compliance reports
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {reportDefs.map((r) => (
          <div key={r.key} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
            <h4 className="font-medium text-sm text-slate-900">{r.label}</h4>
            <p className="text-xs text-slate-600 mt-1 mb-2">{r.description}</p>
            <div className="flex gap-2">
              <button
                disabled={busy === r.key + '-csv'}
                onClick={() => download(r.key + '-csv', r.csv, `${r.filenameStem}.csv`)}
                className="px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 disabled:opacity-50"
              >
                {busy === r.key + '-csv' ? <Loader2 size={11} className="animate-spin" /> : null}
                CSV
              </button>
              <button
                disabled={busy === r.key + '-xlsx'}
                onClick={() => download(r.key + '-xlsx', r.xlsx, `${r.filenameStem}.xlsx`)}
                className="px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 disabled:opacity-50"
              >
                {busy === r.key + '-xlsx' ? <Loader2 size={11} className="animate-spin" /> : null}
                Excel
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shared building blocks ─────────────────────────────────────────────────

const SEVERITY_BAR_COLOR: Record<string, string> = {
  critical: 'bg-rose-500',
  high: 'bg-amber-500',
  medium: 'bg-blue-500',
  low: 'bg-emerald-500',
  info: 'bg-slate-400',
};

const TONE_STYLES: Record<string, string> = {
  slate: 'bg-white border-slate-200 text-slate-900',
  rose: 'bg-rose-50 border-rose-200 text-rose-900',
  amber: 'bg-amber-50 border-amber-200 text-amber-900',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  blue: 'bg-blue-50 border-blue-200 text-blue-900',
};

function KpiCard({
  label, value, icon: Icon, tone = 'slate', subLabel,
}: {
  label: string;
  value: number | string;
  icon: typeof Activity;
  tone?: 'slate' | 'rose' | 'amber' | 'emerald' | 'blue';
  subLabel?: string;
}) {
  return (
    <div className={`rounded-xl border p-4 shadow-card ${TONE_STYLES[tone]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
        <Icon size={14} className="text-slate-400" />
      </div>
      <p className="text-2xl font-semibold">{value}</p>
      {subLabel && <p className="text-xs text-slate-500 mt-1">{subLabel}</p>}
    </div>
  );
}

function MiniStat({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'amber' | 'rose' }) {
  const cls = tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="border border-slate-200 rounded-md p-2 bg-slate-50">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-semibold ${cls}`}>{value}</p>
    </div>
  );
}

function BucketList({ title, buckets }: { title: string; buckets?: Record<string, number> }) {
  if (!buckets) return null;
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1">{title}</p>
      <div className="space-y-1">
        {Object.entries(buckets).map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-slate-700">{k}</span>
            <span className="font-semibold text-slate-900">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VulnTable({ title, rows, empty }: { title: string; rows: Array<Record<string, unknown>>; empty: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-card p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left py-1.5">Vuln</th>
              <th className="text-left">Severity</th>
              <th className="text-left">Priority</th>
              <th className="text-left">Due</th>
              <th className="text-left">Exception</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={String(v.id)} className="border-b border-slate-100">
                <td className="py-1.5">
                  <Link href={`/vulnerabilities/${v.id}`} className="text-blue-600 hover:underline">
                    {String(v.vuln_id || '')}
                  </Link>
                  <span className="text-slate-600 ml-1.5 text-xs">— {String(v.title || '').slice(0, 60)}</span>
                </td>
                <td className="text-slate-700 capitalize">{String(v.severity || '')}</td>
                <td className="text-slate-700">{v.composite_priority ? Number(v.composite_priority).toFixed(1) : '—'}</td>
                <td className="text-slate-600 text-xs">{v.due_date ? new Date(String(v.due_date)).toLocaleDateString() : '—'}</td>
                <td className="text-xs text-slate-600">{String(v.exception_status || 'none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
