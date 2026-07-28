'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Calendar, Check, ChevronDown, ChevronRight, Hash, Link2, Search, Tag, Type,
} from 'lucide-react';
import type { ColType, ColumnDef, Row } from './types';
import type { LinkageDef } from './linkages';
import { toggleVisibleColumn } from './builderUtils';
import { rawValue } from './grid-utils';

const typeIcon = (t?: ColType) => (t === 'number' ? Hash : t === 'date' ? Calendar : t === 'badge' ? Tag : Type);

export type FieldScope = 'all' | 'dataset' | 'linked' | 'selected';

function fillRate(col: ColumnDef, rows: Row[]): number | null {
  if (!rows.length) return null;
  let filled = 0;
  for (const r of rows) {
    const v = rawValue(col, r);
    if (v != null && String(v).trim() !== '' && String(v) !== '—') filled += 1;
  }
  return Math.round((filled / rows.length) * 100);
}

export default function ColumnPicker({
  baseColumns,
  linkageCatalog,
  linkageColumns,
  visibleKeys,
  onChange,
  fieldQ,
  onFieldQChange,
  rows = [],
  compact = false,
  defaultScope = 'all',
}: {
  baseColumns: ColumnDef[];
  linkageCatalog: LinkageDef[];
  linkageColumns: ColumnDef[];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
  fieldQ: string;
  onFieldQChange: (q: string) => void;
  rows?: Row[];
  compact?: boolean;
  defaultScope?: FieldScope;
}) {
  const [openLinkages, setOpenLinkages] = useState<Set<string>>(() => new Set());
  const [scope, setScope] = useState<FieldScope>(defaultScope);

  const q = fieldQ.trim().toLowerCase();
  const matches = (label: string, extra = '') =>
    !q || label.toLowerCase().includes(q) || extra.toLowerCase().includes(q);

  const fieldCount =
    baseColumns.length + linkageColumns.length;

  useEffect(() => {
    setOpenLinkages((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const link of linkageCatalog) {
        const hasSelected = linkageColumns.some(
          (c) => c.linkageKey === link.key && visibleKeys.includes(c.key),
        );
        if (hasSelected && !next.has(link.key)) {
          next.add(link.key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleKeys, linkageCatalog, linkageColumns]);

  useEffect(() => {
    if (!q) return;
    setOpenLinkages((prev) => {
      const next = new Set(prev);
      for (const link of linkageCatalog) {
        const fields = linkageColumns.filter((c) => c.linkageKey === link.key);
        if (
          fields.some(
            (c) =>
              c.label.toLowerCase().includes(q) ||
              link.label.toLowerCase().includes(q) ||
              link.module.toLowerCase().includes(q),
          )
        ) {
          next.add(link.key);
        }
      }
      return next;
    });
  }, [q, linkageCatalog, linkageColumns]);

  const baseFiltered = useMemo(() => {
    let list = baseColumns.filter((c) => matches(c.label));
    if (scope === 'linked') list = [];
    if (scope === 'selected') list = list.filter((c) => visibleKeys.includes(c.key));
    return list;
  }, [baseColumns, q, scope, visibleKeys]);

  const groupedLinkage = useMemo(() => {
    if (scope === 'dataset') return [];
    return linkageCatalog.map((link) => ({
      link,
      fields: linkageColumns.filter((c) => {
        if (c.linkageKey !== link.key) return false;
        if (scope === 'selected' && !visibleKeys.includes(c.key)) return false;
        return (
          !q ||
          c.label.toLowerCase().includes(q) ||
          link.label.toLowerCase().includes(q) ||
          link.module.toLowerCase().includes(q)
        );
      }),
    }));
  }, [linkageCatalog, linkageColumns, q, scope, visibleKeys]);

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

  const presets = useMemo(() => {
    const essentials = baseColumns.slice(0, Math.min(4, baseColumns.length)).map((c) => c.key);
    const scoring = baseColumns.filter((c) => c.type === 'number').map((c) => c.key);
    const ownership = baseColumns
      .filter((c) => /owner|assignee|responsible|created.?by|updated.?by/i.test(c.label) || /owner|assignee/i.test(c.key))
      .map((c) => c.key);
    const badges = baseColumns.filter((c) => c.type === 'badge').map((c) => c.key);
    return [
      { id: 'essentials', label: 'Essentials', keys: essentials },
      { id: 'scoring', label: 'Scoring', keys: scoring },
      { id: 'ownership', label: 'Ownership', keys: ownership },
      { id: 'status', label: 'Status', keys: badges },
    ].filter((p) => p.keys.length > 0);
  }, [baseColumns]);

  const applyPreset = (keys: string[]) => {
    const set = new Set(visibleKeys);
    const allOn = keys.every((k) => set.has(k));
    if (allOn) onChange(visibleKeys.filter((k) => !keys.includes(k)));
    else onChange([...visibleKeys, ...keys.filter((k) => !set.has(k))]);
  };

  const scopes: { id: FieldScope; label: string; count?: number }[] = [
    { id: 'all', label: 'All modules' },
    { id: 'dataset', label: 'This dataset', count: baseColumns.length },
    { id: 'linked', label: 'Linked', count: linkageColumns.length },
    { id: 'selected', label: 'Selected', count: visibleKeys.length },
  ];

  return (
    <div className={compact ? '' : 'flex h-full min-h-0 flex-col'}>
      <div className="shrink-0 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            value={fieldQ}
            onChange={(e) => onFieldQChange(e.target.value)}
            placeholder={`Search ${fieldCount} fields · ${linkageCatalog.length + 1} modules`}
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-primary-500 focus:outline-none"
          />
        </div>

        {presets.length > 0 && scope !== 'linked' && (
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => {
              const active = p.keys.every((k) => visibleKeys.includes(k));
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.keys)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    active
                      ? 'bg-primary-500 text-[#0a0a0a]'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {p.label} · {p.keys.length}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {scopes.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors ${
                scope === s.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {s.label}
              {s.count != null ? ` (${s.count})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-2 space-y-1 ${compact ? 'max-h-[360px] overflow-y-auto' : 'min-h-0 flex-1 overflow-y-auto'}`}>
        {(scope === 'all' || scope === 'dataset' || scope === 'selected') && baseFiltered.length > 0 && (
          <FieldGroup title="This dataset" count={baseFiltered.filter((c) => visibleKeys.includes(c.key)).length}>
            {baseFiltered.map((c) => (
              <FieldRow
                key={c.key}
                col={c}
                checked={visibleKeys.includes(c.key)}
                onToggle={() => toggle(c.key)}
                fill={fillRate(c, rows)}
              />
            ))}
          </FieldGroup>
        )}

        {(scope === 'all' || scope === 'linked' || scope === 'selected') && (
          <>
            {scope === 'all' && (
              <div className="mb-1 mt-2 flex items-center justify-between px-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Linked modules ({linkageCatalog.length})
                </span>
              </div>
            )}

            {groupedLinkage.map(({ link, fields }) => {
              const allFields = linkageColumns.filter((c) => c.linkageKey === link.key);
              const visibleCount = allFields.filter((c) => visibleKeys.includes(c.key)).length;
              const open = openLinkages.has(link.key) || (!!q && fields.length > 0);
              if (!fields.length && (q || scope === 'selected')) return null;
              const shown = q || scope === 'selected' ? fields : allFields;
              return (
                <div key={link.key} className="mt-0.5">
                  <button
                    type="button"
                    onClick={() => toggleLinkage(link.key)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left hover:bg-slate-50"
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    )}
                    <Link2 className="h-3.5 w-3.5 text-primary-500" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                      {link.label}
                    </span>
                    <span className="hidden text-[10px] text-slate-400 sm:inline">{link.module}</span>
                    {visibleCount > 0 && (
                      <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold text-primary-800">
                        {visibleCount}
                      </span>
                    )}
                  </button>
                  {open && (
                    <div className="ml-2 max-h-[240px] overflow-y-auto border-l border-slate-100 pl-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">
                          via {link.module} · {allFields.length} fields
                        </span>
                        <button
                          type="button"
                          onClick={() => selectAllLinkage(link.key)}
                          className="text-[10px] font-medium text-slate-400 hover:text-primary-700"
                        >
                          {allFields.every((c) => visibleKeys.includes(c.key)) ? 'Deselect all' : 'Select all'}
                        </button>
                      </div>
                      {shown.map((c) => (
                        <FieldRow
                          key={c.key}
                          col={c}
                          checked={visibleKeys.includes(c.key)}
                          onToggle={() => toggle(c.key)}
                          linked
                          fill={fillRate(c, rows)}
                          moduleHint={link.module}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {baseFiltered.length === 0 && groupedLinkage.every((g) => !g.fields.length) && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">No fields match.</p>
        )}
      </div>
    </div>
  );
}

function FieldGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        {count > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            {count}
          </span>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function FieldRow({
  col,
  checked,
  onToggle,
  linked = false,
  fill = null,
  moduleHint,
}: {
  col: ColumnDef;
  checked: boolean;
  onToggle: () => void;
  linked?: boolean;
  fill?: number | null;
  moduleHint?: string;
}) {
  const Icon = typeIcon(col.type);
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${
        checked
          ? 'bg-primary-50 text-primary-900 ring-1 ring-inset ring-primary-200'
          : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500">
        <Icon className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" title={col.label}>
        {col.label}
      </span>
      {moduleHint && (
        <span className="hidden max-w-[4.5rem] truncate text-[10px] text-slate-400 xl:inline">{moduleHint}</span>
      )}
      {linked && !moduleHint && <Link2 className="h-3 w-3 shrink-0 text-primary-400" />}
      <span className="shrink-0 text-[10px] capitalize text-slate-400">{col.type || 'text'}</span>
      {fill != null && (
        <span className="flex w-12 shrink-0 items-center gap-1" title={`${fill}% filled`}>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
            <span
              className={`block h-full rounded-full ${fill >= 80 ? 'bg-emerald-500' : fill >= 40 ? 'bg-amber-400' : 'bg-slate-300'}`}
              style={{ width: `${fill}%` }}
            />
          </span>
          <span className="w-6 text-right tabular-nums text-[9px] text-slate-400">{fill}%</span>
        </span>
      )}
    </label>
  );
}
