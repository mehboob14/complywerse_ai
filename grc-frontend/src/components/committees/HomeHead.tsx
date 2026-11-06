'use client';

// The top of the Committees home: the row of committee chips (a committee is a FILTER of the home), then either the one-line pulse (all committees) or the health strip
// of the chosen committee. The numbers are the server's (GET /committees/overview rows, GET /committees/{id}); a number nobody recorded says "Not recorded" and, from an
// (i), what is missing. The chips are a toolbar with one tab stop and the arrow keys (the kit's FilterChips); a chip that is on says so with aria-pressed.
import { Pencil, Power, PowerOff, Radio, Settings2, TrendingUp } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, FilterChips, Menu, PersonChip, StatusPill, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { committeeTypeLabel, gradeTone, inactiveNote, isActiveCommittee, type OverviewCommittee } from '@/lib/committees';
import { stripCells, type ChipSpec, type Health, type Pulse } from '@/lib/committeeHome';
import { useLineClamped } from '@/components/ui/ds/useLineClamped';
import { useMediaQuery } from './hooks';
import { CommitteeActivity } from './ui';

/** How many chips the row shows before the rest go to its "+N more" menu (the overview sends the committees most in need of attention first). */
export const CHIPS_SHOWN = 6;

export function ChipsRow({ chips, inactive, showingInactive, onPick, onToggleInactive }: {
  chips: ChipSpec[];
  /** committees the status filter hides */
  inactive: number;
  showingInactive: boolean;
  /** a committee's id, or null for All committees */
  onPick: (id: number | null) => void;
  onToggleInactive: () => void;
}) {
  const narrow = useMediaQuery('(max-width: 639px)');
  const list: FilterChip[] = chips.map((c) => ({
    key: c.key, label: c.label, count: c.count, active: c.active, title: c.title, flag: c.flag, icon: c.live && c.flag?.text != null ? Radio : undefined,
  }));
  // `relative` + a clip: the chips' screen-reader words are absolutely placed, and inside a sideways scroller that is not positioned they escape it (and widen the page on a phone).
  // From 640px the toggle sits at the end of the chips' first line; on a phone it has its own line under the one line of chips.
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-x-[8px] sm:flex-nowrap">
      <div className="relative -mx-[4px] min-w-0 flex-[1_1_100%] overflow-x-clip px-[4px] sm:flex-1">
        <FilterChips
          label="Committee"
          chips={list}
          overflow={narrow ? 'scroll' : 'wrap'}
          maxVisible={narrow ? undefined : CHIPS_SHOWN}
          onToggle={(key) => {
            if (key === 'all') onPick(null);
            else onPick(chips.find((c) => c.key === key)?.active ? null : parseInt(key, 10));
          }}
        />
      </div>
      {(inactive > 0 || showingInactive) && (
        <Button variant="link" size="sm" aria-pressed={showingInactive} onClick={onToggleInactive} className="shrink-0">
          {showingInactive ? 'Hide inactive' : `Show inactive (${formatCount(inactive)})`}
        </Button>
      )}
    </div>
  );
}

// ── all committees: one line ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ITEM = 'inline-flex items-center gap-[6px] whitespace-nowrap text-ds-body text-ds-fg-body';
const SEP = <span aria-hidden className="hidden h-[18px] w-px bg-ds-border sm:block" />;

export function PulseLine({ pulse, onPerformance }: { pulse: Pulse; onPerformance: () => void }) {
  const p = pulse.performance;
  return (
    <div role="group" aria-label="Committees at a glance" className="flex flex-wrap items-center gap-x-[14px] gap-y-[4px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[6px]">
      <span className={ITEM}><b className={pulse.overdue > 0 ? 'text-ds-danger' : 'text-ds-fg'}>{formatCount(pulse.overdue)}</b>overdue {pulse.overdue === 1 ? 'action' : 'actions'}</span>
      {SEP}
      <span className={ITEM}><b className="text-ds-fg">{formatCount(pulse.upcoming)}</b>upcoming {pulse.upcoming === 1 ? 'meeting' : 'meetings'}</span>
      {pulse.live > 0 && (<>{SEP}<span className={ITEM}><span aria-hidden className="h-[8px] w-[8px] rounded-full bg-ds-info" /><b className="text-ds-fg">{formatCount(pulse.live)}</b>in progress</span></>)}
      {SEP}
      <span className={ITEM}>
        Attendance
        {pulse.attendance.value === null
          ? <span className="inline-flex items-center gap-[4px] text-ds-fg-muted">Not recorded<InfoTip text={pulse.attendance.why} label="Why attendance is not recorded" /></span>
          : <b className="text-ds-fg">{pulse.attendance.value}</b>}
      </span>
      {SEP}
      <Button variant="link" size="sm" leftIcon={<TrendingUp aria-hidden />} onClick={onPerformance} title="How the performance score is calculated">
        <span className="inline-flex items-center gap-[6px]">
          Performance
          {p.score === null ? <span className="font-normal text-ds-fg-muted">Not recorded</span> : <b className="text-ds-fg">{Math.round(p.score)}</b>}
        </span>
      </Button>
      {p.score !== null && p.grade && <StatusPill size="sm" tone={gradeTone(p.grade)} label={p.grade.charAt(0).toUpperCase() + p.grade.slice(1)} />}
    </div>
  );
}

// ── one committee: its health ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CELL_TONE = { default: 'text-ds-fg', danger: 'text-ds-danger', success: 'text-ds-success', warning: 'text-ds-warning', muted: 'text-ds-fg-muted' } as const;

export interface StripDetail {
  description?: string | null;
  chair_name?: string | null;
  secretary_name?: string | null;
  meeting_frequency?: string | null;
  charters?: Array<unknown>;
}

const FREQUENCY: Record<string, string> = { weekly: 'Weekly', 'bi-weekly': 'Bi-weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually', ad_hoc: 'Ad hoc' };

export function CommitteeStrip({ row, health, detail, canEdit, canSwitch, busy, onOpen, onEdit, onToggleActive, onSettings }: {
  row: Pick<OverviewCommittee, 'id' | 'name' | 'committee_type' | 'is_active'>;
  health: Health;
  detail: StripDetail | undefined;
  canEdit: boolean;
  /** may deactivate / reactivate (the delete right) */
  canSwitch: boolean;
  busy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onSettings: () => void;
}) {
  const active = isActiveCommittee(row);
  const [nameRef, nameCut] = useLineClamped<HTMLHeadingElement>();          // a very long name is cut at two lines here: the whole of it is the sheet's heading ("Open committee")
  const cells = stripCells(health, { charters: detail?.charters?.length });
  const items: MenuItem[] = [
    { key: 'edit', label: 'Edit committee', icon: Pencil, onSelect: onEdit, hidden: !canEdit },
    { key: 'sla', label: 'SLA by priority', icon: Settings2, onSelect: onSettings },
    active
      ? { key: 'off', label: 'Deactivate committee…', icon: PowerOff, onSelect: onToggleActive, danger: true, hidden: !canSwitch, disabled: busy }
      : { key: 'on', label: 'Reactivate committee', icon: Power, onSelect: onToggleActive, hidden: !canSwitch, disabled: busy },
  ];
  const frequency = detail ? FREQUENCY[detail.meeting_frequency ?? ''] ?? null : null;
  // two rows: who it is and what to do with it, then its seven facts in a grid (the shell leaves 1032px at 1440: a strip in columns wrapped its buttons under its name)
  return (
    <section aria-label={`${row.name} at a glance`} className="rounded-ds-card border border-l-[3px] border-ds-border border-l-ds-primary bg-ds-surface px-[12px] py-[8px]">
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <h2 ref={nameRef} title={nameCut ? row.name : undefined} className="line-clamp-2 min-w-0 max-w-full break-words !text-ds-section !text-ds-fg">{row.name}</h2>
        <StatusPill size="sm" tone="neutral" label={committeeTypeLabel(row.committee_type, 'long')} />
        <CommitteeActivity size="sm" active={active} />
        {frequency && <span className="text-ds-label font-normal text-ds-fg-muted">{frequency}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-[6px]">
          <Button onClick={onOpen}>Open committee</Button>
          <Menu iconOnly label={`More actions for ${row.name}`} items={items} />
        </div>
      </div>
      <dl className="mt-[6px] grid grid-cols-2 gap-x-[16px] gap-y-[8px] sm:grid-cols-4 xl:grid-cols-7">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <dt className="text-ds-label font-normal text-ds-fg-muted">{c.label}</dt>
            <dd className="m-0">
              <span className={`flex items-center gap-[4px] text-ds-body font-[600] ${CELL_TONE[c.tone]}`}>{c.value}{c.why && <InfoTip text={c.why} label={`Why ${c.label.toLowerCase()} is not recorded`} />}</span>
              {c.sub && <span className="block truncate text-ds-label font-normal text-ds-fg-muted" title={c.sub}>{c.sub}</span>}
            </dd>
          </div>
        ))}
        {([['Chair', detail?.chair_name], ['Secretary', detail?.secretary_name]] as const).map(([label, name]) => (
          <div key={label} className="min-w-0">
            <dt className="text-ds-label font-normal text-ds-fg-muted">{label}</dt>
            <dd className="m-0 min-w-0"><PersonChip name={name} size={20} emptyLabel="not set" /></dd>
          </div>
        ))}
      </dl>
      {!active && <p role="note" className="mt-[6px] text-ds-label font-normal text-ds-fg-body">{inactiveNote(canSwitch)}</p>}
    </section>
  );
}
