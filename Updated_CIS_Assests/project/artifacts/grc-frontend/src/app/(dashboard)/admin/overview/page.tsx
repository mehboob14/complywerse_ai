"use client";
// Tenant-wide admin overview dashboard.
//
// Per Hassan: admin needs ONE screen that shows the whole tenant at a glance
// without bouncing between /assets, /compliance-overview, /admin/agents and
// /admin/integrations. This page is purely read-only and powered by a single
// /admin/overview aggregation call.
//
// Sections (top → bottom):
//   1. Header strip (tenant name + key KPI band)
//   2. Asset KPIs + OS-family + criticality donuts
//   3. Scan KPIs + status breakdown + trigger split
//   4. Per-benchmark coverage table
//   5. Agent / connection health
//   6. Recent failures
//
// Every number is queried scoped to the caller's tenant_id on the backend,
// so a tenant admin who navigates here sees only their own data even if
// another tenant has more activity in the shared global plugin library.

import { useQuery } from "@tanstack/react-query";
import { compliancePluginsApi } from "@/lib/api";
import { Loader2, ServerCog, ShieldCheck, ShieldAlert, Cpu, Wifi, Activity, TrendingUp } from "lucide-react";

interface KeyVal {
  key: string;
  n: number;
}

interface BenchmarkRow {
  benchmark: string;
  assets_covered: number;
  applicable_rules: number;
}

interface RecentFailure {
  run_id: number;
  started_at: string;
  error_message: string | null;
  asset_id: number | null;
  asset_name: string | null;
  rule_id: string | null;
  rule_title: string | null;
  benchmark: string | null;
}

interface OverviewData {
  tenant: { id: number; name: string | null; slug: string | null };
  assets: {
    total: number;
    with_os_classified: number;
    with_benchmark_mapped: number;
    by_os_family: KeyVal[];
    by_criticality: KeyVal[];
  };
  scans: {
    total_runs: number;
    runs_last_24h: number;
    runs_last_7d: number;
    passed_total: number;
    pass_rate: number | null;
    by_status: KeyVal[];
    by_trigger: KeyVal[];
  };
  benchmarks: BenchmarkRow[];
  connections: { total: number; connected: number };
  agents: { total: number; active_fresh: number; stale: number; pending: number };
  recent_failures: RecentFailure[];
}

const fmtPct = (n: number | null) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;
const fmtN = (n: number) => n.toLocaleString();

function Card({
  title,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: React.ElementType;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClasses = {
    default: "border-slate-200 bg-white",
    good: "border-emerald-200 bg-emerald-50/50",
    warn: "border-amber-200 bg-amber-50/50",
    bad: "border-red-200 bg-red-50/50",
  }[tone];
  const iconColor = {
    default: "text-slate-500",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  }[tone];
  return (
    <div className={`rounded-lg border p-3.5 ${toneClasses}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
          {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
        </div>
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
    </div>
  );
}

function MiniBar({ items }: { items: KeyVal[] }) {
  if (!items || items.length === 0) {
    return <div className="text-xs italic text-slate-400">no data</div>;
  }
  const total = items.reduce((a, b) => a + b.n, 0);
  return (
    <ul className="space-y-1.5">
      {items.map((it) => {
        const pct = total ? Math.round((it.n / total) * 100) : 0;
        return (
          <li key={it.key} className="text-xs">
            <div className="mb-0.5 flex justify-between">
              <span className="text-slate-700">{it.key}</span>
              <span className="font-medium text-slate-900">
                {fmtN(it.n)} <span className="text-slate-400">({pct}%)</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full bg-indigo-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminOverviewPage() {
  const { data, isLoading, error } = useQuery<OverviewData>({
    queryKey: ["admin-overview"],
    queryFn: async () => (await compliancePluginsApi.adminOverview()).data,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading tenant overview…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Couldn't load the admin overview. The endpoint may be down — check
        the backend console.
      </div>
    );
  }

  const a = data.assets;
  const s = data.scans;
  const agentTone =
    data.agents.active_fresh > 0 ? "good" : data.agents.stale > 0 ? "warn" : "default";
  const passTone =
    s.pass_rate == null ? "default" : s.pass_rate > 0.8 ? "good" : s.pass_rate > 0.5 ? "warn" : "bad";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {data.tenant.name || "Tenant"} · overview
            </h1>
            <p className="mt-0.5 text-xs text-slate-600">
              Tenant-wide view of assets, benchmarks, scans, connections, and
              agents. Refreshes every 30s.
            </p>
          </div>
          <div className="text-right text-[10px] text-slate-500">
            tenant_id={data.tenant.id}
            <br />
            slug={data.tenant.slug ?? "—"}
          </div>
        </div>
      </div>

      {/* Top KPI band */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          title="Assets"
          value={fmtN(a.total)}
          hint={`${a.with_benchmark_mapped} mapped to a benchmark`}
          icon={ServerCog}
        />
        <Card
          title="Scans (last 24h)"
          value={fmtN(s.runs_last_24h)}
          hint={`${fmtN(s.total_runs)} all-time`}
          icon={Activity}
        />
        <Card
          title="Pass rate"
          value={fmtPct(s.pass_rate)}
          hint={`${fmtN(s.passed_total)} passed · ${fmtN(s.total_runs)} total`}
          icon={s.pass_rate && s.pass_rate > 0.5 ? ShieldCheck : ShieldAlert}
          tone={passTone}
        />
        <Card
          title="Agents · live"
          value={fmtN(data.agents.active_fresh)}
          hint={`${data.agents.stale} stale · ${data.agents.pending} pending enrollment`}
          icon={Cpu}
          tone={agentTone}
        />
      </div>

      {/* Asset breakdowns */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <h3 className="text-sm font-semibold text-slate-900">
            Assets by OS family
          </h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Drives strict-matcher coverage. "unknown" = not classified yet.
          </p>
          <MiniBar items={a.by_os_family} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <h3 className="text-sm font-semibold text-slate-900">
            Assets by criticality
          </h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Per-asset CIA rating + business-impact tag.
          </p>
          <MiniBar items={a.by_criticality} />
        </div>
      </div>

      {/* Scan breakdowns */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <TrendingUp className="h-4 w-4 text-slate-500" /> Scan status mix
          </h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Mix of pass / fail / error across every scan ever run. Errors are
            usually unreachable target or credential failure — not control
            non-compliance.
          </p>
          <MiniBar items={s.by_status} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <h3 className="text-sm font-semibold text-slate-900">
            Triggered by
          </h3>
          <p className="mb-2 text-[11px] text-slate-500">
            scan_all = operator-clicked agentless · agent = host-installed
            push · manual = single-rule trigger.
          </p>
          <MiniBar items={s.by_trigger} />
        </div>
      </div>

      {/* Benchmark coverage */}
      <div className="rounded-lg border border-slate-200 bg-white p-3.5">
        <h3 className="text-sm font-semibold text-slate-900">
          Active benchmarks · what's being scanned
        </h3>
        <p className="mb-3 text-[11px] text-slate-500">
          Each row = one benchmark currently named by a mapping row + the
          assets it covers. Archived benchmarks don't appear.
        </p>
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">
                Benchmark
              </th>
              <th className="px-2 py-1.5 text-right font-semibold text-slate-700">
                Assets
              </th>
              <th className="px-2 py-1.5 text-right font-semibold text-slate-700">
                Applicable rules
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.benchmarks.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-4 text-center text-slate-500">
                  No benchmark currently covers any asset. Add a mapping in
                  Rules library → Benchmark mappings.
                </td>
              </tr>
            ) : (
              data.benchmarks.map((b) => (
                <tr key={b.benchmark}>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-slate-800">
                    {b.benchmark}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-900">
                    {b.assets_covered}
                  </td>
                  <td className="px-2 py-1.5 text-right text-slate-700">
                    {b.applicable_rules}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Connectivity */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Wifi className="h-4 w-4 text-slate-500" /> Agentless connections
          </h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Stored credentials (Fernet-encrypted) the backend uses to scan
            assets without an agent.
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              {data.connections.connected}
            </span>
            <span className="text-xs text-slate-500">
              of {data.connections.total} connected
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Cpu className="h-4 w-4 text-slate-500" /> Installed agents
          </h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Lightweight host-installed daemon. Active = heartbeat in last hour.
          </p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            <div>
              <div className="text-2xl font-bold text-emerald-700">
                {data.agents.active_fresh}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                active
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700">
                {data.agents.stale}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                stale
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-500">
                {data.agents.pending}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                pending
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent failures */}
      <div className="rounded-lg border border-slate-200 bg-white p-3.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ShieldAlert className="h-4 w-4 text-red-500" /> Recent scan
          failures · last 24h
        </h3>
        <p className="mb-3 text-[11px] text-slate-500">
          Failures and errors, latest first. "error" usually = environmental
          (unreachable target). "failed" = the rule executed but the control
          is non-compliant.
        </p>
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">
                When
              </th>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">
                Asset
              </th>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">
                Rule
              </th>
              <th className="px-2 py-1.5 text-left font-semibold text-slate-700">
                Detail
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.recent_failures.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-slate-500">
                  No failures or errors in the last 24h.
                </td>
              </tr>
            ) : (
              data.recent_failures.map((f) => (
                <tr key={f.run_id}>
                  <td className="px-2 py-1.5 text-slate-600">
                    {new Date(f.started_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-slate-900">
                    {f.asset_name || `#${f.asset_id}` || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-mono text-[10px] text-slate-500">
                      {f.rule_id || "—"}
                    </div>
                    <div className="truncate text-[11px] text-slate-700">
                      {f.rule_title || ""}
                    </div>
                  </td>
                  <td className="max-w-[20rem] truncate px-2 py-1.5 text-[11px] text-slate-500">
                    {f.error_message || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
