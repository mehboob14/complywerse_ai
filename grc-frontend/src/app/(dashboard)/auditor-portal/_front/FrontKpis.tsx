'use client';

// The figures the front door leads with: six tiles, each one a number an auditor acts on and each (when there is something behind it) the way into it. Files and scope requests
// waiting open the queue of the journey that holds them (or the list of journeys when several do), the oldest wait opens that item's decision, the observations open the
// register on the same chip. A tile that has a history carries its shape (what waited at each month end, what was decided each month). Each tile loads, fails and has nothing
// on its own: a failed request is said ON the tile with Retry and is never a 0, a refused one says "No access".
import type { UseQueryResult } from '@tanstack/react-query';
import { KpiRow, KpiTile } from '@/components/overview/charts';
import { formatCount, formatDate } from '@/lib/format';
import { counterTarget, rowHref, type WorkPayload } from '@/lib/auditorPortal/portalModel';
import {
  bothSeries, kindSeries, monthLabels, monthOfObservations, oldestWaiting, thisAndLast, tileOf, waitTone, type ObservationSummary, type WorkSummary,
} from '@/lib/auditorPortal/frontModel';
import { tileFeed } from './cardState';

const STATUTORY = '/auditor-portal/statutory-audit';
const plural = (n: number, one: string, other: string): string => `${formatCount(n)} ${n === 1 ? one : other}`;

export interface FrontKpisProps {
  work: UseQueryResult<WorkPayload, Error>;
  summary: UseQueryResult<WorkSummary, Error>;
  observations: UseQueryResult<ObservationSummary, Error>;
}

export function FrontKpis({ work, summary, observations }: FrontKpisProps) {
  const data = work.data;
  const cards = data?.journeys ?? [];
  const w = tileFeed(work, "Couldn't load the counter");
  const s = tileFeed(summary, "Couldn't load the history");
  const o = tileFeed(observations, "Couldn't load the observations");
  const months = summary.data?.months ?? [];

  const files = tileOf(months, kindSeries(summary.data, 'files', 'waiting'), 'Files waiting', 'down');
  const scope = tileOf(months, kindSeries(summary.data, 'scope', 'waiting'), 'Scope requests waiting', 'down');
  const decidedSeries = bothSeries(summary.data, 'decided');
  const decided = tileOf(months, decidedSeries, 'Decided', 'up', false);
  const decidedNow = thisAndLast(decidedSeries);
  const labels = monthLabels(months);
  const oldest = oldestWaiting(data?.rows);
  const first = data?.rows?.[0];
  const registered = monthOfObservations(observations.data);
  const open = observations.data;
  const since = 'this month';

  return (
    <KpiRow>
      <KpiTile
        label="Files to review"
        value={data ? formatCount(data.counters.files_to_review) : null}
        href={data && data.counters.files_to_review > 0 ? counterTarget('files', cards) : undefined}
        linkLabel={data ? `${plural(data.counters.files_to_review, 'file', 'files')} to review. Open the queue` : undefined}
        info="Files sent for review that nobody has approved or turned down yet, across every journey. The graph is what waited at the end of each month; the arrow compares now with the end of last month."
        delta={files?.delta ? { ...files.delta, since } : null}
        spark={files ? { values: files.values, label: 'Files waiting, last 12 months', summary: files.summary, floor: 0 } : null}
        {...w}
      />
      <KpiTile
        label="Scope requests"
        value={data ? formatCount(data.counters.scope_to_decide) : null}
        href={data && data.counters.scope_to_decide > 0 ? counterTarget('scope', cards) : undefined}
        linkLabel={data ? `${plural(data.counters.scope_to_decide, 'scope request', 'scope requests')} to decide. Open the queue` : undefined}
        info="Requests to put a requirement in or out of scope that wait for a decision. A framework shared by two journeys counts once. The graph is what waited at the end of each month."
        delta={scope?.delta ? { ...scope.delta, since } : null}
        spark={scope ? { values: scope.values, label: 'Scope requests waiting, last 12 months', summary: scope.summary, floor: 0 } : null}
        {...w}
      />
      <KpiTile
        label="Oldest waiting"
        value={data ? (oldest ? formatCount(oldest.days) : 'None') : null}
        unit={oldest ? (oldest.days === 1 ? 'day' : 'days') : undefined}
        tone={oldest ? waitTone(oldest.days) : 'success'}
        href={oldest && first ? rowHref(first) : undefined}
        linkLabel={oldest ? `Oldest item has waited ${plural(oldest.days, 'day', 'days')}. Open its decision` : undefined}
        info="How long the oldest file or scope request has waited since it was sent or asked. From 30 days the figure is amber, from 90 days red."
        note={oldest ? `Since ${formatDate(oldest.since)}` : data ? 'Nothing is waiting' : undefined}
        {...w}
      />
      <KpiTile
        label="Decided this month"
        value={decidedNow ? formatCount(decidedNow.now) : null}
        info="Files and scope requests approved or turned down this calendar month so far. The graph is the same count for each of the last 12 months."
        note={decidedNow && decidedNow.before !== null ? `${formatCount(decidedNow.before)} in ${labels[labels.length - 2]?.split(' ')[0] ?? 'the month before'}` : undefined}
        spark={decided ? { values: decided.values, label: 'Decided per month, last 12 months', summary: decided.summary, floor: 0 } : null}
        {...s}
      />
      <KpiTile
        label="Open observations"
        value={open ? formatCount(open.open) : null}
        href={open && open.open > 0 ? `${STATUTORY}?quick=open` : undefined}
        linkLabel={open ? `${plural(open.open, 'open observation', 'open observations')}. Open the register` : undefined}
        info="Observations not yet in a final status of Statutory Audit (closed and cancelled unless the organisation set others)."
        note={registered ? `${formatCount(registered.opened)} registered and ${formatCount(registered.closed)} closed this month` : undefined}
        {...o}
      />
      <KpiTile
        label="Overdue observations"
        value={open ? formatCount(open.deadlines.overdue) : null}
        tone={open ? (open.deadlines.overdue > 0 ? 'danger' : 'success') : 'default'}
        href={open && open.deadlines.overdue > 0 ? `${STATUTORY}?quick=overdue` : undefined}
        linkLabel={open ? `${plural(open.deadlines.overdue, 'overdue observation', 'overdue observations')}. Open the register` : undefined}
        info="Open observations past their due date or SLA: the register's Overdue chip."
        note={open ? `${formatCount(open.deadlines.due_30)} due in the next 30 days` : undefined}
        {...o}
      />
    </KpiRow>
  );
}
