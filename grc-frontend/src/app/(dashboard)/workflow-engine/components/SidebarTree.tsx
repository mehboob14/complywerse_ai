'use client';

// Lists workflow nodes the way the sidebar lists pages: module → page →
// assessment, to any depth. Each item carries its sidebar `path` from the
// catalog, which already sends items in menu order, so groups appear in the
// order their first item does. Searching opens every group that has a match.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export type TreeItem = { key: string; label?: string; path?: string[] };

type Group<T> = { name: string; id: string; items: T[]; groups: Group<T>[]; count: number };

function buildTree<T extends TreeItem>(items: T[]): Group<T> {
  const root: Group<T> = { name: '', id: '', items: [], groups: [], count: 0 };
  for (const item of items) {
    let node = root;
    node.count += 1;
    for (const name of item.path?.length ? item.path : ['Other']) {
      let next = node.groups.find((g) => g.name === name);
      if (!next) {
        next = { name, id: `${node.id}/${name}`, items: [], groups: [], count: 0 };
        node.groups.push(next);
      }
      next.count += 1;
      node = next;
    }
    node.items.push(item);
  }
  return root;
}

export function SidebarTree<T extends TreeItem>({ items, query = '', expanded = false, renderItem, dense = false }: {
  items: T[];
  /** Keeps items whose label, key or place matches, and opens their groups. */
  query?: string;
  /** Opens every group (the caller has already filtered the items). */
  expanded?: boolean;
  renderItem: (item: T) => React.ReactNode;
  /** Tighter spacing, for the narrow canvas palette. */
  dense?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const tree = useMemo(() => buildTree(q
    ? items.filter((it) => [it.label || it.key, it.key, ...(it.path || [])].some((s) => s.toLowerCase().includes(q)))
    : items), [items, q]);

  if (tree.count === 0) {
    return <p className="px-3 py-6 text-center text-xs text-slate-400">Nothing matches.</p>;
  }

  const render = (group: Group<T>, depth: number): React.ReactNode => {
    const isOpen = expanded || q !== '' || !!open[group.id];
    return (
      <div key={group.id} className={depth === 0 ? 'mb-1' : ''}>
        <button
          type="button"
          onClick={() => setOpen((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
          aria-expanded={isOpen}
          className={`flex w-full items-center gap-1 rounded text-left hover:bg-slate-50 ${dense ? 'px-1.5 py-1' : 'px-2 py-1.5'} ${
            depth === 0 ? 'text-xs font-semibold text-slate-800' : 'text-[11px] font-medium text-slate-600'}`}
        >
          {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="flex-1 truncate">{group.name}</span>
          <span className="text-[10px] font-normal text-slate-400">{group.count}</span>
        </button>
        {isOpen && (
          <div className={`space-y-0.5 border-l border-slate-100 ${dense ? 'ml-1.5 pl-1' : 'ml-2.5 pl-1.5'}`}>
            {group.items.map((item) => renderItem(item))}
            {group.groups.map((g) => render(g, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return <>{tree.groups.map((g) => render(g, 0))}</>;
}
