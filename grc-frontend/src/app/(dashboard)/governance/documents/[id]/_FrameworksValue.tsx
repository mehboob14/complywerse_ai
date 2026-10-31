'use client';

// The read-only Frameworks value of the Details dialog: the first two as chips and "+N" for the rest, as the library cuts them (libraryModel.frameworkDisplay,
// the same rule as its table cell), so 2 or 40 frameworks make the same short line. "+N" opens the whole list, A to Z, right under the chips (not a floating
// card: a card drawn outside the dialog would be outside its focus trap), with a search box once it is long (FRAMEWORK_SEARCH_FROM, as the library's list).
import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/ds';
import { FRAMEWORK_SEARCH_FROM, frameworkDisplay, frameworkList, type FrameworkInfo } from '../_workspace/libraryModel';

const CHIP = 'inline-flex h-[24px] min-w-0 max-w-[14rem] items-center rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] text-ds-label text-ds-fg-body';

export function FrameworksValue({ ids, info }: { ids: readonly number[]; info: Record<string, FrameworkInfo> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const searchId = useId();
  const { chips, hidden, total } = frameworkDisplay(ids, info, { max: 2 });
  if (total === 0) return null;
  const rows = frameworkList(ids, info, query);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-[6px]">
        {chips.map((c) => <span key={c.id} className={CHIP} title={c.name}><span className="truncate">{c.label}</span></span>)}
        {hidden.length > 0 && (
          <Button size="sm" aria-expanded={open} aria-controls={listId} aria-label={open ? `Hide the ${total} frameworks` : `Show all ${total} frameworks`} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : `+${hidden.length}`}
          </Button>
        )}
      </div>
      {open && (
        <div id={listId} className="mt-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[8px]">
          {total > FRAMEWORK_SEARCH_FROM && (
            <div className="relative mb-[8px]">
              <label htmlFor={searchId} className="sr-only">Search the {total} frameworks</label>
              <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute left-[10px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-ds-fg-muted" />
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${total} frameworks`}
                className="block h-ds-control w-full rounded-ds-control border border-ds-border-control bg-ds-surface pl-[32px] pr-[12px] text-ds-body text-ds-fg placeholder:text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring"
              />
            </div>
          )}
          <ul aria-label={`${total} frameworks`} className="max-h-[220px] space-y-[2px] overflow-y-auto">
            {rows.map((c) => (
              <li key={c.id} className="flex min-w-0 items-baseline gap-[8px] px-[4px] py-[2px] text-ds-body text-ds-fg-body">
                {c.known && c.name !== c.label && <span className="shrink-0 text-ds-label text-ds-fg-muted">{c.label}</span>}
                <span className="min-w-0 break-words">{c.name}</span>
              </li>
            ))}
            {rows.length === 0 && <li className="px-[4px] py-[6px] text-ds-body text-ds-fg-muted">No framework matches “{query}”.</li>}
          </ul>
          {query && rows.length > 0 && <p className="mt-[4px] px-[4px] text-ds-label text-ds-fg-muted">{rows.length} of {total}</p>}
        </div>
      )}
    </div>
  );
}
