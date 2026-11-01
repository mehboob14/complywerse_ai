'use client';

// The Performance Overview's modules: the four tiles, then one card for each module the person may open (a score and its weakest sections, or a count snapshot),
// then "Where to act first". Every card loads, fails, is refused and has nothing on its own: the old page caught every failure into null, which read as "No data
// yet" and nothing was ever retried. The requests, their keys and their stale times are what they were (the first six share their cache with the module
// pages); what each state shows is decided in overviewModel.ts (tested), this file draws it.
// On the design-system kit: StatTile, StatusPill, ProgressBar, ChartFrame, Notice, EmptyState, Skeleton; one Tab stop per card (the module's name is its link and
// covers the card), no chart takes focus, and every number a chart draws is in words.
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import {
  AlertTriangle, BadgeCheck, ClipboardCheck, Flame, Landmark, Layers, LayoutDashboard, LifeBuoy, ListTodo, RotateCw, Server, Shield, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Button, ChartFrame, EmptyState, Notice, ProgressBar, Skeleton, StatTile, StatusPill, type ProgressTone } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { formatCount, statusLabel } from '@/lib/format';
import { TONE, statusPill, type Tone } from '@/lib/status';
import { bandStatus, controlImplementation } from '@/lib/statuses/dashboard';
import { ScoreRing, scoreBand } from '@/components/dashboard/score-kit';
import { ModulesTile, PastSlaTile, ReadinessTile, RiskTile } from './Tiles';
import { BOX, FOCUS, FailedRow, Loading, SectionHead, useSlow } from './parts';
import {
  RISK_PATH, RISK_PERMISSIONS, RISK_QUERY_KEY, cardRows, cutText, failedViews, loadOf, modulesTile, pastSlaTile, postureTile, priorities, readinessTile,
  retryDashboard, retryableViews, ringLabel, scoreText, sliceTable, sliceText, slices, viewOf, visibleModules,
  type Card, type ModuleView, type Slice,
} from './overviewModel';

const ICONS: Record<string, LucideIcon> = {
  governance: Landmark, compliance: ShieldCheck, assessments: ClipboardCheck, assets: Server, issues: ListTodo,
  assurance: BadgeCheck, frameworks: Layers, 'vendor-risk': Shield, bcm: LifeBuoy,
};

/** The colours of the donut's segments, taken from the tone table (an SVG attribute cannot read a class): a control status has its own tone, any other
 *  grouping (a vendor tier, a plan status) walks this list in the order the old chart used: blue, violet, green, amber, red, grey. */
const WALK: Tone[] = ['progress', 'pending', 'success', 'warning', 'danger', 'neutral'];
/** "Not applicable" and "not started" are both the neutral tone: the first is drawn a shade lighter so the two slices can be told apart. */
const LIGHTER: Record<string, string> = { not_applicable: '#94A3B8' };
const sliceColor = (s: Slice, i: number): string => (s.key && LIGHTER[s.key]) || TONE[s.key && controlImplementation.has(s.key) ? controlImplementation.tone(s.key) : WALK[i % WALK.length]].dot;

/** A section's bar takes the tone of its score band (strong green, fair amber, weak red). */
function barTone(score: number | null | undefined): ProgressTone {
  const tone = bandStatus.tone(scoreBand(score).label);
  return tone === 'success' || tone === 'warning' || tone === 'danger' ? tone : 'primary';
}

// the module's name is a link that covers the whole card (so the card is one target and one Tab stop); what must stay pressable inside it sits above (relative z-[1])
const COVER = 'after:absolute after:inset-0 after:rounded-ds-card hover:underline focus-visible:outline-none focus-visible:after:shadow-ds-ring';

function Medallion({ Icon, tone }: { Icon: LucideIcon; tone?: 'danger' }) {
  return (
    <span aria-hidden className={`grid h-[54px] w-[54px] shrink-0 place-items-center rounded-full ${tone === 'danger' ? 'bg-ds-danger-soft text-ds-danger' : 'bg-ds-surface-hover text-ds-fg-muted'}`}>
      <Icon className="h-[24px] w-[24px]" strokeWidth={1.5} />
    </span>
  );
}

function Rows({ card }: { card: Card }) {
  const { rows, total } = cardRows(card);
  const cut = cutText(rows.length, total);
  return (
    <div>
      <p className="mb-[8px] text-ds-label text-ds-fg-muted">Weakest areas first</p>
      <ul className="space-y-[10px]">
        {rows.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            <div className="flex items-baseline justify-between gap-[8px] text-ds-body">
              <span className="min-w-0 break-words font-[500] text-ds-fg">{s.label}</span>
              <span className="shrink-0 tabular-nums text-ds-fg-muted">{scoreText(s.score)}</span>
            </div>
            {typeof s.score === 'number' && <ProgressBar value={s.score} label={`${s.label} score`} showValue={false} tone={barTone(s.score)} className="mt-[4px]" />}
          </li>
        ))}
      </ul>
      {cut && <p className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">{cut}</p>}
    </div>
  );
}

function Donut({ card }: { card: Card }) {
  const list = slices(card.segs);
  const chart = card.chart ?? { title: 'Records', by: 'Kind', unit: 'records' };
  return (
    <div>
      {/* the legend below says every number, so the picture takes no pointer either (no hover tooltip to depend on, and a press on it opens the module like the rest of the card) */}
      <div className="pointer-events-none">
      <ChartFrame
        title={chart.title}
        note={`${formatCount(card.total ?? 0)} ${chart.unit} in total`}
        height={128}
        data={sliceTable(list, chart.by)}
      >
        {(focusOff) => (
          <ResponsiveContainer width="100%" height="100%" minHeight={96}>
            <PieChart {...focusOff}>
              <Pie data={list} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={34} outerRadius={56} paddingAngle={list.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false} {...focusOff}>
                {list.map((s, i) => <Cell key={i} fill={sliceColor(s, i)} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartFrame>
      </div>
      <ul className="mt-[8px] space-y-[4px]">
        {list.map((s, i) => (
          <li key={`${s.label}-${i}`} className="flex items-center justify-between gap-[8px] text-ds-body">
            <span className="flex min-w-0 items-center gap-[8px] text-ds-fg-body">
              <span aria-hidden className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: sliceColor(s, i) }} />
              <span className="min-w-0 break-words">{statusLabel(s.label)}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ds-fg">{sliceText(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pending({ view, slow }: { view: ModuleView; slow: boolean }) {
  return (
    <Loading label={`Loading ${view.def.label}`} slow={slow}>
      <div className="space-y-[12px]">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[28px] w-full" />)}</div>
    </Loading>
  );
}

function ModuleCard({ view, onRetry }: { view: ModuleView; onRetry: () => void }) {
  const { def, card, state } = view;
  const Icon = ICONS[def.key] ?? LayoutDashboard;
  const slow = useSlow(state === 'loading');
  const band = view.scored && card ? scoreBand(card.score).label : 'no data';
  const refused = state === 'denied';
  const headId = `module-${def.key}`;

  let lead: React.ReactNode = <Medallion Icon={Icon} />;
  let pill: React.ReactNode = null;
  let body: React.ReactNode;
  if (state === 'loading') {
    lead = <Skeleton className="h-[54px] w-[54px] shrink-0 rounded-full" />;
    body = <Pending view={view} slow={slow} />;
  } else if (state === 'error' || state === 'denied') {
    lead = <Medallion Icon={AlertTriangle} tone="danger" />;
    body = (
      <div className="relative z-[1]">
        <FailedRow title={refused ? `You can't open the ${def.label} overview` : `Couldn't load ${def.label}`} error={view.error} onRetry={onRetry} />
      </div>
    );
  } else if (view.scored && card) {
    lead = (
      <div role="img" aria-label={ringLabel(def.label, card.score, bandStatus.label(band))}>
        <ScoreRing score={card.score} size={54} />
      </div>
    );
    pill = <StatusPill {...statusPill(bandStatus, band)} size="sm" className="mt-[6px]" />;
    body = <Rows card={card} />;
  } else if (card) {
    const list = slices(card.segs);
    pill = <StatusPill tone="neutral" label={card.hasData ? 'Count snapshot' : 'No data'} size="sm" className="mt-[6px]" />;
    body = list.length > 0
      ? <Donut card={card} />
      : <EmptyState kind="firstUse" icon={Icon} bare title={card.hasData ? 'Nothing to chart yet' : 'No data yet'} description={`Open ${def.label} to get started.`} className="py-[16px]" />;
  }
  return (
    <article aria-labelledby={headId} className={`${BOX} relative flex flex-col hover:border-ds-border-strong`}>
      <div className="flex items-start gap-[12px]">
        {lead}
        <div className="min-w-0 flex-1">
          <h3 id={headId} className="flex min-w-0 items-start gap-[6px] !text-ds-section !text-ds-fg">
            <Icon aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
            <Link href={def.href} className={`min-h-[24px] min-w-0 break-words ${COVER}`}>{def.label}</Link>
          </h3>
          {pill}
        </div>
      </div>
      {card?.note && <div className="mt-[8px] flex"><StatusPill tone={card.noteTone ?? 'neutral'} label={card.note} size="sm" /></div>}
      <div className="mt-[12px] flex-1">{body}</div>
    </article>
  );
}

/** "Where to act first": the lowest section scores across the modules, each a link to its module (not to the section: the sections have no address). */
function Priorities({ views }: { views: ModuleView[] }) {
  const { rows, total } = priorities(views);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="priorities-h" className={BOX}>
      <div className="mb-[12px] flex items-center gap-[12px]">
        <span aria-hidden className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-full bg-ds-danger-soft text-ds-danger"><Flame className="h-[16px] w-[16px]" strokeWidth={1.75} /></span>
        <div className="flex min-w-0 items-center gap-[4px]">
          <h3 id="priorities-h" className="min-w-0 break-words !text-ds-section !text-ds-fg">Where to act first</h3>
          <InfoTip text="The lowest-scoring sections across all the modules that have a score. Each links to its module." label="About where to act first" />
        </div>
      </div>
      <ul className="space-y-[2px]">
        {rows.map((p, i) => (
          <li key={`${p.moduleKey}-${p.label}-${i}`}>
            <Link href={p.href} className={`flex min-h-ds-control items-center gap-[12px] rounded-ds-control px-[8px] py-[6px] hover:bg-ds-surface-hover ${FOCUS}`}>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-ds-body font-[500] text-ds-fg">{p.label}</span>
                <span className="block break-words text-ds-label font-normal text-ds-fg-muted">{p.module}</span>
              </span>
              <span aria-hidden className="h-[6px] w-[48px] shrink-0 rounded-full bg-ds-border">
                <span className="block h-[6px] rounded-full" style={{ width: `${Math.max(6, Math.min(100, p.score))}%`, background: TONE[bandStatus.tone(scoreBand(p.score).label)].dot }} />
              </span>
              <span className="w-[40px] shrink-0 text-right text-ds-body tabular-nums text-ds-fg">{scoreText(p.score)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {total > rows.length && <p className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">{`Showing the ${rows.length} lowest of ${total} sections`}</p>}
    </section>
  );
}

function PendingGrid() {
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
        {['Overall readiness', 'Risk posture', 'Open items past SLA', 'Modules with data'].map((label) => <StatTile key={label} label={label} value={null} loading />)}
      </div>
      <div className="grid gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={BOX}>
            <Loading label="Loading the modules">
              <div className="flex items-start gap-[12px]"><Skeleton className="h-[54px] w-[54px] shrink-0 rounded-full" /><Skeleton className="mt-[4px] h-[20px] w-[60%]" /></div>
              <div className="mt-[12px] space-y-[12px]">{[0, 1, 2].map((j) => <Skeleton key={j} className="h-[28px] w-full" />)}</div>
            </Loading>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModuleOverview() {
  const { hasAnyPermission, isAdmin, isLoading: permsLoading } = usePermissions();
  const modules = visibleModules(isAdmin, hasAnyPermission);

  // one request per module the person is shown; the answers are the module pages' own (the same keys), and a failure is thrown, not turned into null
  const queries = useQueries({
    queries: modules.map((m) => ({
      queryKey: m.queryKey ?? ['main-dashboard', m.key],
      queryFn: async () => (await apiClient.get(m.path)).data,
      staleTime: 60_000,
      enabled: !permsLoading,
      retry: retryDashboard,
    })),
  });
  const canSeeRisk = isAdmin || hasAnyPermission(RISK_PERMISSIONS);
  const risk = useQuery({
    queryKey: RISK_QUERY_KEY,
    queryFn: async () => (await apiClient.get(RISK_PATH)).data,
    staleTime: 60_000,
    enabled: !permsLoading && canSeeRisk,
    retry: retryDashboard,
  });

  if (permsLoading) return <PendingGrid />;
  if (modules.length === 0) {
    return (
      <EmptyState
        kind="firstUse"
        icon={LayoutDashboard}
        title="No modules to show"
        description="Your role does not open any of the modules this page summarises. Use the main menu to open the areas you can access."
        info="If you expected modules here, ask an administrator to check your role."
      />
    );
  }

  const views = modules.map((m, i) => viewOf(m, { load: loadOf(queries[i]), data: queries[i].data ?? undefined, error: queries[i].error }));
  const retryViews = (list: ModuleView[]) => list.forEach((v) => { void queries[views.indexOf(v)].refetch(); });
  const failed = failedViews(views);
  const retryable = retryableViews(views);
  const withData = modulesTile(views);

  return (
    <div className="flex flex-col gap-[16px]">
      <section aria-label="Summary" className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <ReadinessTile tile={readinessTile(views)} onRetry={() => retryViews(retryable)} />
        <RiskTile tile={postureTile(canSeeRisk, { load: loadOf(risk), data: risk.data ?? undefined, error: risk.error })} onRetry={() => { void risk.refetch(); }} />
        <PastSlaTile tile={pastSlaTile(views)} onRetry={() => retryViews(retryable.filter((v) => ['assessments', 'issues', 'assurance'].includes(v.def.key)))} />
        <ModulesTile tile={withData} />
      </section>

      <section aria-labelledby="modules-h">
        <SectionHead
          id="modules-h"
          title="Modules"
          meta={withData.state === 'ready' ? `${withData.value.withData} of ${withData.value.visible} have data` : undefined}
          actions={retryable.length > 1 ? <Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={() => retryViews(retryable)}>{`Retry ${retryable.length} failed`}</Button> : undefined}
        />
        {failed.length > 0 && (
          <Notice tone="warning" title={`${failed.length} of ${views.length} ${views.length === 1 ? 'module' : 'modules'} did not load`} className="mb-[12px]">
            {`${failed.map((v) => v.def.label).join(', ')}. The totals above leave ${failed.length === 1 ? 'it' : 'them'} out.`}
          </Notice>
        )}
        <div className="grid items-stretch gap-[12px] sm:grid-cols-2 xl:grid-cols-3">
          {views.map((v) => <ModuleCard key={v.def.key} view={v} onRetry={() => retryViews([v])} />)}
          <Priorities views={views} />
        </div>
      </section>
    </div>
  );
}
