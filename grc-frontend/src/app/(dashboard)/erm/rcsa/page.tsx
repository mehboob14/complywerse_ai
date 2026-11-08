'use client';

export const dynamic = 'force-dynamic';

// RCSA > Worklist: the person's own work first (the Overview pattern of the UX revamp, option A). A band of counters (to complete, sent back, to review, overdue, the findings they
// own, open findings), the person's prioritised rows with ONE action each (Start or Continue, Fix, Review, Open) beside a compact posture card, and for the risk team the
// campaigns they run. What a person sees follows what they do: an assessor sees the units assigned to them, a reviewer what waits for them, the risk team the campaigns too.
// The totals are the server's (GET /rcsa/my-work counts everything; the rows it sends stop at 30), the posture is the dashboard summary (whose two missing fields are fixed).
// The old dashboard's radar is gone: the official RCSA score is the Overview scorecard's (Risk Management > Overview), and a second, different score answered the same question.
// Requests: my-work and the summary; each fails on its own with Retry and a failed request is never drawn as 0.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Plus, RefreshCw } from 'lucide-react';
import { rcsaApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, IconButton, ProgressBar, SectionCard, SegmentedControl, SkeletonRows, StatusPill, WorkRow, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { useNarrow } from '@/components/overview/useNarrow';
import { oneOf } from '@/lib/addressState';
import { formatCount, formatDate } from '@/lib/format';
import { controlText, percent, progressTone, riskBand, riskText } from '@/lib/rcsa/scores';
import { SHOWS, allClear, countersOf, rowView, rowsFor, totalFor, type MyWork, type Show } from '@/lib/rcsa/worklist';
import { statusPill } from '@/lib/status';
import { campaignStatus } from '@/lib/statuses/rcsa';
import { NoRcsaAccess } from './_parts/NoRcsaAccess';
import { RcsaNav } from './_parts/RcsaNav';
import { isForbidden } from '@/lib/rcsa/registerModel';
import { KEYS, useMyWork, useRcsaRights } from './_parts/rcsaData';

const SCHEMA = { show: oneOf(SHOWS, 'all') };
const SHOWN = 10;

interface Summary {
  total_campaigns: number; active_campaigns: number; total_assessments: number; completed_assessments: number; pending_approval: number;
  overdue_assessments: number; completion_rate: number; avg_risk_score: number | null; avg_control_score: number | null; pending_assessments: number; open_findings: number;
}

const FILTER_LABEL: Record<Show, string> = { all: 'All', complete: 'To complete', returned: 'Sent back', review: 'To review', overdue: 'Overdue', findings: 'Findings' };

function PostureFact({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="min-w-0">
      <dt className="text-ds-label font-normal text-ds-fg-muted">{label}</dt>
      <dd className={`mt-[2px] text-ds-body ${tone === 'bad' ? 'font-[600] text-ds-danger' : tone === 'warn' ? 'font-[600] text-ds-warning' : 'text-ds-fg'}`}>{value}</dd>
    </div>
  );
}

export default function RcsaWorklistPage() {
  const narrow = useNarrow();
  const rights = useRcsaRights();
  const work = useMyWork();
  const summary = useQuery({ queryKey: KEYS.summary, queryFn: async () => (await rcsaApi.getDashboardSummary()).data as Summary });
  const [address, setAddress] = useAddressState(SCHEMA);
  const show = address.show;
  const [all, setAll] = useState(false);

  const data = work.data as MyWork | undefined;
  const counters = useMemo<BandCounter[]>(() => {
    if (!data) {
      return ['To complete', 'To review', 'Overdue', 'Open findings'].map((label) => ({
        key: label, label, href: '/erm/rcsa', tone: 'neutral', state: work.isError ? 'error' : 'loading', onRetry: () => { void work.refetch(); },
      }) as BandCounter);
    }
    return countersOf(data).map((c) => ({
      key: c.key, label: c.label, tone: c.tone, state: 'ready', value: c.value,
      href: c.href ?? (c.show ? `/erm/rcsa?show=${c.show}` : '/erm/rcsa'),
    }) as BandCounter);
  }, [data, work]);

  const rows = data ? rowsFor(data.rows, show) : [];
  const trueTotal = data ? totalFor(data, show) : 0;
  const visible = all ? rows : rows.slice(0, SHOWN);
  const options = data
    ? SHOWS.filter((s) => s === 'all' || totalFor(data, s) > 0).map((s) => ({ value: s, label: `${FILTER_LABEL[s]} ${formatCount(totalFor(data, s))}` }))
    : [];

  const refresh = () => { void work.refetch(); void summary.refetch(); };
  const workCard = (
    <SectionCard
      id="work"
      title="Do now"
      info="Your own work, overdue first. Sent-back units come before the rest, then what is due soonest."
      meta={data ? `${formatCount(data.counts.actions)} ${data.counts.actions === 1 ? 'item' : 'items'}${data.counts.overdue > 0 ? ` · ${formatCount(data.counts.overdue)} overdue` : ''}` : undefined}
      actions={options.length > 2 ? <SegmentedControl<Show> label="Show" name="rcsa-work-filter" options={options} value={show} onChange={(v) => setAddress({ show: v })} /> : undefined}
    >
      {work.isLoading && <SkeletonRows rows={4} columns={3} label="Loading your work" />}
      {work.isError && !data && (
        <ErrorState compact title="Couldn't load your work" message={errorMessage(work.error)} onRetry={canRetry(work.error) ? () => { void work.refetch(); } : undefined} />
      )}
      {data && rows.length === 0 && (
        <p className="flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          {show === 'all' ? allClear(data) : `Nothing under "${FILTER_LABEL[show]}".`}
        </p>
      )}
      {data && rows.length > 0 && (
        <>
          <ul aria-label="Your work" className="m-0 list-none p-0">
            {visible.map((r) => {
              const v = rowView(r);
              return (
                <WorkRow
                  key={v.key} kind={v.kind} title={v.title} href={v.href} context={v.context} due={v.due ?? undefined} calendar overdue={r.overdue}
                  action={{ label: v.action.label, href: v.action.href, variant: r.kind === 'returned' || r.overdue ? 'primary' : 'secondary' }}
                />
              );
            })}
          </ul>
          <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
            <span role="status">
              {trueTotal > visible.length ? `Showing ${formatCount(visible.length)} of ${formatCount(trueTotal)}` : `${formatCount(trueTotal)} ${trueTotal === 1 ? 'item' : 'items'}`}
            </span>
            {rows.length > SHOWN && <Button variant="link" size="sm" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show ${formatCount(rows.length - SHOWN)} more`}</Button>}
          </div>
        </>
      )}
    </SectionCard>
  );

  const s = summary.data;
  const posture = (
    <SectionCard id="posture" title="RCSA posture" info="Across every campaign. The official RCSA score is on the Risk Management Overview." actions={<Button variant="link" size="sm" href="/erm">Overview score</Button>}>
      {summary.isLoading && <SkeletonRows rows={4} columns={2} label="Loading the posture" />}
      {summary.isError && !s && <ErrorState compact title="Couldn't load the posture" message={errorMessage(summary.error)} onRetry={canRetry(summary.error) ? () => { void summary.refetch(); } : undefined} />}
      {s && (
        <div className="flex flex-col gap-[12px]">
          <ProgressBar
            value={percent(s.completed_assessments, s.total_assessments)} label="Units approved"
            valueText={`${formatCount(s.completed_assessments)} of ${formatCount(s.total_assessments)} units approved`}
            tone={s.total_assessments > 0 && s.completed_assessments === s.total_assessments ? 'success' : 'primary'}
          />
          <dl className="m-0 grid grid-cols-2 gap-x-[12px] gap-y-[8px]">
            <PostureFact label="Average residual" value={riskText(s.avg_risk_score)} tone={riskBand(s.avg_risk_score) === 'critical' || riskBand(s.avg_risk_score) === 'high' ? 'warn' : undefined} />
            <PostureFact label="Controls" value={controlText(s.avg_control_score)} />
            <PostureFact label="Waiting for review" value={formatCount(s.pending_approval)} />
            <PostureFact label="Overdue units" value={formatCount(s.overdue_assessments)} tone={s.overdue_assessments > 0 ? 'bad' : undefined} />
            <PostureFact label="Not finished" value={formatCount(s.pending_assessments)} />
            <PostureFact label="Open findings" value={formatCount(s.open_findings)} tone={s.open_findings > 0 ? 'warn' : undefined} />
          </dl>
          <p className="text-ds-label text-ds-fg-muted">{`${formatCount(s.active_campaigns)} active ${s.active_campaigns === 1 ? 'campaign' : 'campaigns'} of ${formatCount(s.total_campaigns)}.`}</p>
        </div>
      )}
    </SectionCard>
  );

  const breakdowns: Breakdown[] = [];
  if (data && data.roles.manage) {
    breakdowns.push({
      id: 'campaigns',
      title: 'Campaigns you run',
      info: 'Draft and active campaigns, soonest due first. Open one to chase late units or review its answers.',
      meta: `${formatCount(data.campaigns_total)} ${data.campaigns_total === 1 ? 'campaign' : 'campaigns'}`,
      size: 'band',
      actions: <Button size="sm" href="/erm/rcsa/campaigns">All campaigns</Button>,
      children: data.campaigns.length === 0 ? (
        <p className="px-[4px] py-[8px] text-ds-body text-ds-fg-muted">No campaign is running. Create one to ask the business units for their self-assessment.</p>
      ) : (
        <ul aria-label="Campaigns you run" className="m-0 list-none p-0">
          {data.campaigns.map((c) => {
            const pct = percent(c.approved, c.units);
            const pill = statusPill(campaignStatus, c.status);
            const tone = progressTone(pct, c.late > 0);
            return (
              <li key={c.id} className="grid grid-cols-1 items-center gap-x-[16px] gap-y-[4px] border-t border-ds-border px-[8px] py-[8px] first:border-t-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
                <div className="min-w-0">
                  <Link href={`/erm/rcsa/campaigns/${c.id}`} className="block min-h-ds-control content-center text-ds-body font-[500] text-ds-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring [overflow-wrap:anywhere]">{c.name}</Link>
                  <p className="mt-[2px] flex flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted">
                    <StatusPill size="sm" tone={pill.tone} label={pill.label} />
                    <span>{[c.period, c.due_date ? `due ${formatDate(c.due_date, { calendar: true })}` : null].filter(Boolean).join(' · ')}</span>
                  </p>
                </div>
                <ProgressBar value={pct} label={`${c.name} approved`} valueText={`${formatCount(c.approved)} of ${formatCount(c.units)} approved`} tone={tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'primary'} />
                <p className="text-ds-label text-ds-fg-muted sm:text-right">
                  {c.late > 0 ? <span className="font-[600] text-ds-danger">{`${formatCount(c.late)} late`}</span> : 'None late'}
                  {c.waiting_review > 0 ? ` · ${formatCount(c.waiting_review)} to review` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      ),
    });
  }

  const mode = data && data.rows.length < 3 ? 'solo' : 'full';
  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title="RCSA"
        info="Risk and control self-assessment: business units answer a questionnaire each cycle, a reviewer approves or sends it back, and what they find becomes findings you track."
        meta={<IconButton label="Refresh your work" onClick={refresh}><RefreshCw aria-hidden /></IconButton>}
        actions={rights.manage ? <Button variant="primary" href="/erm/rcsa/campaigns?new=1" leftIcon={<Plus aria-hidden />}>New campaign</Button> : undefined}
      />
      <RcsaNav active="worklist" counts={data ? { worklist: data.counts.actions } : undefined} />
      {work.isError && !data && isForbidden(work.error) ? <NoRcsaAccess /> : (
      <Cockpit
        mode={mode}
        narrow={narrow}
        band={(
          <CounterBand
            id="attention"
            title="Needs attention"
            info="Each count opens the rows it counts, or the page that lists them."
            counters={counters}
            narrow={narrow}
            failure={work.isError && !data ? { title: "Couldn't load your counts", message: errorMessage(work.error), onRetry: canRetry(work.error) ? () => { void work.refetch(); } : undefined } : undefined}
          />
        )}
        work={workCard}
        posture={posture}
        breakdowns={breakdowns}
      />
      )}
    </div>
  );
}
