'use client';

/**
 * The figures the Issue & Incident Overview leads with (Overview v2, rule R1): six tiles, each one a number with its shape or its share and each the way into the records it counts (R6): open
 * issues (their shape over twelve months, the change against 30 days ago), late issues, critical or high issues, issues closed on time, late corrective actions and (with the incident right)
 * open incidents. Attention is the tile's STATUS colour (red for what is late or serious, green when there is none) with the tile's own word, never a chip wall. A tile loads, fails (with Retry) or has
 * nothing on its own: a failed list is "Couldn't load", never a 0. Every number is the register's own count (overviewModel.countersOf), so it is the number after the click.
 */
import { useMemo } from 'react';
import { KpiRow, KpiTile, changeOf, deltaOf, trendText } from '@/components/overview/charts';
import { formatCount } from '@/lib/format';
import { openAction } from '@/lib/issues/actionDef';
import { closedOnTime, issueHistory, openAt } from './chartModel';
import type { Counter, Feeds } from './overviewModel';
import { LINKS, shareOf } from './v2Model';
import type { ErrorInfo, Errors } from './cards';

export interface HeroProps { now: Date; feeds: Feeds; errors: Errors; counters: readonly Counter[] }

const failure = (what: string, e?: ErrorInfo) => ({ title: `Couldn't load ${what}`, message: e?.message, onRetry: e?.onRetry });
const hasAny = (values: readonly number[]): boolean => values.some((v) => v > 0);

export function IssueHero({ now, feeds, errors, counters }: HeroProps) {
  const rows = feeds.issues.rows;
  const ready = feeds.issues.state === 'ready';
  const history = useMemo(() => issueHistory(rows, now), [rows, now]);
  const onTime = useMemo(() => closedOnTime(rows), [rows]);
  const before = useMemo(() => openAt(rows, now.getTime() - 30 * 86_400_000), [rows, now]);
  const counter = (key: string) => counters.find((c) => c.key === key);
  const fed = (key: string) => {
    const c = counter(key);
    return { value: c?.state === 'ready' && c.value !== undefined ? c.value : null, loading: c?.state === 'loading', error: c?.state === 'error' ? failure(c.label.toLowerCase(), errors[c.feed]) : null, href: c?.href };
  };
  const open = fed('open');
  const late = fed('late');
  const serious = fed('serious');
  const lateActions = fed('actions_late');
  const openIncidents = fed('incidents_open');
  const severeIncidents = fed('incidents_severe');
  const own = { loading: feeds.issues.state === 'loading', error: feeds.issues.state === 'error' ? failure('the issues', errors.issues) : null };
  const openActions = feeds.actions.state === 'ready' ? feeds.actions.rows.filter(openAction).length : null;
  const labels = history.slots.map((s) => s.label);
  const spark = hasAny(history.open) && ready
    ? { values: history.open, label: 'Open issues at the end of each month, last 12 months', summary: trendText('Open issues at the end of each month', labels.map((label, i) => ({ label, value: history.open[i] as number | null }))), floor: 0 }
    : null;
  const onTimePct = ready && onTime.of > 0 ? Math.round((onTime.onTime / onTime.of) * 100) : null;
  const plural = (n: number, one: string, other: string) => `${formatCount(n)} ${n === 1 ? one : other}`;

  return (
    <KpiRow>
      <KpiTile
        label="Open issues" value={open.value === null ? null : formatCount(open.value)} loading={open.loading} error={open.error} href={open.href}
        linkLabel={open.value === null ? undefined : `${plural(open.value, 'open issue', 'open issues')}. Open the register`}
        delta={ready && open.value !== null ? (() => { const d = deltaOf(changeOf([before, open.value]), 'down'); return d ? { ...d, since: 'vs 30 days ago' } : null; })() : null}
        spark={spark}
        info="New, triage, in progress, resolution or closure review: the issues the register's Open chip keeps. The line is the issues open at the end of each month; the change is against 30 days ago."
      />
      <KpiTile
        label="Late issues" value={late.value === null ? null : formatCount(late.value)} loading={late.loading} error={late.error} href={late.href}
        linkLabel={late.value === null ? undefined : `${plural(late.value, 'late issue', 'late issues')}. Open the register`}
        tone={late.value ? 'danger' : 'success'} progress={shareOf(late.value, open.value)}
        info="Open issues whose target date has passed: the issues the register's Late chip keeps. The bar is their share of the open issues."
      />
      <KpiTile
        label="Critical or high" value={serious.value === null ? null : formatCount(serious.value)} loading={serious.loading} error={serious.error} href={serious.href}
        linkLabel={serious.value === null ? undefined : `${plural(serious.value, 'critical or high issue', 'critical or high issues')}. Open the register`}
        tone={serious.value ? 'danger' : 'success'} progress={shareOf(serious.value, open.value)}
        info="Open issues of critical or high severity: the issues the register's Critical or high chip keeps. The bar is their share of the open issues."
      />
      <KpiTile
        label="Closed on time" value={onTimePct === null ? null : `${onTimePct}%`} {...own} href={onTimePct === null ? undefined : LINKS.closed}
        linkLabel={onTimePct === null ? undefined : `${onTimePct}% of closed issues were closed on time. Open the closed issues`}
        progress={onTimePct} tone={onTimePct === null ? 'default' : onTimePct >= 70 ? 'success' : onTimePct >= 50 ? 'warning' : 'danger'}
        info={`Closed issues that had a target date and were closed on or before it, over all closed issues that had one: the Closed on time measure of the score${onTimePct === null ? '. No closed issue has both dates yet' : `. ${formatCount(onTime.onTime)} of ${formatCount(onTime.of)} closed issues`}.`}
      />
      <KpiTile
        label="Late actions" value={lateActions.value === null ? null : formatCount(lateActions.value)} loading={lateActions.loading} error={lateActions.error} href={lateActions.href}
        linkLabel={lateActions.value === null ? undefined : `${plural(lateActions.value, 'late corrective action', 'late corrective actions')}. Open the actions`}
        tone={lateActions.value ? 'danger' : 'success'} progress={shareOf(lateActions.value, openActions)}
        info="Corrective actions still open and past their due date: the actions the Actions register's Late chip keeps, and the ones the score counts. The bar is their share of the open actions."
      />
      {feeds.incidents && (
        <KpiTile
          label="Open incidents" value={openIncidents.value === null ? null : formatCount(openIncidents.value)} loading={openIncidents.loading} error={openIncidents.error} href={openIncidents.href}
          linkLabel={openIncidents.value === null ? undefined : `${plural(openIncidents.value, 'open incident', 'open incidents')}. Open the incidents`}
          tone={severeIncidents.value ? 'danger' : 'default'} note={severeIncidents.value ? `${formatCount(severeIncidents.value)} critical or high` : undefined}
          info="Incidents not yet resolved or closed. The ones of critical or high severity are named under the figure and red in the incident card."
        />
      )}
    </KpiRow>
  );
}
