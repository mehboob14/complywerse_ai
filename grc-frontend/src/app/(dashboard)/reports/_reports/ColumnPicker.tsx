'use client';

// The field picker for links and counts: this module's own columns, and for every linked module the counts, names and fields that come through the link (with how many rows have a value, so an empty
// column is not added by mistake). It is the second tab of the Add fields sheet. Logic is the builder's (which fields exist, presets, scopes); the markup is the kit's.
import { useEffect, useMemo, useState } from 'react';
import { Calendar, Hash, Link2, Search, Tag, Type } from 'lucide-react';
import { clsx } from 'clsx';
import { Checkbox, Disclosure, SegmentedControl, TextInput } from '@/components/ui/ds';
import type { ColType, ColumnDef, Row } from './types';
import type { LinkageDef } from './linkages';
import { toggleVisibleColumn } from './builderUtils';
import { rawValue } from './grid-utils';

const typeIcon = (t?: ColType) => (t === 'number' ? Hash : t === 'date' ? Calendar : t === 'badge' ? Tag : Type);
const TYPE_WORD: Record<string, string> = { number: 'number', date: 'date', badge: 'tag', text: 'text', linkage: 'link' };

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
  baseColumns, linkageCatalog, linkageColumns, visibleKeys, onChange, fieldQ, onFieldQChange, rows = [], defaultScope = 'all',
}: {
  baseColumns: ColumnDef[];
  linkageCatalog: LinkageDef[];
  linkageColumns: ColumnDef[];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
  fieldQ: string;
  onFieldQChange: (q: string) => void;
  rows?: Row[];
  defaultScope?: FieldScope;
}) {
  const [openLinkages, setOpenLinkages] = useState<Set<string>>(() => new Set());
  const [scope, setScope] = useState<FieldScope>(defaultScope);

  const q = fieldQ.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const fieldCount = baseColumns.length + linkageColumns.length;

  // a link that already has a field on the report starts open
  useEffect(() => {
    setOpenLinkages((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const link of linkageCatalog) {
        const hasSelected = linkageColumns.some((c) => c.linkageKey === link.key && visibleKeys.includes(c.key));
        if (hasSelected && !next.has(link.key)) { next.add(link.key); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [visibleKeys, linkageCatalog, linkageColumns]);

  const baseFiltered = useMemo(() => {
    let list = baseColumns.filter((c) => matches(c.label));
    if (scope === 'linked') list = [];
    if (scope === 'selected') list = list.filter((c) => visibleKeys.includes(c.key));
    return list;
  }, [baseColumns, q, scope, visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupedLinkage = useMemo(() => {
    if (scope === 'dataset') return [];
    return linkageCatalog.map((link) => ({
      link,
      fields: linkageColumns.filter((c) => {
        if (c.linkageKey !== link.key) return false;
        if (scope === 'selected' && !visibleKeys.includes(c.key)) return false;
        return !q || c.label.toLowerCase().includes(q) || link.label.toLowerCase().includes(q) || link.module.toLowerCase().includes(q);
      }),
    }));
  }, [linkageCatalog, linkageColumns, q, scope, visibleKeys]);

  const toggle = (key: string) => onChange(toggleVisibleColumn(visibleKeys, key));
  const selectAllLinkage = (linkKey: string) => {
    const keys = linkageColumns.filter((c) => c.linkageKey === linkKey).map((c) => c.key);
    const allOn = keys.every((k) => visibleKeys.includes(k));
    if (allOn) onChange(visibleKeys.filter((k) => !keys.includes(k)));
    else onChange([...visibleKeys, ...keys.filter((k) => !visibleKeys.includes(k))]);
  };

  const presets = useMemo(() => {
    const essentials = baseColumns.slice(0, Math.min(4, baseColumns.length)).map((c) => c.key);
    const scoring = baseColumns.filter((c) => c.type === 'number').map((c) => c.key);
    const ownership = baseColumns.filter((c) => /owner|assignee|responsible|created.?by|updated.?by/i.test(c.label) || /owner|assignee/i.test(c.key)).map((c) => c.key);
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
    if (keys.every((k) => set.has(k))) onChange(visibleKeys.filter((k) => !keys.includes(k)));
    else onChange([...visibleKeys, ...keys.filter((k) => !set.has(k))]);
  };

  const scopes = [
    { value: 'all' as const, label: 'All' },
    { value: 'dataset' as const, label: `This module (${baseColumns.length})` },
    { value: 'linked' as const, label: `Linked (${linkageColumns.length})` },
    { value: 'selected' as const, label: `Selected (${visibleKeys.length})` },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <TextInput
        type="search"
        aria-label="Search fields"
        placeholder={`Search ${fieldCount} fields in ${linkageCatalog.length + 1} modules`}
        value={fieldQ}
        onChange={(e) => onFieldQChange(e.target.value)}
        leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" />}
        autoComplete="off"
      />
      {presets.length > 0 && scope !== 'linked' && (
        <div className="flex flex-wrap gap-[6px]" role="group" aria-label="Field sets">
          {presets.map((p) => {
            const active = p.keys.every((k) => visibleKeys.includes(k));
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => applyPreset(p.keys)}
                className={clsx('inline-flex min-h-ds-control-sm items-center rounded-full border px-[10px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring', active ? 'border-transparent bg-ds-primary text-ds-on-primary' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover')}
              >
                {p.label} ({p.keys.length})
              </button>
            );
          })}
        </div>
      )}
      <SegmentedControl label="Which fields to list" name="field-scope" options={scopes} value={scope} onChange={setScope} />

      <div className="flex flex-col gap-[4px]">
        {(scope === 'all' || scope === 'dataset' || scope === 'selected') && baseFiltered.length > 0 && (
          <section aria-label="This module">
            <p className="m-0 pb-[2px] text-ds-label text-ds-fg-muted">This module ({baseFiltered.filter((c) => visibleKeys.includes(c.key)).length} on the report)</p>
            {baseFiltered.map((c) => <FieldRow key={c.key} col={c} checked={visibleKeys.includes(c.key)} onToggle={() => toggle(c.key)} fill={fillRate(c, rows)} />)}
          </section>
        )}

        {(scope === 'all' || scope === 'linked' || scope === 'selected') && groupedLinkage.map(({ link, fields }) => {
          const allFields = linkageColumns.filter((c) => c.linkageKey === link.key);
          const visibleCount = allFields.filter((c) => visibleKeys.includes(c.key)).length;
          if (!fields.length && (q || scope === 'selected')) return null;
          const shown = q || scope === 'selected' ? fields : allFields;
          const open = openLinkages.has(link.key) || (!!q && fields.length > 0);
          return (
            <Disclosure
              key={link.key}
              label={`${link.label} (${link.module})`}
              count={visibleCount}
              level={4}
              region={false}
              open={open}
              onOpenChange={(next) => setOpenLinkages((s) => { const n = new Set(s); if (next) n.add(link.key); else n.delete(link.key); return n; })}
            >
              <div className="flex flex-col gap-[2px] pb-[8px]">
                <button type="button" onClick={() => selectAllLinkage(link.key)} className="self-start rounded-ds-control px-[8px] py-[4px] text-ds-label text-ds-primary-text hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring">
                  {allFields.every((c) => visibleKeys.includes(c.key)) ? `Deselect all ${allFields.length} fields` : `Select all ${allFields.length} fields`}
                </button>
                {shown.map((c) => <FieldRow key={c.key} col={c} checked={visibleKeys.includes(c.key)} onToggle={() => toggle(c.key)} fill={fillRate(c, rows)} linked />)}
              </div>
            </Disclosure>
          );
        })}

        {baseFiltered.length === 0 && groupedLinkage.every((g) => !g.fields.length) && <p className="m-0 py-[16px] text-center text-ds-body text-ds-fg-muted">No fields match.</p>}
      </div>
    </div>
  );
}

function FieldRow({ col, checked, onToggle, linked = false, fill = null }: { col: ColumnDef; checked: boolean; onToggle: () => void; linked?: boolean; fill?: number | null }) {
  const Icon = linked ? Link2 : typeIcon(col.type);
  return (
    <Checkbox
      checked={checked}
      onChange={onToggle}
      className="w-full"
      label={(
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
          <Icon aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" />
          <span className="min-w-0 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{col.label}</span>
          <span className="text-ds-label text-ds-fg-muted">{TYPE_WORD[col.type || 'text'] ?? 'text'}{fill != null ? `, ${fill}% filled` : ''}</span>
        </span>
      )}
    />
  );
}
