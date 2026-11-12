'use client';

// The organisation as a tree (left of the Directory): the organisation, its departments, their sub-departments and units, as one keyboard tree (role="tree" with the lines flat and
// each one's level, place in its set and open state said, so a screen reader reads "Operations, level 2, 3 of 5, collapsed"). A click on a line goes to that unit (its contents appear
// on the right); a double-click or Enter opens it (goes into it and shows what is under it, as in Explorer); a click on the arrow opens or closes it. The folder you are in is drawn open
// (a yellow folder with its front panel leaning back), a unit switched off grey. Keys: Up and Down move, Right opens then goes in, Left closes then goes
// up, Home and End, a letter jumps to the next unit that starts with it (the rules are directoryModel.treeKey, tested). One line is the tab stop (the selected one); moving with a
// key selects, as Explorer does, so the contents follow. A unit switched off says "Inactive" in words. A search box finds a unit anywhere in the tree by name or code; the results
// replace the tree until it is cleared. Right-click opens the unit's menu.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { TextInput } from '@/components/ui/ds';
import { FolderIcon } from './folderIcon';
import { countText, findUnits, treeKey, type DirectoryTree, type TreeRow } from './directoryModel';

const ROW = 'flex min-h-[32px] cursor-pointer items-center gap-[6px] rounded-ds-control pr-[8px] text-ds-body focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] [@media(pointer:coarse)]:min-h-[44px]';

interface Props {
  tree: DirectoryTree;
  rows: readonly TreeRow[];
  selected: number | null;
  /** a click or a key went to this unit (null: the organisation); `by` says which: a click is a step Back can undo, an arrow press only moves the selection */
  onSelect: (id: number | null, by: 'click' | 'key') => void;
  onToggle: (id: number) => void;
  /** a double-click or Enter: open the folder (go into it) */
  onOpen: (id: number) => void;
  onContext: (e: MouseEvent, id: number | null) => void;
}

export function UnitTree({ tree, rows, selected, onSelect, onToggle, onOpen, onContext }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<number | null | undefined>(undefined);       // a key moved the selection: focus its line once it is drawn
  const [query, setQuery] = useState('');
  const found = useMemo(() => findUnits(tree.nodes, query), [tree, query]);

  useEffect(() => {
    if (focusAfter.current === undefined || focusAfter.current !== selected) return;
    focusAfter.current = undefined;
    box.current?.querySelector<HTMLElement>(`[data-unit="${selected ?? 'org'}"]`)?.focus();
  }, [selected, rows]);

  const names = (id: number) => tree.node(id)?.name ?? '';
  const onKeyDown = (e: KeyboardEvent<HTMLElement>, id: number | null) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const act = treeKey(rows, names, (u) => tree.parentOf(u), id, e.key);
    if (!act) return;
    e.preventDefault();
    if ('focus' in act) { focusAfter.current = act.focus; onSelect(act.focus, 'key'); }
    else if ('expand' in act || 'collapse' in act) onToggle(('expand' in act ? act.expand : act.collapse));
    else onOpen(act.open);
  };

  return (
    <div className="flex min-h-0 flex-col gap-[8px]">
      <TextInput
        type="search"
        aria-label="Find a unit"
        placeholder="Find a unit"
        autoComplete="off"
        value={query}
        leftAdornment={<Search aria-hidden />}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }}
      />
      {query.trim() ? (
        <ul aria-label={`Units matching ${query.trim()}`} className="m-0 flex max-h-[60vh] list-none flex-col gap-[2px] overflow-y-auto p-0">
          {found.length === 0 ? <li className="px-[8px] py-[8px] text-ds-body text-ds-fg-muted">No unit matches</li> : found.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => { setQuery(''); onSelect(n.id, 'click'); }} onDoubleClick={() => onOpen(n.id)}
                className={clsx(ROW, 'w-full flex-col !items-start !gap-0 py-[4px] pl-[8px] text-left hover:bg-ds-surface-hover')}>
                <span className="max-w-full truncate text-ds-fg">{n.name}</span>
                <span className="max-w-full truncate text-ds-label font-normal text-ds-fg-muted">{tree.path(n.id).map((p) => p.name).join(' › ')}{n.is_active ? '' : ' · Inactive'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div ref={box} role="tree" aria-label="Organisation" className="relative max-h-[60vh] min-h-0 overflow-y-auto pr-[2px]">
          {rows.map((row) => {
            const node = row.id === null ? null : tree.node(row.id);
            const on = row.id === selected;
            const total = tree.documentsTotal(row.id);
            return (
              <div
                key={row.id ?? 'org'}
                role="treeitem"
                data-unit={row.id ?? 'org'}
                aria-level={row.depth + 1}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-selected={on}
                aria-expanded={row.hasChildren && row.id !== null ? row.open : undefined}
                tabIndex={on ? 0 : -1}
                onClick={() => onSelect(row.id, 'click')}
                onDoubleClick={() => { if (row.id !== null) onOpen(row.id); }}
                onKeyDown={(e) => onKeyDown(e, row.id)}
                onContextMenu={(e) => { e.preventDefault(); onContext(e, row.id); }}
                style={{ paddingLeft: 4 + Math.max(0, row.depth - 1) * 16 }}
                className={clsx(ROW, on ? 'bg-ds-primary-soft text-ds-primary-text' : 'text-ds-fg-body hover:bg-ds-surface-hover')}
              >
                {row.id === null ? (
                  <span aria-hidden className="grid h-[24px] w-[24px] shrink-0 place-items-center" />
                ) : row.hasChildren ? (
                  <span aria-hidden onClick={(e) => { e.stopPropagation(); onToggle(row.id as number); }} className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-border">
                    {row.open ? <ChevronDown className="h-[16px] w-[16px]" strokeWidth={1.75} /> : <ChevronRight className="h-[16px] w-[16px]" strokeWidth={1.75} />}
                  </span>
                ) : (
                  <span aria-hidden className="h-[24px] w-[24px] shrink-0" />
                )}
                <FolderIcon size={20} open={on} inactive={!!node && !node.is_active} />
                <span className={clsx('min-w-0 flex-1 truncate', node && !node.is_active && 'text-ds-fg-muted')}>{node ? node.name : 'Organisation'}</span>
                {node && !node.is_active && <span className="shrink-0 rounded-full border border-ds-border bg-ds-surface-subtle px-[6px] text-ds-label font-normal text-ds-fg-muted">Inactive</span>}
                <span className="sr-only">{countText(total, 'document')}</span>
                <span aria-hidden className="shrink-0 text-ds-label font-normal tabular-nums text-ds-fg-muted">{total}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
