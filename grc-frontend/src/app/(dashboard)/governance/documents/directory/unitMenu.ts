// The actions of a unit as the kit's menu items: the toolbar's "Actions" menu on a phone, a row's "⋯" and the right-click menu all list the same things, built from what
// directoryModel.unitActions says is allowed (and why not). The model decides; this only gives each action its icon and what it does.
import { ClipboardCheck, FolderInput, FolderOpen, Pencil, Plus, Power, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { MenuItem } from '@/components/ui/ds';
import type { ActionKey, ActionState } from './directoryModel';

export const ACTION_ICON: Record<ActionKey, LucideIcon> = {
  new: Plus, edit: Pencil, move: FolderInput, toggle: Power, access: ShieldCheck, approvals: ClipboardCheck,
};

/** The menu for a unit: `go` (open the unit's own contents) first when it has any, then its actions in the model's order. A hidden action is left out; a disabled one stays
 *  with its reason under it. Deactivating is the destructive step (red, set off by a line). */
export function menuItems(actions: readonly ActionState[], run: (key: ActionKey) => void, go?: { label: string; onSelect: () => void }): MenuItem[] {
  const items: MenuItem[] = actions.filter((a) => !a.hidden).map((a) => ({
    key: a.key, label: a.label, icon: ACTION_ICON[a.key], disabled: a.disabled, reason: a.reason, danger: a.key === 'toggle' && a.label === 'Deactivate', onSelect: () => run(a.key),
  }));
  return go ? [{ key: 'go', label: go.label, icon: FolderOpen, onSelect: go.onSelect }, ...items] : items;
}
