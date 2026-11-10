'use client';

// "New report": the modules the person may report on, grouped, with the last few they used on top and a search. Choosing one opens the builder on it (the builder no longer starts from an
// empty canvas that asks for the module first). Only modules the person's rights and the organisation's features allow are listed; the list is the platform's dataset registry.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { EmptyState, Sheet, TextInput } from '@/components/ui/ds';
import type { ReportDataset } from '../_reports/types';

const RECENT_KEY = 'grc.reports.recentDatasets';
const RECENT_SHOWN = 5;

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const ROW = 'flex min-h-[44px] w-full flex-col justify-center rounded-ds-control px-[10px] py-[6px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

export function NewReportSheet({ open, onClose, datasets, onPick }: { open: boolean; onClose: () => void; datasets: readonly ReportDataset[]; onPick: (datasetKey: string) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => datasets.filter((d) => !needle || `${d.label} ${d.module} ${d.description ?? ''}`.toLowerCase().includes(needle)),
    [datasets, needle],
  );
  const recent = useMemo(() => (open ? loadRecent() : []).map((k) => datasets.find((d) => d.key === k)).filter((d): d is ReportDataset => !!d).slice(0, RECENT_SHOWN), [open, datasets]);
  const groups = useMemo(() => {
    const byModule = new Map<string, ReportDataset[]>();
    shown.forEach((d) => { byModule.set(d.module, (byModule.get(d.module) ?? []).concat(d)); });
    return Array.from(byModule.entries());
  }, [shown]);

  const choice = (d: ReportDataset, key: string) => (
    <li key={key}>
      <button type="button" onClick={() => onPick(d.key)} className={ROW}>
        <span className="text-ds-body font-[600] text-ds-fg">{d.label}</span>
        {d.description && <span className="line-clamp-2 text-ds-label text-ds-fg-muted">{d.description}</span>}
      </button>
    </li>
  );

  return (
    <Sheet open={open} onClose={() => { setQ(''); onClose(); }} title="New report" subtitle="Choose the module the report reads" width="md">
      <div className="flex flex-col gap-[12px]">
        <TextInput
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search modules"
          placeholder="Search modules"
          autoComplete="off"
          leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />}
        />
        {datasets.length === 0 ? (
          <EmptyState kind="firstUse" bare title="No module to report on" description="Reports read the modules your role can open. Ask an administrator to open one for you." />
        ) : shown.length === 0 ? (
          <EmptyState kind="noMatches" bare title="No module matches" description="Search for another word." onClearFilters={() => setQ('')} />
        ) : (
          <div className="flex flex-col gap-[12px]">
            {!needle && recent.length > 0 && (
              <section aria-label="Recently used">
                <p className="mb-[4px] px-[10px] text-ds-label font-[600] text-ds-fg-muted">Recently used</p>
                <ul className="m-0 flex list-none flex-col p-0">{recent.map((d) => choice(d, `recent:${d.key}`))}</ul>
              </section>
            )}
            {groups.map(([module, list]) => (
              <section key={module} aria-label={module}>
                <p className="mb-[4px] px-[10px] text-ds-label font-[600] text-ds-fg-muted">{module}</p>
                <ul className="m-0 flex list-none flex-col p-0">{list.map((d) => choice(d, d.key))}</ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
