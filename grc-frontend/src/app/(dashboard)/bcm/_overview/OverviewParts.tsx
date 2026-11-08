'use client';

/**
 * The parts of the Business Continuity Overview the cockpit frame (components/overview) arranges: "Do now" (the signed-in person's own work, from the dashboard's `mine` block, one action on each
 * row), the posture card (the server's figures, unchanged: drill coverage, RTO and RPO met), and the breakdown bodies (plans by status, open findings by severity, recent activity, links to the other
 * modules). Nothing here recomputes a figure: a figure that is not recorded says so and is never 0. Rows and words: overviewModel.ts.
 */
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { drillStatus, drillType, planStatus, severity } from '@/lib/statuses/bcm';
import { EMPTY, NOT_SET, formatCount, formatDate } from '@/lib/format';
import { Button, CountRow, ProgressBar, SectionCard, WorkRow } from '@/components/ui/ds';
import { Pill } from '../_bcm-ui';
import { coverageTile, findingCount, linkageOf, listCut, percentText, planCount, plural, rateTone, type Dashboard, type Drill } from '../bcmModel';
import { mineLine, type WorkItem } from './overviewModel';

const ROW_LINK = '-mx-[8px] flex min-h-ds-control items-center justify-between gap-[8px] rounded-ds-control px-[8px] py-[4px] hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';
const COUNT = 'tabular-nums font-[600] text-ds-fg';
const MUTED = 'text-ds-fg-muted';

// ── Do now ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function DoNowCard({ items, total, limit }: { items: WorkItem[]; total: number | null; limit: number }) {
  const shown = items.slice(0, limit);
  return (
    <SectionCard
      id="work"
      title="Do now"
      info="Your own work, the most urgent first: drills you own that are overdue, plans you own whose review is due, findings you own (or on a drill you own) that have no issue yet, and your processes without a recovery strategy."
      meta={total !== null ? mineLine(shown.length, total) : undefined}
    >
      {total === null || total === 0 ? (
        <p className={`flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body ${MUTED}`}>
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          {total === null ? 'Nothing of yours is listed here.' : "You're all caught up. Overdue drills, due reviews and open findings of yours appear here."}
        </p>
      ) : (
        <>
          <ul aria-label="Do now" className="m-0 list-none p-0">
            {shown.map((i) => (
              <li key={i.key} className="border-t border-ds-border first:border-t-0">
                <WorkRow as="div" kind={i.kind} title={i.title} href={i.href} context={i.context || undefined} due={i.due ?? undefined} calendar overdue={i.due ? undefined : false} action={{ label: i.action, href: i.href }} />
              </li>
            ))}
          </ul>
          {total > shown.length && (
            <div className={`mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label ${MUTED}`}>
              <span role="status">{`${mineLine(shown.length, total)}`}</span>
              <span className="flex flex-wrap gap-x-[12px]">
                <Button size="sm" variant="link" href="/bcm/drills?quick=mine">My drills</Button>
                <Button size="sm" variant="link" href="/bcm/plans?quick=mine">My plans</Button>
                <Button size="sm" variant="link" href="/bcm/findings?quick=mine">My findings</Button>
              </span>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── posture ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function PostureCard({ d }: { d: Dashboard }) {
  const cover = coverageTile(d);
  return (
    <SectionCard
      id="posture"
      title="Continuity posture"
      info="Drill coverage is the share of plans in use with a drill scheduled or made in the last 12 months. RTO met and RPO met are the share of drills with a recorded answer that met the objective: 80% and over is on track, 50% and over a watch, below that off target."
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <div className="flex items-baseline justify-between gap-[8px]">
            <span className="text-ds-body text-ds-fg-body">Drill coverage</span>
            <span className="text-[28px] font-[600] leading-none tabular-nums text-ds-fg">{cover.value ?? EMPTY}</span>
          </div>
          {cover.progress !== null && <div className="mt-[6px]"><ProgressBar value={cover.progress} label="Drill coverage" showValue={false} tone={rateTone(cover.progress) ?? 'primary'} /></div>}
          <p className={`mt-[4px] text-ds-label ${MUTED}`}>{cover.value === null ? 'There is no plan in use to cover yet.' : cover.note}</p>
        </div>
        <div className="border-t border-ds-border pt-[12px]">
          {d.results_scored === 0 ? (
            <p className={`text-ds-body ${MUTED}`}>No drills with recorded results yet.</p>
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
              <p className={`m-0 text-ds-label ${MUTED}`}>{`Across ${plural(d.results_scored, 'drill result')}.`}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border pt-[12px] text-ds-body">
          <span className="text-ds-fg-body">Plans in use</span>
          <Link href="/bcm/plans" className={`${COUNT} rounded-ds-control hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring`}>{`${formatCount(d.totals.active_plans)} of ${formatCount(d.totals.plans)}`}</Link>
        </div>
      </div>
    </SectionCard>
  );
}

// ── the breakdowns ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function PlansByStatus({ d }: { d: Dashboard }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
      {planStatus.words.map((s) => (
        <li key={s}>
          <Link href={`/bcm/plans?status=${s}`} className={ROW_LINK} aria-label={`${planStatus.label(s)}: ${plural(planCount(d, s), 'plan')}. Open them`}>
            <Pill registry={planStatus} word={s} />
            <span className={COUNT}>{formatCount(planCount(d, s))}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FindingsBySeverity({ d }: { d: Dashboard }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
      {severity.words.map((s) => (
        <li key={s}>
          <Link href={`/bcm/findings?severity=${s}&quick=open`} className={ROW_LINK} aria-label={`${severity.label(s)}: ${plural(findingCount(d, s), 'open finding')}. Open them`}>
            <Pill registry={severity} word={s} />
            <span className={COUNT}>{formatCount(findingCount(d, s))}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentRow({ d }: { d: Drill }) {
  return (
    <li>
      <Link href={`/bcm/drills/${d.id}`} className={`${ROW_LINK} flex-wrap`}>
        <span className="min-w-0 flex-1 basis-[14rem]">
          <span className="line-clamp-2 break-words text-ds-body font-[500] text-ds-fg" title={d.title}>{d.title}</span>
          <span className={`mt-[2px] block break-words text-ds-label font-normal ${MUTED}`}>
            {`${drillType.label(d.drill_type)} · ${d.plan_title || EMPTY} · ${formatDate(d.scheduled_date, { calendar: true, empty: NOT_SET })}`}
          </span>
        </span>
        <Pill registry={drillStatus} word={d.effective_status} />
      </Link>
    </li>
  );
}

export function RecentActivity({ d }: { d: Dashboard }) {
  const cut = listCut(d.recent_drills.length, d.totals.drills);
  return d.recent_drills.length === 0 ? (
    <p className={`text-ds-body ${MUTED}`}>No drills yet.</p>
  ) : (
    <>
      <ul className="m-0 flex list-none flex-col p-0">{d.recent_drills.map((x) => <RecentRow key={x.id} d={x} />)}</ul>
      {cut && <p className={`mt-[4px] text-ds-label ${MUTED}`}>{cut}</p>}
    </>
  );
}

export function Linkage({ d }: { d: Dashboard }) {
  const linkage = linkageOf(d);
  if (!linkage) return <p className={`text-ds-body ${MUTED}`}>The server did not send these figures.</p>;
  return (
    <ul className="m-0 list-none p-0">
      <CountRow label="Open CAPAs" count={linkage.open_capas} href="/issues" />
      <CountRow label="Risks linked" count={linkage.risks_linked} href="/erm/risks" />
      <CountRow label="Incident invocations" count={linkage.incident_invocations} href={linkage.incident_invocations > 0 ? '/bcm/drills?source=incident_triggered' : undefined} />
    </ul>
  );
}
