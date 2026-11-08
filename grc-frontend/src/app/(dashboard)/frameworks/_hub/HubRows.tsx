'use client';

/**
 * The rows of the hub's lists, as configuration for records/RecordTable: the columns of each register, the card a narrow room gets, the row's menu and the board's card.
 * Journeys: the journey (its name is a link that opens it), its status, how ready and how implemented it is (the journey function's figures, a word beside the colour), and its target
 * date with how late or near it is. Library: the framework, its state in words (with where its onboarding is), who stands behind it, how far a journey has got, and ONE button for
 * the next step the gate allows. Nothing appears only on hover; a figure that was not recorded is a dash, never 0; what a cell says is decided in hubModel.ts.
 */
import Link from 'next/link';
import { Eye, ListChecks, Play, Sparkles, Trash2 } from 'lucide-react';
import { Button, Menu, ProgressBar, StatusPill, type MenuItem } from '@/components/ui/ds';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, formatCount, formatDate, formatPercent, truncate } from '@/lib/format';
import { readinessBand } from '@/lib/journeyModel';
import { statusPill } from '@/lib/status';
import { frameworkState, targetWords } from '@/lib/statuses/frameworkHub';
import { readinessBandWords } from '@/lib/statuses/frameworkJourney';
import type { ProgressTone } from '@/components/ui/ds';
import { canStartAnother, dueText, journeyHref, kindLabel, nextStep, typeLabel, type HubRow, type Scope } from './hubModel';
import { ONBOARD_REASON, type HubActions } from './useHubActions';
import { libraryOpenHref } from './hubAddress';
import { versionLabel } from './overviewModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const LINK = 'scroll-mt-[44px] rounded-ds-control py-[1px] font-[500] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none';
const BAND_TONE: Record<string, ProgressTone> = { strong: 'success', building: 'primary', early: 'warning', start: 'primary' };

/** The columns give way in this order when the list is narrow: Status first (the quick views and the rail say it), then Implemented, then the target date; Ready stays longest. */
export const JOURNEY_FIT: Record<'status' | 'ready' | 'implemented' | 'target', Omit<FitColumn, 'key'>> = {
  status: { px: 120, dropRank: 1 },
  ready: { px: 150, dropRank: 4 },
  implemented: { px: 112, dropRank: 2 },
  target: { px: 172, dropRank: 3 },
};
export const LIBRARY_FIT: Record<'state' | 'authority' | 'ready' | 'next', Omit<FitColumn, 'key'>> = {
  state: { px: 176 },
  authority: { px: 176, dropRank: 2 },
  ready: { px: 160, dropRank: 1 },
  next: { px: 184 },
};

export interface RowEnv {
  scope: Scope;
  /** the library was read: a journey whose framework is not in it says so; while it is unread (or failed) nothing is said */
  libraryKnown: boolean;
  /** a row was pressed: a journey opens, a framework opens its details */
  onOpen: (row: HubRow) => void;
  /** a menu item that leaves the page */
  go: (href: string) => void;
  actions: HubActions;
}

const dash = (what: string) => <span className="text-ds-body text-ds-fg-muted"><span aria-hidden>{EMPTY}</span><span className="sr-only">{`${what}: not recorded`}</span></span>;

/** "ISO · v2022 · 93 requirements": what the framework is, under its name. */
function Facts({ row, libraryKnown = true }: { row: HubRow; libraryKnown?: boolean }) {
  if (!row.inLibrary) return libraryKnown ? <p className="m-0 truncate text-ds-label text-ds-fg-muted">Not in the library any more</p> : null;
  const parts = [typeLabel(row.typeKey), versionLabel(row.version), row.requirements != null ? `${formatCount(row.requirements)} ${row.requirements === 1 ? 'requirement' : 'requirements'}` : null].filter(Boolean).join(' · ');
  return <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={parts}>{parts}</p>;
}

function Title({ row, env }: { row: HubRow; env: RowEnv }) {
  const journeys = env.scope === 'journeys';
  return (
    <div className="min-w-0">
      <div dir="auto" className="line-clamp-2 min-w-0 text-ds-body [overflow-wrap:anywhere]">
        {journeys ? (
          <Link href={journeyHref(row.id)} prefetch={false} title={row.name} onClick={(e) => e.stopPropagation()} className={LINK}>{row.name}</Link>
        ) : (
          <Link
            href={libraryOpenHref(row.id)}
            prefetch={false}
            title={row.name}
            onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onOpen(row); } }}
            className={LINK}
          >
            {row.name}
          </Link>
        )}
      </div>
      <Facts row={row} libraryKnown={env.libraryKnown} />
    </div>
  );
}

export function StateCell({ row, note = true }: { row: HubRow; note?: boolean }) {
  return (
    <div className="min-w-0">
      <StatusPill size="sm" {...statusPill(frameworkState, row.state)} />
      {note && row.stateNote && <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{row.stateNote}</span>}
    </div>
  );
}

export function ReadyCell({ row }: { row: HubRow }) {
  const n = row.numbers;
  if (!n) return dash('Ready');
  const band = readinessBand(n.readyPct);
  return (
    <div className="min-w-0">
      <ProgressBar value={n.readyPct} label={`${row.name}: ready`} tone={BAND_TONE[band]} />
      <span className="block text-ds-label text-ds-fg-muted">{readinessBandWords.label(band)}</span>
    </div>
  );
}

function ImplementedCell({ row }: { row: HubRow }) {
  const n = row.numbers;
  if (!n) return dash('Implemented');
  return (
    <div className="min-w-0 whitespace-nowrap">
      <span className="text-ds-body tabular-nums text-ds-fg">{formatPercent(n.implementedPct)}</span>
      <span className="block text-ds-label text-ds-fg-muted">{`${formatCount(n.implemented)} of ${formatCount(n.applicable)}`}</span>
    </div>
  );
}

function TargetCell({ row }: { row: HubRow }) {
  const t = row.target;
  if (!t.day) return <span className="text-ds-body text-ds-fg-muted">{row.journey ? 'Not set' : EMPTY}</span>;
  const due = dueText(t);
  return (
    <div className="min-w-0">
      <span className="text-ds-body text-ds-fg">{formatDate(t.day, { calendar: true })}</span>
      {due && <span className="mt-[2px] block"><StatusPill size="sm" {...statusPill(targetWords, t.state)} label={due} /></span>}
    </div>
  );
}

function AuthorityCell({ row }: { row: HubRow }) {
  return (
    <div className="min-w-0">
      <p className="m-0 truncate text-ds-body text-ds-fg" title={row.authority ?? undefined}>{row.authority ?? <span className="text-ds-fg-muted">{EMPTY}</span>}</p>
      <p className="m-0 truncate text-ds-label text-ds-fg-muted">{kindLabel(row.kind)}</p>
    </div>
  );
}

/** The one button a Library row offers; the words are the gate's: start the onboarding, continue it, open it, start the journey, open the journey. */
export function NextButton({ row, env, size = 'sm' }: { row: HubRow; env: RowEnv; size?: 'sm' | 'md' }) {
  const step = nextStep(row);
  if (!step) return null;
  const label = `${step.label}: ${row.name}`;
  if (step.kind === 'open') return <Button size={size} href={step.href} aria-label={label}>{step.label}</Button>;
  if (step.kind === 'start') {
    return (
      <Button size={size} variant="primary" leftIcon={<Play aria-hidden />} aria-label={label} loading={env.actions.starting === step.frameworkId} onClick={() => env.actions.start(row)}>{step.label}</Button>
    );
  }
  // only starting the journey is the primary button: thirty rows of "Start onboarding" would be thirty of them
  return step.href
    ? <Button size={size} href={step.href} aria-label={label}>{step.label}</Button>
    : (
      <Button
        size={size} aria-label={label} loading={env.actions.startingOnboarding === step.frameworkId} disabled={!env.actions.canOnboard}
        title={env.actions.canOnboard ? undefined : ONBOARD_REASON} onClick={() => env.actions.startOnboarding(row)}
      >
        {step.label}
      </Button>
    );
}

export function hubColumns(env: RowEnv): RecordColumn<HubRow>[] {
  if (env.scope === 'journeys') {
    return [
      { key: 'name', header: 'Journey', sortKey: 'name', cell: (row) => <Title row={row.record} env={env} /> },
      { key: 'status', header: 'Status', fit: JOURNEY_FIT.status, cell: (row) => <StateCell row={row.record} /> },
      { key: 'ready', header: 'Ready', sortKey: 'ready', fit: JOURNEY_FIT.ready, cell: (row) => <ReadyCell row={row.record} /> },
      { key: 'implemented', header: 'Implemented', sortKey: 'implemented', fit: JOURNEY_FIT.implemented, cell: (row) => <ImplementedCell row={row.record} /> },
      { key: 'target', header: 'Target date', sortKey: 'target', fit: JOURNEY_FIT.target, cell: (row) => <TargetCell row={row.record} /> },
    ];
  }
  return [
    { key: 'name', header: 'Framework', sortKey: 'name', cell: (row) => <Title row={row.record} env={env} /> },
    { key: 'state', header: 'State', sortKey: 'state', fit: LIBRARY_FIT.state, cell: (row) => <StateCell row={row.record} /> },
    { key: 'authority', header: 'Authority', sortKey: 'authority', fit: LIBRARY_FIT.authority, cell: (row) => <AuthorityCell row={row.record} /> },
    { key: 'ready', header: 'Ready', fit: LIBRARY_FIT.ready, cell: (row) => <ReadyCell row={row.record} /> },
    { key: 'next', header: 'Next step', fit: LIBRARY_FIT.next, cell: (row) => <NextButton row={row.record} env={env} /> },
  ];
}

/** The card a row is where the list has no room for a table. */
export function HubCard({ row, scope, libraryKnown = true }: { row: RecordRow<HubRow>; scope: Scope; libraryKnown?: boolean }) {
  const r = row.record;
  const due = dueText(r.target);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.name} className="line-clamp-2 text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.name}</span>
      <Facts row={r} libraryKnown={libraryKnown} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusPill size="sm" {...statusPill(frameworkState, r.state)} />
        {r.numbers && <span className="text-ds-label text-ds-fg-body">{`Ready ${formatPercent(r.numbers.readyPct)}`}</span>}
        {due && <StatusPill size="sm" {...statusPill(targetWords, r.target.state)} label={due} />}
      </span>
      {scope === 'library' && r.stateNote && <span className="text-ds-label text-ds-fg-muted">{r.stateNote}</span>}
    </div>
  );
}

/** The board's card: the name, where it stands, and the one number that matters on a board. */
export function BoardCard({ row }: { row: HubRow }) {
  const due = dueText(row.target);
  return (
    <>
      <span dir="auto" className="line-clamp-2 text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{row.name}</span>
      <span className="truncate text-ds-label text-ds-fg-muted">{row.authority ?? kindLabel(row.kind)}</span>
      {row.numbers ? <span className="text-ds-label text-ds-fg-body">{`Ready ${formatPercent(row.numbers.readyPct)}`}</span> : row.stateNote && <span className="text-ds-label text-ds-fg-body">{row.stateNote}</span>}
      {due && <StatusPill size="sm" {...statusPill(targetWords, row.target.state)} label={due} />}
    </>
  );
}

export function rowActions(row: HubRow, env: RowEnv): MenuItem[] {
  const a = env.actions;
  const items: MenuItem[] = [];
  const step = nextStep(row);
  if (env.scope === 'journeys') {
    items.push({ key: 'open', label: 'Open journey', icon: ListChecks, onSelect: () => env.go(journeyHref(row.id)) });
    if (a.canDelete) items.push({ key: 'delete-journey', label: 'Delete journey', icon: Trash2, danger: true, onSelect: () => a.removeJourney(row) });
    return items;
  }
  if (step) {
    items.push({
      key: 'next', label: step.label, icon: step.kind === 'start' ? Play : ListChecks,
      disabled: step.kind === 'onboarding' && !step.href && !a.canOnboard, reason: step.kind === 'onboarding' && !step.href && !a.canOnboard ? ONBOARD_REASON : undefined,
      onSelect: () => {
        if (step.kind === 'start') a.start(row);
        else if (step.kind === 'open' || step.href) env.go(step.href as string);
        else a.startOnboarding(row);
      },
    });
  }
  items.push({ key: 'details', label: 'Show details', icon: Eye, onSelect: () => env.onOpen(row) });
  if (row.frameworkId != null) items.push({ key: 'requirements', label: 'View requirements', icon: ListChecks, onSelect: () => env.go(`/controls?framework=${row.frameworkId}`) });
  if (canStartAnother(row) && step?.kind === 'open') items.push({ key: 'again', label: 'Start a new journey', icon: Play, onSelect: () => a.start(row) });
  items.push({ key: 'enhance', label: 'Generate evidence recommendations', icon: Sparkles, onSelect: () => a.enhance(row), disabled: a.enhancing === row.frameworkId });
  if (a.canDelete && !row.shared) items.push({ key: 'delete-framework', label: 'Delete framework', icon: Trash2, danger: true, onSelect: () => a.removeFramework(row) });
  return items;
}

export function RowMenu({ row, env }: { row: HubRow; env: RowEnv }) {
  return <Menu label={`Actions for ${truncate(row.name, 60).text}`} iconOnly items={rowActions(row, env)} />;
}
