'use client';

/**
 * Help Desk KPIs lens for the Performance dashboard.
 *
 * Source: GET /helpdesk/dashboard-overview (helpdesk_native/dashboard.py :: analytics) called
 * with NO window, so the KPIs cover every ticket and `trend` is the trailing 30 days. Only
 * fields that endpoint returns are shown — open (by_status_category.Open) of total, SLA
 * fulfilled %, avg first response, avg resolution, CSAT, and created-vs-resolved from `trend`.
 * Nothing here is estimated or back-filled.
 *
 * Failure isolation: the endpoint is permission-gated (helpdesk:tickets:view). A 403/404 reaches
 * this component as `access: 'forbidden' | 'missing'` (see dashboardExtrasApi.ts) and renders a
 * quiet "No Help Desk access" card — or nothing, with `hideIfNoAccess`. Genuine fetch errors show
 * the standard "didn't load" state, and the LensBoundary contains any render-time exception to
 * this card, so the Help Desk can never break the dashboard.
 */
import type { ReactNode } from 'react';
import { LifeBuoy } from 'lucide-react';
import { FlowChart, NEW_C, PartLegend, RES_C, StackBar, type Part } from './charts';
import { BAND, Card, Empty, Eyebrow, Figure, Key, Loading, Pill, SEV, T, Unavailable, alpha, nfmt, plural, type Tone } from './kit';
import { LensBoundary } from './LensBoundary';
import { fmtDays, fmtHours, hdKpis, slaBand, type HdResult, type LensQuery, type SlaBand } from '@/cyber-assurance/lib/dashboardExtrasApi';

const SLA_TONE: Record<SlaBand, Tone> = {
  excellent: { ...BAND.contained, label: 'Excellent' },
  healthy: { label: 'Healthy', c: T.base, ink: T.strong, bg: alpha(T.base, 0.1) },
  at_risk: { ...SEV.medium, label: 'At risk' },
  breaching: { ...SEV.critical, label: 'Breaching' },
};

const HD_HREF = '/helpdesk/dashboard';

export function HelpDeskKpisLens({ q, hideIfNoAccess = false, className = 'xl:col-span-6' }: {
  q: LensQuery<HdResult>;
  /** true → render nothing at all when the viewer has no Help Desk access (default: a quiet card). */
  hideIfNoAccess?: boolean;
  className?: string;
}) {
  if (hideIfNoAccess && q.data && q.data.access !== 'ok') return null;
  return (
    <LensBoundary title="Help Desk" href={HD_HREF} className={className}>
      <HelpDeskKpis q={q} className={className} />
    </LensBoundary>
  );
}

function HelpDeskKpis({ q, className }: { q: LensQuery<HdResult>; className: string }) {
  const res = q.data;
  const busy = !!q.isFetching && !q.isLoading;
  const frame = (body: ReactNode, link = true) => (
    <Card title="Help Desk" sub="Service-desk health · all tickets, 30-day flow"
      href={link ? HD_HREF : undefined} cta="Open Help Desk" busy={busy} className={className}>
      {body}
    </Card>
  );

  if (q.isLoading && !res) return frame(<Loading rows={5} />);
  if (res && res.access !== 'ok') {
    return frame(
      <Empty compact icon={<LifeBuoy size={16} />} title="No Help Desk access"
        body={res.access === 'forbidden'
          ? 'Help Desk KPIs are shown to users with Help Desk permission.'
          : 'The Help Desk module isn’t available on this workspace.'} />,
      false,
    );
  }
  if (!res?.overview) return frame(<Unavailable what="Help Desk" href={HD_HREF} />);

  const k = hdKpis(res.overview);
  if (!k.total) {
    return frame(
      <Empty icon={<LifeBuoy size={16} />} title="No tickets yet" body="Service-desk KPIs appear here once the first ticket is raised."
        href="/cyber-assurance/helpdesk" cta="Open Help Desk" />,
    );
  }

  const parts: Part[] = [
    { key: 'open', label: 'Open', n: k.open, c: T.base },
    { key: 'paused', label: 'On hold', n: k.paused, c: SEV.medium.c },
    { key: 'resolved', label: 'Resolved', n: k.resolved, c: BAND.contained.c },
    ...(k.other ? [{ key: 'other', label: 'Other', n: k.other, c: SEV.info.c }] : []),
  ];
  const tone = k.slaPct == null ? null : SLA_TONE[slaBand(k.slaPct)];
  const netColor = k.net > 0 ? SEV.critical.ink : k.net < 0 ? T.success : T.text;
  const days = k.windowDays || 30; // the endpoint always sends 30 daily rows without a window; 30 is only a wording fallback

  return frame(
    <div className="flex flex-1 flex-col">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure label="Open tickets" value={nfmt(k.open)} sub={`of ${nfmt(k.total)} total`} />
        <Figure label="SLA fulfilled" value={k.slaPct == null ? '—' : `${Math.round(k.slaPct)}%`}
          sub={tone ? <span className="inline-flex items-center gap-1.5"><Pill tone={tone} /></span> : 'no SLA-tracked tickets'} />
        <Figure label="Avg first response" value={fmtHours(k.firstResponseHours)} sub="time to first reply" />
        <Figure label="Avg resolution" value={fmtDays(k.resolutionDays)} sub="time to resolve" />
      </div>

      <div className="mt-3"><StackBar parts={parts} label="Tickets by status" height={12} /></div>
      <div className="mt-2.5"><PartLegend parts={parts} total={k.total} cols={parts.length > 3 ? 2 : 3} /></div>

      {/* flex-1: takes any height the row adds, so the empty state fills the card instead of leaving a white bottom */}
      <div className="mt-3 flex flex-1 flex-col border-t border-[#F1F3F7] pt-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <Eyebrow>Created vs resolved · last {plural(days, 'day')}</Eyebrow>
        </div>
        {!k.created && !k.resolvedInWindow ? (
          <Empty compact title="No ticket activity" body={`Nothing was created or resolved in the last ${plural(days, 'day')}.`} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Figure label="New" value={nfmt(k.created)} sub="created" />
              <Figure label="Resolved" value={nfmt(k.resolvedInWindow)} sub="closed" />
              <Figure label="Net change" value={<span style={{ color: netColor }}>{k.net > 0 ? '+' : ''}{nfmt(k.net)}</span>}
                sub={k.net > 0 ? 'backlog growing' : k.net < 0 ? 'backlog shrinking' : 'backlog flat'} />
            </div>
            <FlowChart weeks={k.weeks} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11.5px] text-[#334155]">
              <span className="inline-flex items-center gap-1.5"><Key c={NEW_C} />New tickets</span>
              <span className="inline-flex items-center gap-1.5"><Key c={RES_C} />Resolved</span>
              <span className="ml-auto text-[11px] text-[#64748B]">weekly buckets</span>
            </div>
          </>
        )}
      </div>

      <p className="m-0 mt-auto pt-3 text-[10.5px] leading-[1.45] text-[#94A3B8]">
        SLA fulfilled = tickets whose SLA was met ÷ all SLA-tracked tickets (open tickets count until they are fulfilled). SLA, response and resolution figures cover all tickets
        {k.csat != null ? <> · CSAT <b className="font-semibold text-[#64748B]">{k.csat.toFixed(1)}/5</b> from {plural(k.csatCount, 'rating')}</> : ''}.
      </p>
    </div>,
  );
}
