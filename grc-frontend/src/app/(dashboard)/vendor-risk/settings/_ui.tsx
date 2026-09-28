'use client';

// What every settings section is built from: a section that opens and closes,
// a labelled row, and a picker for the roles and people a setting can name.

import { ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, RotateCcw, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const inputCls = 'w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-slate-500';
export const fieldCls = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-slate-500';
export const TIER_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const TIERS = ['critical', 'high', 'medium', 'low'] as const;

export interface Directory { roles: string[]; people: Array<{ id: number; name: string }> }

export function Section({ id, icon: Icon, title, summary, open, onToggle, dirty, onDefaults, children }: {
  id: string; icon: LucideIcon; title: string; summary: ReactNode; open: boolean; onToggle: () => void;
  dirty?: boolean; onDefaults?: () => void; children: ReactNode;
}) {
  return (
    <section id={id} className={clsx('scroll-mt-4 rounded-xl border bg-white transition-shadow', open ? 'border-slate-300 shadow-sm' : 'border-slate-200')}>
      <h3>
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-slate-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
              {title}
              {dirty && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800">Unsaved</span>}
            </span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span>
          </span>
          <ChevronDown className={clsx('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </h3>
      {open && (
        <div id={`${id}-body`} className="border-t border-slate-100 px-4 pb-4 pt-3">
          {children}
          {onDefaults && (
            <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
              <button type="button" onClick={onDefaults}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Use the defaults for this section
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** A setting on one line: what it is on the left, the control on the right, help beneath. */
export function Row({ label, htmlFor, help, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={htmlFor} className="min-w-0 flex-1 text-sm text-slate-700">{label}</label>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
      {help && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{help}</p>}
    </div>
  );
}

export function Unit({ children }: { children: ReactNode }) {
  return <span className="w-10 text-xs text-slate-400">{children}</span>;
}

export function Help({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs leading-relaxed text-slate-500">{children}</p>;
}

/** Stored as 'role:<name>' or 'user:<id>'; shown as names and chosen from lists. */
export function targetLabel(target: string, directory?: Directory): string {
  if (target.startsWith('role:')) return `${target.slice(5)} (role)`;
  if (target.startsWith('user:')) {
    return directory?.people.find((p) => `user:${p.id}` === target)?.name || `User ${target.slice(5)}`;
  }
  return target;
}

export function TargetsPicker({ id, value, onChange, directory, disabled, placeholder = 'Add a role or a person…' }: {
  id?: string; value: string[]; onChange: (next: string[]) => void; directory?: Directory; disabled?: boolean; placeholder?: string;
}) {
  const roles = (directory?.roles || []).filter((r) => !value.includes(`role:${r}`));
  const people = (directory?.people || []).filter((p) => !value.includes(`user:${p.id}`));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
          {targetLabel(t, directory)}
          {!disabled && (
            <button type="button" aria-label={`Remove ${targetLabel(t, directory)}`} onClick={() => onChange(value.filter((x) => x !== t))}
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <select id={id} value="" aria-label={placeholder} onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className="rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 focus:border-primary-500 focus:outline-none">
          <option value="">{placeholder}</option>
          {roles.length > 0 && (
            <optgroup label="Roles">{roles.map((r) => <option key={r} value={`role:${r}`}>{r}</option>)}</optgroup>
          )}
          {people.length > 0 && (
            <optgroup label="People">{people.map((p) => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}</optgroup>
          )}
        </select>
      )}
      {disabled && value.length === 0 && <span className="text-xs text-slate-400">Nobody</span>}
    </div>
  );
}
