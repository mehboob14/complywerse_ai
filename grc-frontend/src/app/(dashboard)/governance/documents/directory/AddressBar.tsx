'use client';

// The address bar, as Explorer has it: Back, Forward and Up buttons, then where you are as a path of folders from the Organisation (each one a button that goes there). Back and
// Forward are the browser's history of the folders this page went through (a button is off where there is nowhere to go; the first Back from the first folder visited does not leave
// the Directory); Up is the folder above. On a phone it is the way back up the drill-down, so it wraps instead of scrolling sideways and each part is at least a touch target tall.
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight } from 'lucide-react';
import { FolderIcon } from './folderIcon';
import { ORGANISATION, type DirectoryTree } from './directoryModel';

const CRUMB = 'inline-flex min-h-[28px] max-w-[220px] items-center truncate rounded-ds-control px-[6px] text-ds-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:min-h-[44px]';
const STEP = 'grid h-[28px] w-[28px] shrink-0 place-items-center rounded-ds-control text-ds-fg-body enabled:hover:bg-ds-surface-hover enabled:hover:text-ds-fg disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]';

interface Props {
  tree: DirectoryTree;
  current: number | null;
  onGo: (id: number | null) => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
}

export function AddressBar({ tree, current, onGo, canBack, canForward, onBack, onForward, onUp }: Props) {
  const path = tree.path(current);
  return (
    <nav aria-label="Location" className="flex min-w-0 items-center gap-[4px] rounded-ds-control border border-ds-border-control bg-ds-surface px-[4px] py-[2px]">
      <button type="button" aria-label="Back" title="Back (Alt+Left)" disabled={!canBack} onClick={onBack} className={STEP}>
        <ArrowLeft aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
      </button>
      <button type="button" aria-label="Forward" title="Forward (Alt+Right)" disabled={!canForward} onClick={onForward} className={STEP}>
        <ArrowRight aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
      </button>
      <button type="button" aria-label="Up one level" title="Up one level (Alt+Up)" disabled={current === null} onClick={onUp} className={STEP}>
        <ArrowUp aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
      </button>
      <span aria-hidden className="mx-[2px] h-[18px] w-px shrink-0 bg-ds-border" />
      <FolderIcon size={20} open className="ml-[2px] shrink-0" />
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
