'use client';

// The floating bar of a record explorer: what is ticked, "Select all 1,247" while more match than are ticked, the actions (labelled buttons; icon only in a phone-sized room, the words
// stay for a screen reader), a "More" menu for the rest, and a way to clear the ticks. It appears while something is ticked and takes no focus. It holds the choices the page
// configures, and runs nothing itself: every action is the page's own (with its confirmation and its report).
// It floats at the foot of the page's own scroll (sticky to the bottom of the explorer), not of the window: under the application shell the window has a rail on its left and a panel on
// its right, and a bar fixed to the window's edge would be drawn over them.
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, IconButton, Menu, type MenuItem } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { canSelectAll, selectedLabel } from './explorerModel';

export interface BulkActionDef {
  id: string;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  /** shown, cannot be pressed; `reason` says why */
  disabled?: boolean;
  reason?: string;
  onRun: () => void;
}

export interface BulkBarProps {
  /** how many are ticked */
  count: number;
  /** how many match the filters (the number "Select all" would tick) */
  matching: number;
  onSelectAll: () => void;
  onClear: () => void;
  actions: BulkActionDef[];
  /** the rest of the actions, in a menu */
  more?: MenuItem[];
  label?: string;
  /** the explorer's room is phone-sized: the buttons keep their icons only */
  iconsOnly?: boolean;
}

export function BulkBar({ count, matching, onSelectAll, onClear, actions, more = [], label = 'Bulk actions', iconsOnly = false }: BulkBarProps) {
  if (count <= 0) return null;
  const rest = more.filter((m) => !m.hidden);
  return (
    <div className="pointer-events-none sticky bottom-[12px] z-[40] flex justify-center">
      <div role="region" aria-label={label} className="pointer-events-auto flex max-w-full flex-wrap items-center gap-[8px] rounded-ds-card border border-ds-primary bg-ds-surface px-[10px] py-[6px] shadow-ds-pop">
        <span role="status" className="px-[4px] text-ds-body font-[600] tabular-nums text-ds-fg">{selectedLabel(count)}</span>
        {canSelectAll(count, matching) && (
          <Button variant="link" size="sm" onClick={onSelectAll}>{`Select all ${formatCount(matching)}`}</Button>
        )}
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Button
              key={a.id}
              variant={a.danger ? 'dangerOutline' : 'secondary'}
              disabled={a.disabled}
              title={a.disabled && a.reason ? a.reason : a.label}
              leftIcon={<Icon aria-hidden />}
              onClick={a.onRun}
            >
              <span className={iconsOnly ? 'sr-only' : undefined}>{a.label}</span>
              {a.disabled && a.reason && <span className="sr-only">{`, ${a.reason}`}</span>}
            </Button>
          );
        })}
        {rest.length > 0 && <Menu label="More actions" iconOnly items={rest} />}
        <IconButton label="Clear the selection" onClick={onClear}><X aria-hidden /></IconButton>
      </div>
    </div>
  );
}
