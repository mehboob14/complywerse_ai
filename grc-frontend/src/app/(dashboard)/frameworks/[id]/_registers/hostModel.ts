// The list of the Registers tab as plain functions: the two groups it is drawn in, and the arrow keys through it. The item that is open is the model's
// (lib/journeyModel.ts openItem); this only lays the items out.

export interface HostItem { id: string; label: string; kind: 'register' | 'document' }
export interface HostGroup { key: 'register' | 'document'; title: string; items: HostItem[] }

/** Registers first, then documents; a group with nothing in it is not drawn. */
export function groupItems(items: HostItem[]): HostGroup[] {
  return ([
    { key: 'register' as const, title: 'Registers', items: items.filter((i) => i.kind === 'register') },
    { key: 'document' as const, title: 'Documents', items: items.filter((i) => i.kind === 'document') },
  ]).filter((g) => g.items.length > 0);
}

/** The item an arrow key moves to: down or up one in the order the list is drawn (groups end to end), stopping at the ends; Home and End jump. */
export function stepItem(items: HostItem[], current: string | null, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): string | null {
  const order = groupItems(items).flatMap((g) => g.items.map((i) => i.id));
  if (order.length === 0) return null;
  if (key === 'Home') return order[0];
  if (key === 'End') return order[order.length - 1];
  const at = current == null ? -1 : order.indexOf(current);
  if (at < 0) return order[0];
  return order[Math.min(order.length - 1, Math.max(0, at + (key === 'ArrowDown' ? 1 : -1)))];
}

/** What the question says when a person with unsaved text opens another item. */
export const LEAVE_QUESTION = {
  title: 'Leave without saving?',
  message: 'Your changes to this document are not saved yet. If you open another item they are lost.',
  confirmLabel: 'Leave without saving',
  cancelLabel: 'Keep editing',
} as const;
