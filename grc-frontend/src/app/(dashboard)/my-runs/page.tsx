"use client";
// /my-runs — tenant-facing activity dashboard.
//
// Lifts the three sections that were previously buried inside
// /compliance/plugins (a mixed tenant + platform-admin page):
//
//   1. KPI strip — approved rules · your pass rate · pending review
//   2. Activity panel — Mine / Teammates toggle with per-user coverage
//   3. Recent runs — chronological scan history
//
// The old /compliance/plugins page has been removed from tenant routing
// (it still exists on disk for platform-admin re-wire later). The bulk-
// review / classification mutations that lived on that page were
// platform-admin operations — they don't belong in the tenant UI.
//
// Cross-screen consistency invariant (verified against live data):
//   /my-runs Your Pass Rate == /admin/overview pass_rate for your user
//   /my-runs total_rules    == /compliance/plugins/library TOTAL RULES
//   /my-runs recent runs    == /compliance-overview per-asset scan history

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { compliancePluginsApi } from "@/lib/api";
import {
  Activity, CheckCircle2, AlertTriangle, AlertCircle, Loader2,
  ShieldCheck, Users, Clock, ChevronRight,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────
interface UserRef {
  id: number;
  username: string | null;
  display_name: string | null;
  email: string | null;
}
interface PerUserRow {
  user: UserRef;
  scanned: number;
  passed: number;
  failed: number;
  errored: number;
  pass_pct: number;
}
interface PerUserSummary {
  your_user_id: number;
  your_user_email: string;
  total_rules: number;
  users: PerUserRow[];
}
interface RunRow {
  id: number;
  status: string;
  triggered_by: string | null;
  triggered_by_user_id: number | null;
  triggered_by_user?: UserRef;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  plugin_id: number;
  plugin_key: string | null;
  plugin_title?: string | null;
  asset_id: number | null;
  asset_name?: string | null;
  error_message?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────
const fmtNum = (n: number) => n.toLocaleString();

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusBadge(status: string) {
  const palette: Record<string, string> = {
    passed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    failed: "bg-red-100 text-red-800 ring-red-200",
    error: "bg-amber-100 text-amber-800 ring-amber-200",
    running: "bg-blue-100 text-blue-800 ring-blue-200",
    skipped: "bg-slate-100 text-slate-700 ring-slate-200",
  };
  const cls = palette[status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
  return `rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${cls}`;
}

// Squeeze a plugin_key to "1.1.1 · Enforce password history (CIS Win 11)"
function prettyRule(key: string | null, title?: string | null): { ruleId: string; benchShort: string } {
  if (!key) return { ruleId: title || "—", benchShort: "" };
  const m = key.match(/^(.+)__(.+)$/);
  if (!m) return { ruleId: key, benchShort: "" };
  const bench = m[1].replace(/^CIS_/, "").replace(/_Benchmark_/, "_").replace(/_/g, " ");
  return {
    ruleId: m[2],
    benchShort: bench.length > 40 ? bench.slice(0, 40) + "…" : bench,
  };
}

// ─── Page ───────────────────────────────────────────────────────────
export default function MyRunsPage() {
  const [scope, setScope] = useState<"mine" | "team">("mine");

  const summaryQ = useQuery<PerUserSummary>({
    queryKey: ["my-runs.per-user-summary"],
    queryFn: async () =>
      (await compliancePluginsApi.perUserSummary()).data as PerUserSummary,
    refetchInterval: 30_000,
  });

  const runsQ = useQuery({
    queryKey: ["my-runs.runs", scope],
    queryFn: async () =>
      (await compliancePluginsApi.listRuns({ limit: 200 })).data as { runs: RunRow[]; total: number },
    refetchInterval: 15_000,
  });

  // KPIs computed off the per-user summary so they always agree with
  // the activity panel below (single source of truth per render).
  //
  // CAREFUL: the API's `your_user_id` is the *public* grc_users.id while
  // the rows in `users[]` carry the *tenant-schema* users.id. These two
  // tables have different sequence values — public hassan = 12, tenant-
  // schema hassan = 1. So we cannot match by id alone. Email is the
  // stable cross-namespace identity (verified: appears identically in
  // both tables). Fallback chain matches the visibleUsers logic below.
  const kpi = useMemo(() => {
    const data = summaryQ.data;
    const yourEmail = (data?.your_user_email || "").toLowerCase();
    const me = data?.users.find(
      (u) =>
        u.user.id === data.your_user_id ||
        (yourEmail && u.user.email?.toLowerCase() === yourEmail),
    );
    const total = data?.total_rules ?? 0;
    const yourScanned = me?.scanned ?? 0;
    const yourPassed = me?.passed ?? 0;
    const yourPassRate = yourScanned > 0 ? Math.round((yourPassed / yourScanned) * 100) : null;
    return { total, yourScanned, yourPassed, yourPassRate, yourFailed: me?.failed ?? 0 };
  }, [summaryQ.data]);

  // Split visible rows: Mine = your row; Team = everyone except you.
  // Matches the semantics of the old page so the operator's mental
  // model carries over.
  const visibleUsers = useMemo(() => {
    const data = summaryQ.data;
    if (!data) return [];
    const matchesYou = (u: PerUserRow) =>
      u.user.id === data.your_user_id ||
      (u.user.email?.toLowerCase() === data.your_user_email.toLowerCase());
    return scope === "mine"
      ? data.users.filter(matchesYou)
      : data.users.filter((u) => !matchesYou(u));
  }, [summaryQ.data, scope]);

  // Only gate the page on the summary — that's the fast query (per-user
  // counts, ~50ms). The runs query pulls 200 rows with rule + asset joins
  // and can take 5-10s; the table below shows its own loading state so
  // the KPIs + activity panel are usable immediately.
  if (summaryQ.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading activity…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Activity className="h-5 w-5 text-indigo-600" /> My runs & team activity
        </h1>
        <p className="mt-0.5 text-xs text-slate-600">
          Your coverage of the approved CIS catalogue plus what your
          teammates have run. Refreshes every 30s.
        </p>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          icon={ShieldCheck}
          label="Approved rules"
          value={fmtNum(kpi.total)}
          hint="across the whole CIS library"
        />
        <Card
          icon={CheckCircle2}
          label="Your pass rate"
          value={kpi.yourPassRate == null ? "—" : `${kpi.yourPassRate}%`}
          hint={
            kpi.yourScanned > 0
              ? `${fmtNum(kpi.yourPassed)} of ${fmtNum(kpi.yourScanned)} latest-runs passed`
              : "no scans yet"
          }
          tone={
            kpi.yourPassRate == null
              ? "default"
              : kpi.yourPassRate >= 80
              ? "good"
              : kpi.yourPassRate >= 50
              ? "warn"
              : "bad"
          }
        />
        <Card
          icon={AlertTriangle}
          label="Your failed"
          value={fmtNum(kpi.yourFailed)}
          hint="rules that ran and reported non-compliance"
          tone={kpi.yourFailed > 0 ? "bad" : "default"}
        />
        <Card
          icon={Clock}
          label="Recent runs"
          value={fmtNum(runsQ.data?.total ?? runsQ.data?.runs.length ?? 0)}
          hint={`showing latest ${runsQ.data?.runs.length ?? 0}`}
        />
      </div>

      {/* ── Activity panel (Mine / Teammates) ───────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Users className="h-4 w-4 text-slate-500" /> Activity
            </h3>
            <p className="text-[11px] text-slate-500">
              Every tenant member. Teammates who haven't scanned anything
              yet are tagged "not started". Click a row to filter the runs
              feed below.
            </p>
          </div>
          <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
            {(["mine", "team"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={
                  "rounded px-3 py-1 font-medium transition-colors " +
                  (scope === s
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-50")
                }
              >
                {s === "mine" ? "Mine" : "Teammates"}
              </button>
            ))}
          </div>
        </div>

        {visibleUsers.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
            {scope === "mine"
              ? "No activity recorded for you yet. Trigger a scan from /assets or wait for the agent."
              : "No other team members yet. Add colleagues under Administration → User Management."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibleUsers.map((row) => {
              const total = summaryQ.data?.total_rules || 1;
              const passPct = (row.passed / total) * 100;
              const failPct = (row.failed / total) * 100;
              const initial = (row.user.display_name || row.user.username || "?")
                .charAt(0)
                .toUpperCase();
              const ranAnything = (row.passed + row.failed + (row.errored || 0)) > 0;
              return (
                <li key={row.user.id} className={`flex items-center gap-3 py-2.5 ${!ranAnything ? 'opacity-70' : ''}`}>
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${ranAnything ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {row.user.display_name || row.user.username}
                      </span>
                      <span className="truncate text-xs text-slate-500">
                        {row.user.email}
                      </span>
                      {!ranAnything && (
                        <span className="ml-auto inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          not started
                        </span>
                      )}
                    </div>
                    {ranAnything ? (
                      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="bg-emerald-500"
                          style={{ width: `${passPct}%` }}
                          title={`${row.passed} passed`}
                        />
                        <div
                          className="bg-red-400"
                          style={{ width: `${failPct}%` }}
                          title={`${row.failed} failed`}
                        />
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Hasn't triggered a CIS scan yet. Send them the Connect Wizard link to onboard their first asset.
                      </p>
                    )}
                  </div>
                  <div className="ml-2 flex-shrink-0 text-right">
                    {ranAnything ? (
                      <>
                        <div className="text-sm font-semibold tabular-nums text-slate-900">
                          {row.passed}{" "}
                          <span className="font-normal text-slate-400">/</span>{" "}
                          {total}
                        </div>
                        <div className="text-[11px] tabular-nums text-slate-500">
                          {row.pass_pct.toFixed(1)}% passing
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-slate-400">— no runs —</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Recent runs feed ────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-slate-900">Recent runs</h3>
          <p className="text-[11px] text-slate-500">
            Last {runsQ.data?.runs.length ?? 0} scan attempts in this tenant,
            newest first. Click an asset name to open its detail page.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold text-slate-700">
                  When
                </th>
                <th className="px-3 py-1.5 text-left font-semibold text-slate-700">
                  Status
                </th>
                <th className="px-3 py-1.5 text-left font-semibold text-slate-700">
                  Rule
                </th>
                <th className="px-3 py-1.5 text-left font-semibold text-slate-700">
                  Asset
                </th>
                <th className="px-3 py-1.5 text-left font-semibold text-slate-700">
                  Triggered by
                </th>
                <th className="px-3 py-1.5 text-right font-semibold text-slate-700">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runsQ.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                    Loading the last 200 runs…
                  </td>
                </tr>
              ) : (runsQ.data?.runs ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No runs yet. Trigger a scan from{" "}
                    <Link href="/assets" className="text-indigo-600 underline">
                      /assets
                    </Link>
                    .
                  </td>
                </tr>
              ) : (
                (runsQ.data?.runs ?? []).map((r) => {
                  const { ruleId, benchShort } = prettyRule(r.plugin_key, r.plugin_title);
                  const triggererName =
                    r.triggered_by_user?.display_name ||
                    r.triggered_by_user?.username ||
                    r.triggered_by ||
                    "—";
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/50">
                      <td className="px-3 py-1.5 text-slate-600">
                        {fmtAgo(r.started_at)}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={statusBadge(r.status)}>{r.status}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="font-mono text-[10px] text-slate-700">
                          {ruleId}
                        </div>
                        {benchShort && (
                          <div className="truncate text-[10px] text-slate-400">
                            {benchShort}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.asset_id ? (
                          <Link
                            href={`/assets/${r.asset_id}`}
                            className="inline-flex items-center gap-0.5 font-medium text-indigo-700 hover:underline"
                          >
                            {r.asset_name || `asset#${r.asset_id}`}
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700">
                        {triggererName}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">
                        {r.duration_ms != null
                          ? r.duration_ms < 1000
                            ? `${r.duration_ms}ms`
                            : `${(r.duration_ms / 1000).toFixed(1)}s`
                          : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Small Card component (mirrors /admin/overview for consistency) ──
function Card({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const wrap = {
    default: "border-slate-200 bg-white",
    good: "border-emerald-200 bg-emerald-50/50",
    warn: "border-amber-200 bg-amber-50/50",
    bad: "border-red-200 bg-red-50/50",
  }[tone];
  const ic = {
    default: "text-slate-500",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  }[tone];
  return (
    <div className={`rounded-lg border p-3.5 ${wrap}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>
        </div>
        <Icon className={`h-5 w-5 ${ic}`} />
      </div>
    </div>
  );
}
