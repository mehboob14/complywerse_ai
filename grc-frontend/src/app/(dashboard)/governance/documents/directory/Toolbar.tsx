'use client';

// The Directory's toolbar: what can be done with the unit you are in (New <next level>, Edit details, Move to…, Deactivate or Activate, and Access and Approvals where
// those tabs exist), then Refresh and the Icons | Details switch. Which actions there are, and why one is off, is directoryModel.unitActions: a person who may not change the
// unit gets none of them (the page says it is view only); one that cannot be done now stays, disabled, with its reason as its tooltip. From 640px the actions are buttons; below
// that they are one "Actions" menu (the same list as a row's "⋯" and the right-click menu) beside the primary New button, so the bar is one line on a phone.
import { Landmark, RefreshCw } from 'lucide-react';
import { Button, Menu, SegmentedControl } from '@/components/ui/ds';
import { ACTION_ICON, menuItems } from './unitMenu';
import type { ActionKey, ActionState } from './directoryModel';

export type ViewId = 'icons' | 'details';
const VIEWS = [{ value: 'icons', label: 'Icons' }, { value: 'details', label: 'Details' }] as const;

interface Props {
  actions: readonly ActionState[];
  busy: boolean;
  onRun: (key: ActionKey) => void;
  view: ViewId;
  onView: (view: ViewId) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** opens the Organisation popup (the defaults every unit inherits); absent for a person who may not write them, or while that popup has no tab */
  onOrganisation?: () => void;
}

export function Toolbar({ actions, busy, onRun, view, onView, onRefresh, refreshing, onOrganisation }: Props) {
  const shown = actions.filter((a) => !a.hidden);
  const primary = shown.find((a) => a.key === 'new');
  const rest = shown.filter((a) => a.key !== 'new');
  const Primary = primary ? ACTION_ICON.new : null;
  return (
    <div role="toolbar" aria-label="Directory actions" className="flex flex-wrap items-center gap-[8px]">
      {primary && Primary && (
        <Button variant="primary" leftIcon={<Primary aria-hidden />} disabled={primary.disabled || busy} title={primary.reason} onClick={() => onRun('new')}>{primary.label}</Button>
      )}
      <div className="hidden flex-wrap items-center gap-[8px] sm:flex">
        {rest.map((a) => {
          const Icon = ACTION_ICON[a.key];
          return <Button key={a.key} leftIcon={<Icon aria-hidden />} disabled={a.disabled || busy} title={a.reason} onClick={() => onRun(a.key)}>{a.label}</Button>;
        })}
      </div>
      <div className="sm:hidden">
        <Menu label="Actions" items={[...menuItems(rest, onRun), ...(onOrganisation ? [{ key: 'organisation', label: 'Organisation defaults', icon: Landmark, onSelect: onOrganisation }] : [])]} />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-[8px]">
        {onOrganisation && <div className="hidden sm:block"><Button leftIcon={<Landmark aria-hidden />} onClick={onOrganisation}>Organisation defaults</Button></div>}
        <Button leftIcon={<RefreshCw aria-hidden />} loading={refreshing} onClick={onRefresh}>Refresh</Button>
        <SegmentedControl label="View" name="directory-view" options={VIEWS} value={view} onChange={onView} />
      </div>
    </div>
  );
}
