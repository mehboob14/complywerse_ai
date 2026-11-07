"use client";

/**
 * Help Desk — executive analytics dashboard, drawn in ComplyVerse's Performance-dashboard
 * language (the (dashboard)/dashboard `kit` + hand-rolled `charts`). Dense,
 * tenant-wide, with a 7/30/90-day window selector.
 *
 * Data (all under /helpdesk, the base the FE already uses):
 *   /helpdesk/dashboard-overview?from_date&to_date    KPI values · trend · breakdowns, windowed  (always, ungated)
 *   /helpdesk/dashboard-data?type=number_card&…        period deltas (%-change)  (now ungated tenant-wide)
 *   /helpdesk/dashboard-data?type=master&…             channel breakdown
 *   /helpdesk/dashboard-data?type=trend&…              SLA-fulfilled % line for the trend
 *   /helpdesk/analytics/sla-violations-overview?period SLA-breach trend over time  (tenant-wide)
 *   /helpdesk/analytics/feedback-overview              1–5 star CSAT distribution   (tenant-wide)
 *   /helpdesk/dashboard                                recent tickets
 *   /helpdesk/tickets                                  SLA health · backlog aging · agent leaderboard · exec summary · at-risk
 * Every tenant-wide number comes from an ungated endpoint, so a plain agent sees
 * the full dashboard. Empty tenant → zeros/empty, never crash.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Clock, Gauge, Inbox, Layers, LifeBuoy, RefreshCw, ShieldAlert, Star, Timer } from "lucide-react";
import { Card, Empty, Eyebrow, Loading, T, nfmt } from "../../dashboard/_components/kit";
import {
  AgentLeaderboard, BacklogAging, Breakdown, BreachTrend, ComplianceGauge, CsatDistribution,
  DeltaInfo, ExecSummaryBar, type FeedbackDist, Kpi, type Period, PERIODS, PeriodSelect,
  SlaPanel, TrendChart, type TrendRow, type ViolationSeries, atRiskTickets, fmtD, fmtH, periodRange, slaBuckets,
} from "../_dash";
import { Chip, PRIORITY_CHIP, SlaBadge, timeAgo, useHd } from "../_ui";

interface Analytics {
  total: number; sla_fulfilled_pct: number | null; avg_first_response_hours: number | null;
  avg_resolution_days: number | null; avg_feedback_rating: number | null; feedback_count: number;
  trend: TrendRow[];
  by_team: Record<string, number>; by_priority: Record<string, number>;
  by_type: Record<string, number>; by_status_category: Record<string, number>;
}
type NumberCard = { title: string; delta: number | null; deltaSuffix?: string; negativeIsBetter?: boolean; deltaCaption?: string };
type ChartCfg = { key: string; data: any[] };

const deltaOf = (c?: NumberCard): DeltaInfo | null =>
  c ? { delta: c.delta, suffix: c.deltaSuffix, negativeIsBetter: c.negativeIsBetter, caption: c.deltaCaption } : null;

export default function HelpDeskDashboard() {
  const [period, setPeriod] = useState<Period>(30);
  const range = periodRange(period);
  const q = `from_date=${range.from_date}&to_date=${range.to_date}`;
  const periodLabel = PERIODS.find((p) => p.days === period)!.label;
  const periodStat = PERIODS.find((p) => p.days === period)!.stat;

  const A = useHd<Analytics>(`/helpdesk/dashboard-overview?${q}`);
  const cards = useHd<NumberCard[]>(`/helpdesk/dashboard-data?type=number_card&${q}`);
  const master = useHd<ChartCfg[]>(`/helpdesk/dashboard-data?type=master&${q}`);
  const trendX = useHd<ChartCfg[]>(`/helpdesk/dashboard-data?type=trend&${q}`);
  const breaches = useHd<ViolationSeries>(`/helpdesk/analytics/sla-violations-overview?period=${encodeURIComponent(periodStat)}`);
  const feedback = useHd<FeedbackDist>("/helpdesk/analytics/feedback-overview");
  const base = useHd<any>("/helpdesk/dashboard");
  const tix = useHd<any>("/helpdesk/tickets");

  const a = A.data;
  const nc = cards.data || [];
  const recent: any[] = Array.isArray(base.data?.recent) ? base.data.recent : [];
  const tickets: any[] = Array.isArray(tix.data?.tickets) ? tix.data.tickets : [];
  const atRisk = useMemo(() => atRiskTickets(tickets).slice(0, 8), [tickets]);
  const slab = useMemo(() => slaBuckets(tickets), [tickets]);

  // SLA-fulfilled % per day from the trend payload → attach to the trend chart.
  const slaByDate = useMemo(() => {
    const tt = (trendX.data || []).find((c) => c.key === "ticket_trend");
    if (!tt) return undefined;
    const m: Record<string, number | null> = {};
    for (const r of tt.data || []) m[r.date] = r["SLA Fulfilled"] ?? null;
    return m;
  }, [trendX.data]);

  // Channel breakdown only comes from the master payload.
  const byChannel = useMemo(() => {
    const ch = (master.data || []).find((c) => c.key === "tickets_by_channel");
    if (!ch) return null;
    return Object.fromEntries((ch.data || []).map((r: any) => [r.channel, r.count])) as Record<string, number>;
  }, [master.data]);

  const kpis = [
    { icon: <Layers size={15} />, label: "Tickets", value: nfmt(a?.total ?? 0), sub: `created · last ${periodLabel}`, delta: deltaOf(nc[0]) },
    { icon: <Gauge size={15} />, label: "SLA fulfilled", value: a?.sla_fulfilled_pct == null ? "—" : `${a.sla_fulfilled_pct}%`, sub: "resolved within SLA", delta: deltaOf(nc[1]) },
    { icon: <Clock size={15} />, label: "Avg first response", value: fmtH(a?.avg_first_response_hours), sub: "time to first reply", delta: deltaOf(nc[2]) },
    { icon: <Timer size={15} />, label: "Avg resolution", value: fmtD(a?.avg_resolution_days), sub: "time to resolve", delta: deltaOf(nc[3]) },
    { icon: <Star size={15} />, label: "Avg feedback", value: a?.avg_feedback_rating == null ? "—" : `${a.avg_feedback_rating}/5`, sub: a?.feedback_count ? `${nfmt(a.feedback_count)} rated` : "no ratings yet", delta: deltaOf(nc[4]) },
  ];

  const refreshAll = () => { A.reload(); cards.reload(); master.reload(); trendX.reload(); breaches.reload(); feedback.reload(); base.reload(); tix.reload(); };
  const busy = A.loading || cards.loading || master.loading || trendX.loading || base.loading || tix.loading;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 text-[#0F172A]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[12px]" style={{ background: "rgba(0,91,150,.10)", color: T.base }}><LifeBuoy size={22} strokeWidth={1.75} /></div>
          <div>
            <h1 className="m-0 text-[20px] font-semibold leading-tight text-[#0F172A]">Help Desk</h1>
            <p className="m-0 text-[12.5px] text-[#64748B]">Service-desk analytics · last {periodLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelect value={period} onChange={setPeriod} />
          <Link href="/cyber-assurance/helpdesk" className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#E2E5EC] bg-white px-3 text-[12px] font-semibold text-[#334155] hover:bg-[#F6F7FB]"><ShieldAlert size={14} /> Remediation board</Link>
          <button onClick={refreshAll} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#E2E5EC] bg-white px-3 text-[12px] font-semibold text-[#334155] hover:bg-[#F6F7FB] disabled:opacity-70">
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} style={{ color: T.base }} />{busy ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {!A.loading && !a ? (
        <Card title="Help Desk analytics"><Empty icon={<Inbox size={16} />} title="Analytics unavailable" body="The Help Desk engine didn't respond — try refreshing in a moment." /></Card>
      ) : (
        <>
          {/* Executive summary */}
          <ExecSummaryBar tickets={tickets} slaPct={a?.sla_fulfilled_pct ?? null} periodLabel={periodLabel} />

          {/* Hero: SLA-compliance dial · created-vs-resolved trend */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card title="SLA compliance" sub="Resolved within SLA · this window">
              {A.loading && !a ? <Loading rows={5} /> : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-1">
                  <ComplianceGauge value={a?.sla_fulfilled_pct ?? null} />
                  <div className="flex w-full items-center justify-center gap-6 text-center">
                    <div><p className="m-0 text-[18px] font-semibold leading-none" style={{ color: T.danger }}>{nfmt(slab.breached)}</p><p className="m-0 mt-1 text-[10.5px] text-[#64748B]">breached</p></div>
                    <div><p className="m-0 text-[18px] font-semibold leading-none" style={{ color: T.warning }}>{nfmt(slab.atRisk)}</p><p className="m-0 mt-1 text-[10.5px] text-[#64748B]">at risk ≤24h</p></div>
                    <div><p className="m-0 text-[18px] font-semibold leading-none" style={{ color: T.success }}>{nfmt(slab.fulfilled)}</p><p className="m-0 mt-1 text-[10.5px] text-[#64748B]">met</p></div>
                  </div>
                </div>
              )}
            </Card>
            <Card title="Ticket trend" sub={`Created vs resolved · last ${periodLabel}${slaByDate ? " · SLA-fulfilled %" : ""}`} className="xl:col-span-2">
              {A.loading && !a ? <Loading rows={6} /> : (a?.trend?.length ? <TrendChart data={a.trend} slaByDate={slaByDate} /> : <Empty icon={<Inbox size={16} />} title="No activity in this window" compact />)}
            </Card>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
            {A.loading && !a
              ? Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[92px] animate-pulse rounded-[12px] border border-[#E2E5EC] bg-white" />)
              : kpis.map((k) => <Kpi key={k.label} icon={k.icon} label={k.label} value={k.value} sub={k.sub} delta={k.delta} href="/cyber-assurance/helpdesk/tickets" />)}
          </div>

          {/* Operations: backlog aging · agent leaderboard · CSAT distribution */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <BacklogAging tickets={tickets} href="/cyber-assurance/helpdesk/tickets" />
            <AgentLeaderboard tickets={tickets} href="/cyber-assurance/helpdesk/agents" />
            <CsatDistribution fb={feedback.data} href="/cyber-assurance/helpdesk/tickets" />
          </div>

          {/* SLA health · SLA-breach trend */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {tix.loading && !tickets.length
              ? <Card title="SLA health"><Loading rows={5} /></Card>
              : <SlaPanel tickets={tickets} pct={a?.sla_fulfilled_pct ?? null} href="/cyber-assurance/helpdesk/tickets" />}
            <BreachTrend series={breaches.data} periodLabel={periodLabel} href="/cyber-assurance/helpdesk/tickets" />
          </div>

          {/* Breakdowns */}
          <div>
            <Eyebrow className="mb-2">Breakdowns</Eyebrow>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Breakdown title="By priority" sub="Demand by urgency" data={a?.by_priority} kind="priority" href="/cyber-assurance/helpdesk/tickets" />
              <Breakdown title="By status" sub="Where tickets sit" data={a?.by_status_category} kind="status" href="/cyber-assurance/helpdesk/tickets" />
              <Breakdown title="By team" sub="Load across teams" data={a?.by_team} href="/cyber-assurance/helpdesk/teams" />
              <Breakdown title="By type" sub="Nature of requests" data={a?.by_type} href="/cyber-assurance/helpdesk/tickets" />
              {byChannel && <Breakdown title="By channel" sub="How tickets arrive" data={byChannel} href="/cyber-assurance/helpdesk/tickets" />}
            </div>
          </div>

          {/* Recent & at-risk tickets */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Recent tickets" sub="Most recently updated" href="/cyber-assurance/helpdesk/tickets" cta="All tickets">
              {base.loading && !recent.length ? <Loading rows={5} /> : recent.length === 0 ? (
                <Empty icon={<Inbox size={16} />} title="No tickets yet" body="New tickets will appear here as they come in." compact />
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-[#F1F3F7] p-0">
                  {recent.map((t) => (
                    <li key={t.name}>
                      <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(t.name)}`} className="flex items-center gap-3 px-1 py-2.5 hover:bg-[#F6F7FB]">
                        <span className="font-mono text-[11px] text-[#94A3B8]">#{t.name}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#0F172A]">{t.subject || "(no subject)"}</span>
                        <Chip value={t.priority} map={PRIORITY_CHIP} />
                        <Chip value={t.status} />
                        <span className="hidden w-16 shrink-0 text-right text-[11px] text-[#94A3B8] sm:block">{timeAgo(t.modified)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="At-risk tickets" sub="Open · breached or due within 24h" href="/cyber-assurance/helpdesk/tickets" cta="All tickets">
              {tix.loading && !tickets.length ? <Loading rows={5} /> : atRisk.length === 0 ? (
                <Empty icon={<AlertTriangle size={16} />} title="Nothing at risk" body="No open ticket is breaching or due within 24 hours." compact />
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-[#F1F3F7] p-0">
                  {atRisk.map((t) => (
                    <li key={t.name}>
                      <Link href={`/cyber-assurance/helpdesk/tickets/${encodeURIComponent(t.name)}`} className="flex items-center gap-3 px-1 py-2.5 hover:bg-[#F6F7FB]">
                        <span className="font-mono text-[11px] text-[#94A3B8]">#{t.name}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#0F172A]">{t.subject || "(no subject)"}</span>
                        <Chip value={t.priority} map={PRIORITY_CHIP} />
                        <span className="hidden w-24 text-right sm:block"><SlaBadge due={t.resolution_by || t.response_by} done={/resolved|closed/i.test(t.status || "")} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
