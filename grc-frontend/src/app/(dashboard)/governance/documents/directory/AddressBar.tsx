'use client';

// The address bar: where you are, as a path of units from the organisation (each one a button that goes there), and an Up button for one level. On a phone it is the way
// back up the drill-down, so it wraps instead of scrolling sideways and each part is at least a touch target tall.
import { ArrowUp, ChevronRight } from 'lucide-react';
import { ORGANISATION, type DirectoryTree } from './directoryModel';

const CRUMB = 'inline-flex min-h-[28px] max-w-[220px] items-center truncate rounded-ds-control px-[6px] text-ds-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:min-h-[44px]';

export function AddressBar({ tree, current, onGo }: { tree: DirectoryTree; current: number | null; onGo: (id: number | null) => void }) {
  const path = tree.path(current);
  const up = current === null ? null : tree.parentOf(current);
  return (
    <nav aria-label="Location" className="flex min-w-0 items-center gap-[4px] rounded-ds-control border border-ds-border-control bg-ds-surface px-[4px] py-[2px]">
      <button
        type="button"
        aria-label="Up one level"
        title="Up one level"
        disabled={current === null}
        onClick={() => onGo(up)}
        className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted enabled:hover:bg-ds-surface-hover enabled:hover:text-ds-fg disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]"
      >
        <ArrowUp aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
      </button>
      <ol className="m-0 flex min-w-0 flex-1 list-none flex-wrap items-center p-0">
        <li className="flex items-center">
          {current === null ? <span aria-current="page" className={`${CRUMB} font-[600] text-ds-fg`}>{ORGANISATION}</span> : <button type="button" onClick={() => onGo(null)} className={`${CRUMB} text-ds-fg-body`}>{ORGANISATION}</button>}
        </li>
        {path.map((n, i) => (
          <li key={n.id} className="flex items-center">
            <ChevronRight aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
            {i === path.length - 1
              ? <span aria-current="page" className={`${CRUMB} font-[600] text-ds-fg`}>{n.name}</span>
              : <button type="button" onClick={() => onGo(n.id)} className={`${CRUMB} text-ds-fg-body`}>{n.name}</button>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
