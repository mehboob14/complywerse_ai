// The actions of a folder as the kit's menu items: the folder bar's "Actions" menu on a phone, a row's "…" and the right-click menu all list the same things, built from what
// directoryModel.unitActions says is allowed (and why not). The model decides; this only gives each action its icon and what it does.
import { AlertTriangle, ClipboardCheck, FolderInput, FolderOpen, Info, Link2, Pencil, Plus, Power, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { MenuItem } from '@/components/ui/ds';
import type { ActionKey, ActionState } from './directoryModel';

export const ACTION_ICON: Record<ActionKey, LucideIcon> = {
  new: Plus, properties: Info, edit: Pencil, move: FolderInput, toggle: Power, access: ShieldCheck, approvals: ClipboardCheck, exceptions: AlertTriangle,
};

/** The menu for a folder: Open (go into it) first when it is not the one you are in, then Properties, then its other actions in the model's order, then Copy link. A hidden action is
 *  left out; a disabled one stays with its reason under it. Deactivating is the destructive step (red, set off by a line, so it goes last). */
export function menuItems(actions: readonly ActionState[], run: (key: ActionKey) => void, extra?: { go?: { label: string; onSelect: () => void }; copy?: () => void }): MenuItem[] {
  const first = (a: ActionState) => (a.key === 'properties' ? 0 : a.key === 'toggle' ? 2 : 1);
  const items: MenuItem[] = [...actions].sort((a, b) => first(a) - first(b)).filter((a) => !a.hidden).map((a) => ({
    key: a.key, label: a.label, icon: ACTION_ICON[a.key], disabled: a.disabled, reason: a.reason, danger: a.key === 'toggle' && a.label === 'Deactivate', onSelect: () => run(a.key),
  }));
  const link: MenuItem[] = extra?.copy ? [{ key: 'copy', label: 'Copy link', icon: Link2, onSelect: extra.copy }] : [];
  const at = items.findIndex((i) => i.danger);                       // Copy link stays above the destructive step
  const all = at < 0 ? [...items, ...link] : [...items.slice(0, at), ...link, ...items.slice(at)];
  return extra?.go ? [{ key: 'go', label: extra.go.label, icon: FolderOpen, onSelect: extra.go.onSelect }, ...all] : all;
}
