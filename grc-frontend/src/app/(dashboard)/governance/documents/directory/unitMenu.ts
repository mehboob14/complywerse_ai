// The actions of a folder or a file as the kit's menu items: the toolbar's "Actions" menu on a phone, a "⋯" and the right-click menu all list the same things, built from what
// directoryModel.unitActions says is allowed (and why not). The model decides; this only gives each action its icon and what it does.
import { ClipboardCheck, FileText, FolderInput, FolderOpen, Info, Library, Link2, Pencil, Plus, Power, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { MenuItem } from '@/components/ui/ds';
import type { ActionKey, ActionState } from './directoryModel';

export const ACTION_ICON: Record<ActionKey, LucideIcon> = {
  new: Plus, properties: Info, edit: Pencil, move: FolderInput, toggle: Power, access: ShieldCheck, approvals: ClipboardCheck,
};

/** The menu for a folder: `go` (Open: go into it) first when it is not the one you are in, then Properties, then its other actions in the model's order. A hidden action is left out;
 *  a disabled one stays with its reason under it. Deactivating is the destructive step (red, set off by a line). */
export function menuItems(actions: readonly ActionState[], run: (key: ActionKey) => void, go?: { label: string; onSelect: () => void }): MenuItem[] {
  const first = (a: ActionState) => (a.key === 'properties' ? 0 : 1);
  const items: MenuItem[] = [...actions].sort((a, b) => first(a) - first(b)).filter((a) => !a.hidden).map((a) => ({
    key: a.key, label: a.label, icon: ACTION_ICON[a.key], disabled: a.disabled, reason: a.reason, danger: a.key === 'toggle' && a.label === 'Deactivate', onSelect: () => run(a.key),
  }));
  return go ? [{ key: 'go', label: go.label, icon: FolderOpen, onSelect: go.onSelect }, ...items] : items;
}

/** The menu for a file: Open (the document's page), Open in the library (the library, filtered to its unit, with its details open), Copy link. */
export function fileMenuItems(run: { open: () => void; library: () => void; copy: () => void }): MenuItem[] {
  return [
    { key: 'open', label: 'Open', icon: FileText, onSelect: run.open },
    { key: 'library', label: 'Open in the library', icon: Library, onSelect: run.library },
    { key: 'copy', label: 'Copy link', icon: Link2, onSelect: run.copy },
  ];
}
