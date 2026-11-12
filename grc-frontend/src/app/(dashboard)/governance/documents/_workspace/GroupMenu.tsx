'use client';

/**
 * The "Group by" control of the Workspace: the kit's Menu with one radio item for each way of grouping (the choice is checked) and the grouping in its label ("Group: Department").
 * It is the page's to place (the toolbar, beside Sort) and to show (the layout that groups: the List); `keys` narrows what it offers. The words are libraryGroups.ts.
 */
import { Menu, type MenuItem } from '@/components/ui/ds';
import { GROUP_LABEL, GROUP_MENU, groupButtonLabel } from './libraryGroups';
import type { GroupKey } from './libraryModel';

export function GroupMenu({ value, onChange, keys = GROUP_MENU, disabled = false, className }: {
  value: GroupKey;
  onChange: (key: GroupKey) => void;
  /** the groupings offered, in the order given */
  keys?: readonly GroupKey[];
  disabled?: boolean;
  /** layout only (margin) */
  className?: string;
}) {
  const items: MenuItem[] = keys.map((k, i) => ({
    key: `group:${k}`, label: GROUP_LABEL[k], checked: value === k, radio: true, section: i === 0 ? 'Group by' : undefined, onSelect: () => onChange(k),
  }));
  return <Menu label={groupButtonLabel(value)} items={items} disabled={disabled} className={className} />;
}
