'use client';

// "By domain": the controls that pass the filters grouped by domain, each domain with a bar of where its controls stand and the two numbers that ask for someone (failing, no owner). A domain
// is a button: pressing it filters the list to that domain and goes back to the list. The groups are controlsDomains.ts, from the same rows as the list, so the figures here are the ones the list shows.
import { ChevronRight } from 'lucide-react';
import { formatCount } from '@/lib/format';
import type { Tone } from '@/lib/status';
import { domainGroups, type DomainGroup } from './controlsDomains';
import { BOARD_COLUMNS, type BoardId, type Row } from './controlsModel';
import { StatusBar } from './StatusBar';

const TONES: Record<BoardId, Tone> = { failing: 'danger', attention: 'warning', passing: 'success', waiting: 'neutral', manual: 'neutral' };

export function DomainRow({ g, onPick }: { g: DomainGroup; onPick: (key: string) => void }) {
  return (
    <li className="border-t border-ds-border first:border-t-0">
      <button
        type="button"
        onClick={() => onPick(g.key)}
        className="flex min-h-[56px] w-full min-w-0 flex-wrap items-center gap-x-[16px] gap-y-[6px] px-[12px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]"
      >
        <span className="min-w-[160px] flex-[1_1_220px]">
          <span className="block truncate text-ds-body font-[600] text-ds-fg" title={g.label}>{g.label}</span>
          <span className="text-ds-label text-ds-fg-muted">{`${formatCount(g.total)} ${g.total === 1 ? 'control' : 'controls'}`}</span>
        </span>
        <span className="min-w-[120px] flex-[2_1_200px]">
          <StatusBar label={g.label} total={g.total} parts={BOARD_COLUMNS.map((c) => ({ key: c.id, label: c.label, value: g.columns[c.id], tone: TONES[c.id] }))} />
        </span>
        <span className="flex min-w-[150px] flex-wrap items-center gap-x-[12px] text-ds-label tabular-nums">
          <span className={g.columns.failing > 0 ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}>{`${formatCount(g.columns.failing)} failing`}</span>
          <span className={g.unowned > 0 ? 'text-ds-fg-body' : 'text-ds-fg-muted'}>{`${formatCount(g.unowned)} no owner`}</span>
        </span>
        <ChevronRight aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
      </button>
    </li>
  );
}

export function ByDomainView({ rows, onPick }: { rows: readonly Row[]; onPick: (key: string) => void }) {
  const groups = domainGroups(rows);
  return (
    <ul aria-label="Domains" className="m-0 list-none overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
      {groups.map((g) => <DomainRow key={g.key} g={g} onPick={onPick} />)}
    </ul>
  );
}
