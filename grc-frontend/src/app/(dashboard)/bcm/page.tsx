'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > Overview. One request (GET /bcm/dashboard, key ['bcm-dashboard'], refreshed every minute): its figures are the SERVER's (active plans, drill coverage,
// RTO/RPO pass rates, open findings, the cross-module rollup) and this page only words them: nothing is recomputed, a figure that is not recorded says "Not recorded" and
// never 0, a failed request says what the server said with Retry (and none for a refusal), and a tenant with nothing yet is shown how to start instead of a page of zeros.
// On the design-system kit: PageHeader variant="page", StatTile, ProgressBar, SectionCard, StatusPill, Skeleton / ErrorState / EmptyState.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardList, Plus } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, NOT_SET, formatCount, formatDate } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import { drillStatus, drillType, planStatus, severity } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, ProgressBar, SectionCard, Skeleton, StatTile } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Pill } from './_parts';
import {
  coverageTile, findingCount, isEmptyTenant, linkageOf, listCut, percentText, planCount, plural, rateTone, retryRead, type Dashboard, type Drill,
} from './bcmModel';

const GRID = 'grid grid-cols-2 gap-[12px] md:grid-cols-3 xl:grid-cols-5';
const ROW_LINK = '-mx-[8px] flex min-h-ds-control items-center justify-between gap-[8px] rounded-ds-control px-[8px] py-[4px] hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';
const COUNT = 'tabular-nums font-[600] text-ds-fg';

function OverviewSkeleton() {
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the overview</span>
      <div aria-hidden className={GRID}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className={card}><Skeleton className="h-[12px] w-[72px]" /><Skeleton className="mt-[12px] h-[28px] w-[56px]" /><Skeleton className="mt-[12px] h-[12px] w-[90%]" /></div>)}
      </div>
      <div aria-hidden className="grid gap-[12px] lg:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className={card}><Skeleton className="h-[16px] w-[140px]" /><Skeleton className="mt-[16px] h-[12px] w-full" /><Skeleton className="mt-[8px] h-[12px] w-[70%]" /><Skeleton className="mt-[8px] h-[12px] w-[85%]" /></div>)}
      </div>
    </div>
  );
}

function DrillRow({ d }: { d: Drill }) {
  return (
    <li>
      <Link href={`/bcm/drills/${d.id}`} className={`${ROW_LINK} flex-wrap`}>
        <span className="min-w-0 flex-1 basis-[14rem]">
          <span className="line-clamp-2 break-words text-ds-body font-[500] text-ds-fg" title={d.title}>{d.title}</span>
          <span className="mt-[2px] block break-words text-ds-label font-normal text-ds-fg-muted">
            {`${drillType.label(d.drill_type)} · ${d.plan_title || EMPTY} · ${formatDate(d.scheduled_date, { calendar: true, empty: NOT_SET })}`}
          </span>
        </span>
        <Pill registry={drillStatus} word={d.effective_status} />
      </Link>
    </li>
  );
}

/** One of the two drill lists. The server cuts each at six; the card says so next to the figure that is not cut, and links to the whole list. */
function DrillList({ id, title, info, drills, total, empty, all }: { id: string; title: string; info: string; drills: Drill[]; total: number; empty: string; all: { href: string; label: string } }) {
  const cut = listCut(drills.length, total);
  return (
    <SectionCard id={id} title={title} info={info} meta={cut ?? undefined} actions={<Button size="sm" variant="link" href={all.href}>{all.label}</Button>}>
      {drills.length === 0 ? (
        <p className="py-[8px] text-ds-body text-ds-fg-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col">{drills.map((d) => <DrillRow key={d.id} d={d} />)}</ul>
      )}
    </SectionCard>
  );
}

export default function BcmDashboardPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('bcm:plans:create');
  const query = useQuery<Dashboard>({
    queryKey: ['bcm-dashboard'],
    queryFn: async () => (await bcmApi.dashboard()).data,
    refetchInterval: 60_000,
    retry: retryRead,
  });
  const d = query.data;

  const head = (
    <PageHeader
      variant="page"
      title={titleFor('/bcm') ?? 'Business Continuity Overview'}
      info="Plans, drills and continuity testing at a glance."
      actions={(
        <>
          <Button href="/bcm/plans" leftIcon={<ClipboardList aria-hidden />}>Plans</Button>
          <Button href="/bcm/drills" leftIcon={<CalendarClock aria-hidden />}>Drills</Button>
        </>
      )}
    />
  );

  if (query.isError && !d) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title="Couldn't load the overview" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />
      </div>
    );
  }
  if (!d) return <div className="flex flex-col gap-[16px]">{head}<OverviewSkeleton /></div>;

  if (isEmptyTenant(d)) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <EmptyState
          kind="firstUse"
          icon={ClipboardList}
          title="No continuity plans yet"
          description={canCreate ? 'Start with a plan: add its business impact analysis, then schedule drills to test it.' : 'No continuity plan has been created yet.'}
          action={canCreate ? <Button variant="primary" href="/bcm/plans?new=1" leftIcon={<Plus aria-hidden />}>Create a plan</Button> : <Button href="/bcm/plans">Open the plans</Button>}
        />
      </div>
    );
  }

  const t = d.totals;
  const cover = coverageTile(d);
  const linkage = linkageOf(d);
  const notSent = 'The server did not send this figure.';

  return (
    <div className="flex flex-col gap-[16px]">
      {head}

      <div className={GRID}>
        <StatTile
          label="Active plans" value={formatCount(t.active_plans)} note={`${formatCount(t.plans)} in total`} info="Plans that are not retired."
          link={{ href: '/bcm/plans', label: `${plural(t.active_plans, 'active plan')}. Open the plans` }}
        />
        <StatTile
          label="Drill coverage" value={cover.value} progress={cover.progress} note={cover.note}
          info={cover.value === null ? 'There is no active plan to cover yet.' : 'Active plans with at least one drill scheduled or created in the last 12 months.'}
        />
        <StatTile
          label="Overdue drills" value={formatCount(t.overdue_drills)} tone={t.overdue_drills > 0 ? 'danger' : 'default'} note={`of ${plural(t.drills, 'drill')}`}
          info="Drills still scheduled whose day has begun."
          link={t.overdue_drills > 0 ? { href: '/bcm/drills?status=overdue', label: `${plural(t.overdue_drills, 'overdue drill')}. Open them` } : undefined}
        />
        <StatTile
          label="Open findings" value={formatCount(t.open_findings)} tone={t.open_findings > 0 ? 'warning' : 'default'} note="Not yet closed in Issues"
          info="A finding is open until its linked issue is closed; a finding with no issue yet is open."
        />
        <StatTile label="BIA processes" value={formatCount(t.bia_records)} note="Across all plans" info="Business impact analysis processes, counted over every plan." />
      </div>

      <SectionCard id="linkage" title="Cross-module linkage" info="Business continuity hands drill findings to Issues / CAPA and links processes and findings to the Risk Register.">
        <div className="grid gap-[12px] sm:grid-cols-3">
          <StatTile
            label="Open CAPAs" value={linkage ? formatCount(linkage.open_capas) : null} info={linkage ? undefined : notSent}
            note={linkage ? `${formatCount(linkage.total_capas)} raised from findings` : undefined}
            link={linkage ? { href: '/issues', label: `${plural(linkage.open_capas, 'open CAPA')}. Open Issues / CAPA` } : undefined}
          />
          <StatTile
            label="Risks linked" value={linkage ? formatCount(linkage.risks_linked) : null} info={linkage ? undefined : notSent}
            note={linkage ? 'From BIA processes and findings' : undefined}
            link={linkage ? { href: '/erm/risks', label: `${plural(linkage.risks_linked, 'linked risk')}. Open the risk register` } : undefined}
          />
          <StatTile
            label="Incident invocations" value={linkage ? formatCount(linkage.incident_invocations) : null} info={linkage ? undefined : notSent}
            note={linkage ? 'Real BCP activations' : undefined}
            link={linkage && linkage.incident_invocations > 0 ? { href: '/bcm/drills?source=incident_triggered', label: `${plural(linkage.incident_invocations, 'incident invocation')}. Open them` } : undefined}
          />
        </div>
      </SectionCard>

      <div className="grid gap-[12px] lg:grid-cols-3">
        <SectionCard id="pass-rate" title="Recovery objective pass rate" info="Of the drills that have a recorded result, the share that met the objective: 80% and over is on track, 50% and over a watch, below that off target.">
          {d.results_scored === 0 ? (
            <p className="text-ds-body text-ds-fg-muted">No drills with recorded results yet.</p>
          ) : (
            <div className="flex flex-col gap-[12px]">
              {[{ label: 'RTO met', v: d.rto_pass_rate }, { label: 'RPO met', v: d.rpo_pass_rate }].map((row) => (
                <div key={row.label}>
                  <div className="mb-[4px] flex items-center justify-between gap-[8px] text-ds-body">
                    <span className="text-ds-fg-body">{row.label}</span>
                    <span className={COUNT}>{percentText(row.v)}</span>
                  </div>
                  <ProgressBar value={row.v} label={row.label} showValue={false} tone={rateTone(row.v) ?? 'primary'} />
                </div>
              ))}
              <p className="text-ds-label font-normal text-ds-fg-muted">{`Across ${plural(d.results_scored, 'drill result')}.`}</p>
            </div>
          )}
        </SectionCard>

        <SectionCard id="findings" title="Open findings by severity" info="Findings that are not closed yet, by the severity they were raised with.">
          <ul className="flex flex-col gap-[4px]">
            {severity.words.map((s) => (
              <li key={s} className="flex min-h-ds-control items-center justify-between gap-[8px]">
                <Pill registry={severity} word={s} />
                <span className={COUNT}>{formatCount(findingCount(d, s))}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard id="plans-by-status" title="Plans by status" info="Every plan, by its status. A row opens the plans in that status.">
          <ul className="flex flex-col gap-[4px]">
            {planStatus.words.map((s) => (
              <li key={s}>
                <Link href={`/bcm/plans?status=${s}`} className={ROW_LINK} aria-label={`${planStatus.label(s)}: ${plural(planCount(d, s), 'plan')}. Open them`}>
                  <Pill registry={planStatus} word={s} />
                  <span className={COUNT}>{formatCount(planCount(d, s))}</span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="grid gap-[12px] lg:grid-cols-2">
        <DrillList
          id="overdue-drills" title="Overdue drills" info="Drills still scheduled whose day has begun, the oldest first."
          drills={d.overdue_drills} total={t.overdue_drills} empty="No overdue drills." all={{ href: '/bcm/drills?status=overdue', label: 'View all' }}
        />
        <DrillList
          id="recent-drills" title="Recent activity" info="The drills and invocations changed most recently."
          drills={d.recent_drills} total={t.drills} empty="No drills yet." all={{ href: '/bcm/drills', label: 'View all' }}
        />
      </div>
    </div>
  );
}
