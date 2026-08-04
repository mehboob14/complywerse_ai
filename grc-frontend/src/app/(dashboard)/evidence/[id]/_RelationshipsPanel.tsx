'use client';

/**
 * RelationshipsPanel — one relationship type at a time behind a segmented
 * control that shows every type with its count. Scales cleanly regardless of
 * how many types exist; an empty type is just a tab with a 0 and a friendly
 * add prompt. Replaces the stacked "Internal Controls" + "Related records"
 * sections on the evidence full-record page.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Link2, X } from 'lucide-react';

// Lucide icons are forwardRef components — ComponentType<any> accepts them.
type IconType = React.ComponentType<any>;

export interface RelItem {
  id: number | string;
  code?: string | null;
  title: string;
  subtitle?: string | null;
  href?: string;
  onRemove?: () => void;
  removing?: boolean;
}

export interface RelSection {
  key: string;
  label: string;
  icon: IconType;
  tone?: string;          // icon tint class, e.g. 'text-rose-600'
  count: number;
  items: RelItem[];
  add?: React.ReactNode;  // picker/trigger for linking this type (omit for read-only)
}

export default function RelationshipsPanel({ sections }: { sections: RelSection[] }) {
  const [active, setActive] = useState<string>(sections[0]?.key ?? '');
  const cur = sections.find((s) => s.key === active) ?? sections[0];
  if (!cur) return null;
  const tone = cur.tone || 'text-primary-600';
  const singular = cur.label.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

  return (
    <div className="cw-card rounded-xl p-4 sm:p-5">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
          <Link2 className="h-5 w-5 text-primary-600" strokeWidth={1.75} /> Relationships
        </h3>
        {cur.add}
      </div>

      {/* Segmented tabs — every type with its count */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {sections.map((s) => {
          const on = s.key === cur.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(s.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <s.icon className={`h-4 w-4 ${on ? s.tone || 'text-primary-600' : 'text-slate-400'}`} strokeWidth={1.9} />
              {s.label}
              <span className={`rounded-full px-1.5 text-[11px] font-semibold ${on ? 'bg-slate-100 text-slate-600' : 'bg-slate-200/70 text-slate-500'}`}>{s.count}</span>
            </button>
          );
        })}
      </div>

      {/* Active type */}
      {cur.items.length > 0 ? (
        <div className="space-y-2">
          {cur.items.map((it) => (
            <div key={`${cur.key}-${it.id}`} className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 ${tone}`}>
                  <cur.icon className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <div className="min-w-0">
                  {it.code && <div className="font-mono text-xs text-slate-500">{it.code}</div>}
                  {it.href ? (
                    <Link href={it.href} className="text-sm font-semibold text-slate-800 hover:text-primary-600">{it.title}</Link>
                  ) : (
                    <div className="text-sm font-semibold text-slate-800">{it.title}</div>
                  )}
                  {it.subtitle && <div className="mt-0.5 text-xs text-slate-500">{it.subtitle}</div>}
                </div>
              </div>
              {it.onRemove && (
                <button
                  type="button"
                  onClick={it.onRemove}
                  disabled={it.removing}
                  className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"
                  title="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center">
          <cur.icon className="mb-2 h-6 w-6 text-slate-300" strokeWidth={1.75} />
          <p className="text-sm font-medium text-slate-700">No {cur.label.toLowerCase()} linked yet</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {cur.add ? `Link a ${singular} to this evidence.` : 'This updates automatically as the evidence is attached elsewhere.'}
          </p>
          {cur.add && <div className="mt-3">{cur.add}</div>}
        </div>
      )}
    </div>
  );
}
