'use client';

/**
 * The parts of the Controls Automation Overview the page hands to the cockpit frame (components/overview): "My work" (the person's own prioritised work, one action a row), the posture card (a bar of where
 * the controls stand, each kind a link into the explorer), the setup journey (the empty state), and the breakdowns (by domain, frameworks, sources, evidence, implementation, the trend). Each part loads,
 * fails and has nothing on its own: a failed request is said where its numbers would be, never read as 0. Words and formulas are overviewModel.ts; nothing here makes a number up.
 */
import { useState } from 'react';
import { CheckCircle2, Circle, RotateCw } from 'lucide-react';
import {
  Button, CountRow, ErrorState, Fact, FactList, Notice, SectionCard, SkeletonRows, StatusPill, Table, TableFrame, TBody, Td, Th, THead, TitleLink, Tr, WorkRow,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { collectionHealth } from '@/lib/statuses/controls';
import { explorerHref } from '../../soc2-controls/_explorer/controlsAddress';
import { StatusBar } from '../../soc2-controls/_explorer/StatusBar';
import {
  CATEGORY_LABEL, collectorsToWatch, frameworkBars, latestTrend, pct, postureSlices, rankedCategories, type Overview, type SetupStep, type WorkItem,
} from './overviewModel';

export interface Feed { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

// ── My work ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function WorkCard({ id, items, sources, limit }: { id: string; items: WorkItem[]; sources: Array<{ label: string; feed: Feed }>; limit: number }) {
  const [shown, setShown] = useState(limit);
  const failed = sources.filter((s) => s.feed.isError);
  const loading = sources.some((s) => s.feed.isPending);
  const overdue = items.filter((i) => i.overdue).length;
  return (
    <SectionCard
      id={id}
      title="My work"
      info="What waits for you: decisions somebody is waiting for, controls you own that fail or whose test or review is late, results that expired or could not be collected, and artifacts you have to write. Most urgent first."
      meta={loading && items.length === 0 ? undefined : <>{`${formatCount(items.length)} ${items.length === 1 ? 'item' : 'items'}`}{overdue > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(overdue)} overdue`}</span></>}</>}
    >
      {failed.map((s) => (
        <Notice key={s.label} tone="warning" title={`${s.label} could not be loaded`} className="mb-[8px]"
          action={canRetry(s.feed.error) ? <Button leftIcon={<RotateCw aria-hidden />} onClick={() => { void s.feed.refetch(); }}>Retry</Button> : undefined}>
          {errorMessage(s.feed.error)} What it holds is not in this list.
        </Notice>
      ))}
      {loading && items.length === 0 && <SkeletonRows rows={Math.min(limit, 5)} columns={3} label="Loading your work" />}
      {!loading && failed.length === 0 && items.length === 0 && (
        <p className="flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          You&apos;re all caught up. Controls that need you appear here.
        </p>
      )}
      {items.length > 0 && (
        <ul aria-label="My work" className="m-0 list-none p-0">
          {items.slice(0, shown).map((it) => (
            <WorkRow key={it.key} kind={it.kind} title={it.title} href={it.href} context={it.context} due={it.due ?? undefined} overdue={it.due ? it.overdue : undefined} action={it.action} />
          ))}
        </ul>
      )}
      {items.length > shown && (
        <div className="mt-[4px] flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
          <span role="status">{`Showing ${formatCount(shown)} of ${formatCount(items.length)}`}</span>
          <Button variant="link" size="sm" onClick={() => setShown((n) => n + 25)}>Show more</Button>
        </div>
      )}
    </SectionCard>
  );
}

// ── Posture ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function PostureCard({ id, data, feed }: { id: string; data: Overview | undefined; feed: Feed }) {
  const slices = data ? postureSlices(data.automation.posture) : [];
  const total = data?.library.controls ?? 0;
  const au = data?.automation;
  return (
    <SectionCard
      id={id}
      title="Where the controls stand"
      info="Each control reads the latest results of its automated checks. A connector that cannot authenticate says nothing about the control it feeds, so those controls read Not collected, never Failing."
      meta={au ? (au.last_run_at ? `Last run ${formatDate(au.last_run_at)}` : 'No check has run yet') : undefined}
    >
      {feed.isPending && <SkeletonRows rows={4} columns={2} label="Loading where the controls stand" />}
      {feed.isError && !data && <ErrorState compact title="Couldn't load the overview" message={errorMessage(feed.error)} onRetry={canRetry(feed.error) ? () => { void feed.refetch(); } : undefined} />}
      {data && (
        <>
          <StatusBar label="Controls by status" total={total} parts={slices.map((s) => ({ key: s.key, label: s.label, value: s.value, tone: s.tone }))} />
          <p className="mb-[4px] mt-[8px] text-ds-body text-ds-fg-muted">{`${formatCount(total)} controls · ${formatCount(au?.controls_with_checks ?? 0)} with automated checks`}</p>
          <ul className="m-0 list-none p-0">
            {slices.map((s) => <CountRow key={s.key} label={s.label} count={s.value} href={s.href} tone={s.tone} />)}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

// ── Setup journey ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SetupCard({ id, steps, canScope }: { id: string; steps: SetupStep[]; canScope: boolean }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <SectionCard id={id} title="Set up Controls Automation" meta={`${done} of ${steps.length} done`} info="Four things to do once. Controls read as passing or failing as soon as a source is connected.">
      <ol className="m-0 flex list-none flex-wrap gap-[12px] p-0">
        {steps.map((s) => (
          <li key={s.key} className="flex min-w-[200px] flex-[1_1_200px] items-center gap-[8px] rounded-ds-card border border-ds-border px-[12px] py-[8px]">
            {s.done
              ? <CheckCircle2 aria-hidden className="h-[18px] w-[18px] shrink-0 text-ds-success" strokeWidth={1.75} />
              : <Circle aria-hidden className="h-[18px] w-[18px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />}
            <span className="min-w-0 flex-1 text-ds-body text-ds-fg">{s.label}<span className="sr-only">{s.done ? ', done' : ', not done'}</span></span>
            {!s.done && (s.key !== 'scope' || canScope) && <Button size="sm" href={s.href}>{s.action}</Button>}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

// ── Breakdowns ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const empty = (text: string) => <p className="m-0 text-ds-body text-ds-fg-muted">{text}</p>;

export function DomainTable({ data }: { data: Overview }) {
  const rows = data.library.by_domain;
  const max = Math.max(1, ...rows.map((d) => d.controls));
  if (rows.length === 0) return empty('No domains in scope.');
  return (
    <TableFrame aria-label="Controls by domain" maxHeight="max-h-[420px]">
      <Table caption="Controls by domain">
        <THead>
          <Tr>
            <Th sticky>Domain</Th>
            <Th sticky align="right">Controls</Th>
            <Th sticky align="right">With checks</Th>
            <Th sticky align="right">With evidence</Th>
            <Th sticky align="right">Implemented</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((d) => (
            <Tr key={d.domain}>
              <Td>
                <TitleLink href={explorerHref({ domain: d.domain })} title={d.domain} lines={2} tone="title" size="body" />
              </Td>
              <Td align="right"><span className="inline-flex items-center justify-end gap-[8px] whitespace-nowrap tabular-nums text-ds-body text-ds-fg-body"><span aria-hidden className="hidden h-[6px] w-[48px] overflow-hidden rounded-full bg-ds-surface-hover sm:inline-block"><span className="block h-full bg-ds-fg-muted" style={{ width: `${(d.controls / max) * 100}%` }} /></span>{formatCount(d.controls)}</span></Td>
              <Td align="right"><span className="whitespace-nowrap tabular-nums text-ds-body text-ds-fg-body">{d.with_checks ? `${formatCount(d.with_checks)} · ${pct(d.with_checks, d.controls)}%` : '—'}</span></Td>
              <Td align="right"><span className="whitespace-nowrap tabular-nums text-ds-body text-ds-fg-body">{d.with_evidence ? `${formatCount(d.with_evidence)} · ${pct(d.with_evidence, d.controls)}%` : '—'}</span></Td>
              <Td align="right"><span className="whitespace-nowrap tabular-nums text-ds-body text-ds-fg-body">{d.tracked ? `${formatCount(d.implemented)} of ${formatCount(d.tracked)}` : '—'}</span></Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}

export function FrameworkList({ data }: { data: Overview }) {
  const bars = frameworkBars(data.frameworks);
  if (bars.length === 0) return empty('No frameworks in scope.');
  return (
    <>
      <ul className="m-0 list-none p-0">
        {bars.map((f) => (
          <li key={f.key} className="border-b border-ds-border py-[6px] last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-[12px]">
              <TitleLink href={`/automation/soc2-controls?fw=${encodeURIComponent(f.key)}`} title={f.label} lines={1} tone="title" size="body" />
              <span className="text-ds-label tabular-nums text-ds-fg-muted">{`${formatCount(f.requirements)} of ${formatCount(f.total)} requirements · ${formatCount(f.controls)} controls`}</span>
            </div>
            <StatusBar className="mt-[4px]" label={f.label} total={100} parts={[
              { key: 'mapped', label: 'mapped to a control', value: f.mappedPct, tone: 'success' },
              { key: 'accounted', label: 'accounted for, not mappable', value: f.accountedPct, tone: 'neutral' },
            ]} />
          </li>
        ))}
      </ul>
      <p className="mb-0 mt-[8px] text-ds-label text-ds-fg-muted">Green is mapped to a control. Grey is accounted for but cannot be mapped: it binds the regulator or falls outside the catalogue.</p>
    </>
  );
}

export function SourcesList({ data, canConnect }: { data: Overview; canConnect: boolean }) {
  const cats = rankedCategories(data.connector_categories ?? []);
  const watch = collectorsToWatch(data.collection.connectors);
  const counts = data.collection.counts;
  return (
    <>
      <p className="m-0 text-ds-body text-ds-fg-muted">
        {`${formatCount(counts.healthy || 0)} healthy · ${formatCount(counts.stale || 0)} stale · ${formatCount(counts.failing || 0)} failing`}
        {` (stale after ${data.collection.stale_after_days} days)`}
      </p>
      {watch.length > 0 && (
        <ul className="m-0 mt-[8px] list-none p-0">
          {watch.map((c) => (
            <li key={c.plugin_key} className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] border-b border-ds-border py-[6px] last:border-b-0">
              <StatusPill size="sm" {...statusPill(collectionHealth, c.state)} />
              <span className="min-w-0 flex-1 text-ds-body font-[600] text-ds-fg">{c.provider || c.title || 'A source'}</span>
              <span className="text-ds-label text-ds-fg-muted">{c.days_since_success != null ? `collected ${c.days_since_success} d ago` : 'never collected'}</span>
              <span className="text-ds-label tabular-nums text-ds-fg-muted">{`${formatCount(c.controls_affected)} ${c.controls_affected === 1 ? 'control' : 'controls'}`}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="m-0 mt-[12px] !text-ds-label !font-[600] !text-ds-fg-muted">Connect any one source in a category</h3>
      <ul className="m-0 list-none p-0">
        {cats.slice(0, 6).map((c) => (
          <li key={c.category} className="flex flex-wrap items-center gap-x-[8px] border-b border-ds-border py-[6px] last:border-b-0">
            <span className="min-w-0 flex-1 text-ds-body text-ds-fg">{CATEGORY_LABEL[c.category] || c.category}</span>
            <span className="text-ds-label text-ds-fg-muted">
              {c.connected ? `via ${c.connected_providers.map((p) => p.label).join(', ')}` : c.controls_waiting > 0 ? `${formatCount(c.controls_waiting)} controls waiting` : 'nothing waiting'}
            </span>
          </li>
        ))}
      </ul>
      {cats.length > 6 && <p className="mb-0 mt-[4px] text-ds-label text-ds-fg-muted">{`${cats.length - 6} more categories on the Connections page`}</p>}
      {canConnect && <div className="mt-[8px]"><Button href="/admin/evidence-collectors">Open Connections</Button></div>}
    </>
  );
}

export function EvidenceFacts({ data }: { data: Overview }) {
  const ev = data.evidence;
  const total = ev.artifacts;
  const m = ev.by_method;
  return (
    <>
      <StatusBar label="Artifacts by how they are collected" total={total} parts={[
        { key: 'manual', label: 'manual', value: m.manual || 0, tone: 'neutral' },
        { key: 'hybrid', label: 'hybrid', value: m.hybrid || 0, tone: 'progress' },
        { key: 'automated', label: 'automated', value: m.automated || 0, tone: 'success' },
      ]} />
      <FactList className="mt-[8px]" min={110}>
        <Fact label="Controls with an evidence set">{formatCount(ev.controls_with_set)}</Fact>
        <Fact label="Artifacts asked for">{formatCount(total)}</Fact>
        <Fact label="Manual">{formatCount(m.manual || 0)}</Fact>
        <Fact label="Hybrid">{formatCount(m.hybrid || 0)}</Fact>
        <Fact label="Automated">{formatCount(m.automated || 0)}</Fact>
      </FactList>
      {ev.top_owners.length > 0 && (
        <>
          <h3 className="m-0 mt-[12px] !text-ds-label !font-[600] !text-ds-fg-muted">Who the frameworks name as owner</h3>
          <ul className="m-0 list-none p-0">
            {ev.top_owners.map((o) => <CountRow key={o.owner} label={o.owner} count={o.artifacts} />)}
          </ul>
        </>
      )}
    </>
  );
}

export function ImplementationFacts({ data }: { data: Overview }) {
  const a = data.assurance;
  if (a.tracked === 0) {
    return (
      <>
        {empty('No control has been taken up for testing yet. These figures count the controls someone has started to test or assign, not the ones that are implemented.')}
        <div className="mt-[8px]"><Button href="/automation/soc2-controls">Open the controls</Button></div>
      </>
    );
  }
  return (
    <>
      <FactList min={110}>
        <Fact label="Tracked for testing">{formatCount(a.tracked)}</Fact>
        <Fact label="Assigned">{`${formatCount(a.assigned)} · ${pct(a.assigned, a.tracked)}%`}</Fact>
        <Fact label="Implemented">{`${formatCount(a.implemented)} · ${pct(a.implemented, a.tracked)}%`}</Fact>
        <Fact label="Tested">{`${formatCount(a.tested)} · ${pct(a.tested, a.tracked)}%`}</Fact>
      </FactList>
      <StatusBar className="mt-[8px]" label="Tested controls by result" total={a.tested} parts={[
        { key: 'effective', label: 'effective', value: a.effective, tone: 'success' },
        { key: 'partial', label: 'partially effective', value: a.partially_effective, tone: 'warning' },
        { key: 'ineffective', label: 'ineffective', value: a.ineffective, tone: 'danger' },
      ]} />
      <ul className="m-0 mt-[8px] list-none p-0">
        {a.overdue > 0 && <CountRow label="Overdue for a test" count={a.overdue} href={explorerHref({ quick: 'overdue' })} tone="warning" />}
        {a.evidence_pending > 0 && <CountRow label="Evidence items waiting for review" count={a.evidence_pending} tone="progress" />}
      </ul>
    </>
  );
}

export function CrosswalkFacts({ data }: { data: Overview }) {
  const xw = data.crosswalk;
  const inferred = data.frameworks.filter((f) => f.inferred > 0).sort((a, b) => b.inferred_pct - a.inferred_pct).slice(0, 4);
  return (
    <>
      <FactList min={90}>
        <Fact label="Exact">{formatCount(xw.by_match_mode.exact || 0)}</Fact>
        <Fact label="Parent">{formatCount(xw.by_match_mode.parent || 0)}</Fact>
        <Fact label="Child">{formatCount(xw.by_match_mode.child || 0)}</Fact>
      </FactList>
      <p className="mb-0 mt-[8px] text-ds-body text-ds-fg-muted">{`${formatCount(xw.reviewed)} of ${formatCount(xw.rows)} mappings have a reviewer’s decision.`}</p>
      {inferred.length > 0 && (
        <>
          <h3 className="m-0 mt-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">Inferred rather than matched</h3>
          <ul className="m-0 list-none p-0">
            {inferred.map((f) => (
              <li key={f.key} className="flex flex-wrap items-center gap-x-[8px] py-[2px] text-ds-body text-ds-fg-body">
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
                <span className="text-ds-label tabular-nums text-ds-fg-muted">{`${f.inferred_pct}% of ${formatCount(f.requirements)}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-[8px]"><Button href="/automation/soc2-controls/review">Review mappings</Button></div>
    </>
  );
}

export function TrendTable({ data, scoped }: { data: Overview; scoped: boolean }) {
  if (data.trend.length < 2) return empty('There is not enough history yet: one snapshot is written a day.');
  const { shown, hidden } = latestTrend(data.trend, 8);
  return (
    <>
      <TableFrame aria-label="Snapshots over time">
        <Table caption="Snapshots over time">
          <THead>
            <Tr><Th>Date</Th><Th align="right">Assigned</Th><Th align="right">Tested</Th><Th align="right">Effective</Th><Th align="right">Overdue</Th></Tr>
          </THead>
          <TBody>
            {shown.map((t) => (
              <Tr key={t.date}>
                <Td><span className="text-ds-body text-ds-fg-body">{formatDate(t.date, { calendar: true })}</span></Td>
                {[t.assigned, t.tested, t.effective, t.overdue].map((v, i) => <Td key={i} align="right"><span className="tabular-nums text-ds-body text-ds-fg-body">{formatCount(v)}</span></Td>)}
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableFrame>
      <p className="mb-0 mt-[8px] text-ds-label text-ds-fg-muted">
        {hidden > 0 ? `The latest ${shown.length} of ${data.trend.length} snapshots.` : `${data.trend.length} snapshots.`}
        {scoped ? ' These count every tracked control, not only the ones in scope.' : ''}
      </p>
    </>
  );
}

export function Orphans({ data }: { data: Overview }) {
  const n = data.library.orphans;
  if (!n) return null;
  const scoped = (data.scope?.frameworks ?? []).length > 0;
  return (
    <p className="m-0 text-ds-label text-ds-fg-muted">
      {scoped
        ? `${formatCount(n)} of ${formatCount(data.library.controls)} controls in scope map to none of your frameworks. They apply through your profile answers (security level, facilities, personal data).`
        : `${formatCount(n)} of ${formatCount(data.library.controls)} controls map to none of the frameworks in this crosswalk.`}
    </p>
  );
}

