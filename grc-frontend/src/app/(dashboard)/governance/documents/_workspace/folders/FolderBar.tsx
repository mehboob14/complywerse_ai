'use client';

// The folder bar above the Folders layout, one bar: where you are and what you can do with the folder selected (else the one you are in). On the left the way around as Explorer has it: Back,
// Forward and Up, then the path from the Organisation, each folder a button that goes there (Back and Forward are the browser's history of the folders this page went through, a button is off
// where there is nowhere to go; Up is the folder above). On the right the toolbar: New <next level>, Properties, Access, Approvals, Move to…, Deactivate or Activate, and under "More" Edit
// details, Exceptions and Organisation defaults. Which actions there are and why one is off is directoryModel.unitActions: a person who may not change a unit gets only Properties; one that cannot
// be done now stays, disabled, with its reason as its tooltip. Under 640px the bar is Back, Up, the path and one "Actions" menu (the same list as a row's "…" and the right-click menu).
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Landmark } from 'lucide-react';
import { Button, Menu, type MenuItem } from '@/components/ui/ds';
import { FolderIcon } from './folderIcon';
import { ACTION_ICON, menuItems } from './unitMenu';
import { ORGANISATION, type ActionKey, type ActionState } from './directoryModel';
import { splitActions } from './folderBarModel';

const CRUMB = 'inline-flex min-h-[28px] max-w-[220px] items-center truncate rounded-ds-control px-[6px] text-ds-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:min-h-[44px]';
const STEP = 'grid h-[28px] w-[28px] shrink-0 place-items-center rounded-ds-control text-ds-fg-body enabled:hover:bg-ds-surface-hover enabled:hover:text-ds-fg disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-ds-ring [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]';

interface Props {
  path: readonly { id: number; name: string }[];
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  /** a path segment was pressed (null: the Organisation) */
  onGo: (id: number | null) => void;
  /** what can be done with the folder the toolbar acts on (directoryModel.unitActions); empty while the units are being read */
  actions: readonly ActionState[];
  /** that folder's name, for the toolbar's name and the buttons' tooltips ("" for the organisation) */
  targetName: string;
  busy: boolean;
  onRun: (key: ActionKey) => void;
  /** opens the Organisation popup (the defaults every unit inherits); absent for a person who may not write them */
  onOrganisation?: () => void;
}

export function FolderBar({ path, canBack, canForward, canUp, onBack, onForward, onUp, onGo, actions, targetName, busy, onRun, onOrganisation }: Props) {
  const { buttons, more } = splitActions(actions);
  const here = path.length > 0 ? path[path.length - 1].name : ORGANISATION;
  const moreItems: MenuItem[] = [
    ...menuItems(more, onRun),
    ...(onOrganisation ? [{ key: 'organisation', label: 'Organisation defaults', icon: Landmark, onSelect: onOrganisation }] : []),
  ];
  const allItems: MenuItem[] = [...menuItems(buttons.concat(more), onRun), ...(onOrganisation ? [{ key: 'organisation', label: 'Organisation defaults', icon: Landmark, onSelect: onOrganisation }] : [])];
  const target = targetName ? ` · ${targetName}` : '';
  const acting = buttons.length > 0 || moreItems.length > 0;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-[12px] gap-y-[4px] rounded-ds-card border border-ds-border bg-ds-surface px-[6px] py-[3px]">
      <nav aria-label="Location" className="flex min-w-0 flex-1 basis-[260px] items-center gap-[4px]">
        <button type="button" aria-label="Back" title="Back (Alt+Left)" disabled={!canBack} onClick={onBack} className={STEP}>
          <ArrowLeft aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Forward" title="Forward (Alt+Right)" disabled={!canForward} onClick={onForward} className={`${STEP} hidden sm:grid`}>
          <ArrowRight aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
        </button>
        <button type="button" aria-label="Up one level" title="Up one level (Alt+Up)" disabled={!canUp} onClick={onUp} className={STEP}>
          <ArrowUp aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
        </button>
        <span aria-hidden className="mx-[2px] h-[18px] w-px shrink-0 bg-ds-border" />
        <FolderIcon size={20} open className="ml-[2px] shrink-0" />
        <ol className="m-0 flex min-w-0 flex-1 list-none flex-wrap items-center p-0">
          <li className="flex items-center">
            {path.length === 0 ? <span aria-current="page" className={`${CRUMB} font-[600] text-ds-fg`}>{ORGANISATION}</span> : <button type="button" onClick={() => onGo(null)} className={`${CRUMB} text-ds-fg-body`}>{ORGANISATION}</button>}
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
      {acting && (
        <div role="toolbar" aria-label={`Actions for ${targetName || here}`} className="flex flex-wrap items-center gap-[6px]">
          <div className="hidden flex-wrap items-center gap-[6px] sm:flex">
            {buttons.map((a) => {
              const Icon = ACTION_ICON[a.key];
              return (
                <Button key={a.key} size="sm" variant={a.key === 'new' ? 'primary' : 'secondary'} leftIcon={<Icon aria-hidden />} disabled={a.disabled || busy} title={a.reason ?? `${a.label}${target}`} onClick={() => onRun(a.key)}>{a.label}</Button>
              );
            })}
            {moreItems.length > 0 && <Menu label="More" size="sm" items={moreItems} />}
          </div>
          <div className="sm:hidden"><Menu label="Actions" size="sm" items={allItems} /></div>
        </div>
      )}
    </div>
  );
}
