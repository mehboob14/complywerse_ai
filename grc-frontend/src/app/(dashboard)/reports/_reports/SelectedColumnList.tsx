'use client';

// The columns of a report, in order: each row can move up or down, be aligned, be pinned to the left or be removed, all from buttons a keyboard and a finger can reach (the drag handle stays for the
// mouse). Props and behaviour are the ones the builder always had; the markup is the kit's.
import { useRef } from 'react';
import { AlignLeft, AlignRight, ArrowDown, ArrowUp, GripVertical, Pin, PinOff, X } from 'lucide-react';
import { clsx } from 'clsx';
import { IconButton, Menu, type MenuItem } from '@/components/ui/ds';
import type { ColumnDef } from './types';
import { cellAlign } from './builderUtils';

export default function SelectedColumnList({
  cols, visibleKeys, align, pinned, onReorder, onRemove, onAlign, onPin,
}: {
  cols: ColumnDef[];
  visibleKeys: string[];
  align: Record<string, 'left' | 'right'>;
  pinned: string[];
  onReorder: (keys: string[]) => void;
  onRemove: (key: string) => void;
  onAlign: (key: string, align: 'left' | 'right') => void;
  onPin: (key: string) => void;
}) {
  const dragKey = useRef<string | null>(null);

  const reorder = (from: string, to: string) => {
    const base = visibleKeys.slice();
    const fi = base.indexOf(from);
    const ti = base.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    base.splice(ti, 0, base.splice(fi, 1)[0]);
    onReorder(base);
  };
  const move = (key: string, dir: -1 | 1) => {
    const i = visibleKeys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= visibleKeys.length) return;
    const base = visibleKeys.slice();
    [base[i], base[j]] = [base[j], base[i]];
    onReorder(base);
  };

  if (!visibleKeys.length) return <p className="m-0 text-ds-label text-ds-fg-muted">No columns yet. Add the fields the report should show.</p>;

  return (
    <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
      {visibleKeys.map((key, idx) => {
        const col = cols.find((c) => c.key === key);
        if (!col) return null;
        const a = cellAlign(col, align);
        const isPinned = pinned.includes(key);
        const items: MenuItem[] = [
          { key: 'up', label: 'Move up', icon: ArrowUp, disabled: idx === 0, onSelect: () => move(key, -1) },
          { key: 'down', label: 'Move down', icon: ArrowDown, disabled: idx === visibleKeys.length - 1, onSelect: () => move(key, 1) },
          { key: 'pin', label: isPinned ? 'Unpin' : 'Pin to the left', icon: isPinned ? PinOff : Pin, onSelect: () => onPin(key) },
          { key: 'align', label: a === 'left' ? 'Align right' : 'Align left', icon: a === 'left' ? AlignRight : AlignLeft, onSelect: () => onAlign(key, a === 'left' ? 'right' : 'left') },
        ];
        return (
          <li
            key={key}
            draggable
            onDragStart={() => { dragKey.current = key; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey.current && dragKey.current !== key) reorder(dragKey.current, key);
              dragKey.current = null;
            }}
            className={clsx('flex items-center gap-[4px] rounded-ds-control border pl-[4px]', isPinned ? 'border-ds-border-strong bg-ds-primary-soft' : 'border-ds-border bg-ds-surface')}
          >
            <GripVertical aria-hidden className="h-[16px] w-[16px] shrink-0 cursor-grab text-ds-fg-muted" />
            <span className="min-w-0 flex-1 py-[6px] text-ds-body text-ds-fg [overflow-wrap:anywhere]">
              {col.label}
              {col.linkageModule && <span className="ml-[6px] text-ds-label text-ds-fg-muted">{col.linkageModule}</span>}
              {isPinned && <span className="ml-[6px] text-ds-label text-ds-primary-text">pinned</span>}
            </span>
            <Menu label={`Actions for ${col.label}`} iconOnly size="sm" items={items} />
            <IconButton label={`Remove ${col.label}`} onClick={() => onRemove(key)}><X aria-hidden /></IconButton>
          </li>
        );
      })}
    </ul>
  );
}
