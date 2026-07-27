'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Calendar, ChevronDown, ChevronRight, Hash, Link2, Search, Tag, Type } from 'lucide-react';
import type { ColType, ColumnDef } from './types';
import type { LinkageDef } from './linkages';
import { toggleVisibleColumn } from './builderUtils';

const typeIcon = (t?: ColType) => (t === 'number' ? Hash : t === 'date' ? Calendar : t === 'badge' ? Tag : Type);

export default function ColumnPicker({
  baseColumns,
  linkageCatalog,
  linkageColumns,
  visibleKeys,
  onChange,
  fieldQ,
  onFieldQChange,
}: {
  baseColumns: ColumnDef[];
  linkageCatalog: LinkageDef[];
  linkageColumns: ColumnDef[];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
  fieldQ: string;
  onFieldQChange: (q: string) => void;
}) {
  const [openLinkages, setOpenLinkages] = useState<Set<string>>(() => new Set(linkageCatalog.map((l) => l.key)));

  const q = fieldQ.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);

  const groupedLinkage = useMemo(() => {
    return linkageCatalog.map((link) => ({
      link,
      fields: linkageColumns.filter((c) => c.linkageKey === link.key && (!q || c.label.toLowerCase().includes(q))),
    }));
  }, [linkageCatalog, linkageColumns, q]);

  const baseFiltered = baseColumns.filter((c) => matches(c.label));

  const toggle = (key: string) => onChange(toggleVisibleColumn(visibleKeys, key));

  const toggleLinkage = (key: string) => {
    setOpenLinkages((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const selectAllLinkage = (linkKey: string) => {
    const keys = linkageColumns.filter((c) => c.linkageKey === linkKey).map((c) => c.key);
    const allOn = keys.every((k) => visibleKeys.includes(k));
    if (allOn) onChange(visibleKeys.filter((k) => !keys.includes(k)));
    else onChange([...visibleKeys, ...keys.filter((k) => !visibleKeys.includes(k))]);
  };

  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
        <input
          value={fieldQ}
          onChange={(e) => onFieldQChange(e.target.value)}
          placeholder="Search fields…"
          className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs focus:border-primary-500 focus:outline-none"
        />
      </div>

      {baseFiltered.length > 0 && (
        <FieldGroup title="Dataset fields" count={baseFiltered.filter((c) => visibleKeys.includes(c.key)).length}>
          {baseFiltered.map((c) => (
            <FieldRow key={c.key} col={c} checked={visibleKeys.includes(c.key)} onToggle={() => toggle(c.key)} />
          ))}
        </FieldGroup>
      )}

      {groupedLinkage.map(({ link, fields }) => {
        const visibleCount = fields.filter((c) => visibleKeys.includes(c.key)).length;
        const open = openLinkages.has(link.key);
        if (!fields.length && q) return null;
        return (
          <div key={link.key} className="mt-2">
            <button
              type="button"
              onClick={() => toggleLinkage(link.key)}
              className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-slate-50"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
              <Link2 className="h-3.5 w-3.5 text-primary-500" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{link.label}</span>
              <span className="text-[10px] text-slate-400">{link.module}</span>
              {visibleCount > 0 && (
                <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold text-primary-800">{visibleCount}</span>
              )}
            </button>
            {open && (
              <div className="ml-2 border-l border-slate-100 pl-2">
                <button
                  type="button"
                  onClick={() => selectAllLinkage(link.key)}
                  className="mb-1 text-[10px] font-medium text-slate-400 hover:text-primary-700"
                >
                  {fields.every((c) => visibleKeys.includes(c.key)) ? 'Deselect all' : 'Select all'}
                </button>
                {fields.map((c) => (
                  <FieldRow key={c.key} col={c} checked={visibleKeys.includes(c.key)} onToggle={() => toggle(c.key)} linked />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        {count > 0 && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{count}</span>}
      </div>
      <div className="max-h-[180px] space-y-0.5 overflow-auto">{children}</div>
    </div>
  );
}

function FieldRow({
  col, checked, onToggle, linked = false,
}: {
  col: ColumnDef;
  checked: boolean;
  onToggle: () => void;
  linked?: boolean;
}) {
  const Icon = typeIcon(col.type);
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs ${checked ? 'bg-primary-50 text-primary-900' : 'text-slate-700 hover:bg-slate-50'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 rounded border-slate-300 accent-primary-600"
      />
      <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 truncate" title={col.label}>{col.label}</span>
      {linked && <Link2 className="h-3 w-3 shrink-0 text-primary-400" />}
    </label>
  );
}
