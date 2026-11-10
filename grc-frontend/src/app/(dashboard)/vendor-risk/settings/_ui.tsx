'use client';

// What every Settings section is built from (the kit's tokens, no page-local palette): a labelled row with its control on the right and its help beneath, a unit, a line of help, and a picker
// for the roles and people a setting can name. The names are the ones the editors imported before (`inputCls`, `fieldCls`, `Row`, `Unit`, `Help`, `TargetsPicker`, `targetLabel`, `Directory`,
// `TIERS`, `TIER_LABEL`): `_Questions.tsx` and the Policy page's alert rules still import them, so their props stay as they were. The accordion `Section` of the old page is gone: the page is a
// section nav now.
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { fieldClasses } from '@/components/ui/ds/fieldStyles';

/** A short number box (the unit follows it). */
export const inputCls = `${fieldClasses(false)} h-ds-control px-[12px] !w-[96px] text-right tabular-nums`;
/** A full-width text box. */
export const fieldCls = `${fieldClasses(false)} h-ds-control px-[12px]`;
export const TIER_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const TIERS = ['critical', 'high', 'medium', 'low'] as const;

export interface Directory { roles: string[]; people: Array<{ id: number; name: string }> }

/** A setting on one line: what it is on the left, the control on the right, help beneath. */
export function Row({ label, htmlFor, help, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="py-[6px]">
      <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px]">
        <label htmlFor={htmlFor} className="min-w-0 flex-1 basis-[14rem] text-ds-body text-ds-fg">{label}</label>
        <div className="flex items-center gap-[6px]">{children}</div>
      </div>
      {help && <p className="mt-[2px] text-ds-label text-ds-fg-muted">{help}</p>}
    </div>
  );
}

export function Unit({ children }: { children: ReactNode }) {
  return <span className="text-ds-label text-ds-fg-muted">{children}</span>;
}

export function Help({ children }: { children: ReactNode }) {
  return <p className="mb-[12px] text-ds-body text-ds-fg-muted">{children}</p>;
}

/** Stored as 'role:<name>' or 'user:<id>'; shown as names and chosen from lists. A person who is no longer on the list reads "A former colleague", never an id. */
export function targetLabel(target: string, directory?: Directory): string {
  if (target.startsWith('role:')) return `${target.slice(5)} (role)`;
  if (target.startsWith('user:')) return directory?.people.find((p) => `user:${p.id}` === target)?.name || 'A former colleague';
  return target;
}

export function TargetsPicker({ id, value, onChange, directory, disabled, placeholder = 'Add a role or a person…' }: {
  id?: string; value: string[]; onChange: (next: string[]) => void; directory?: Directory; disabled?: boolean; placeholder?: string;
}) {
  const roles = (directory?.roles || []).filter((r) => !value.includes(`role:${r}`));
  const people = (directory?.people || []).filter((p) => !value.includes(`user:${p.id}`));
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {value.map((t) => (
        <span key={t} className="inline-flex min-h-ds-control-sm items-center gap-[4px] rounded-full border border-ds-border bg-ds-surface-subtle pl-[10px] pr-[2px] text-ds-label text-ds-fg">
          {targetLabel(t, directory)}
          {!disabled && (
            <button type="button" aria-label={`Remove ${targetLabel(t, directory)}`} onClick={() => onChange(value.filter((x) => x !== t))}
              className="grid h-ds-control-sm min-w-[var(--ds-control-h-sm)] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring">
              <X aria-hidden className="h-[12px] w-[12px]" strokeWidth={2} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <select id={id} value="" aria-label={placeholder} onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className="h-ds-control min-w-0 max-w-full rounded-ds-control border border-dashed border-ds-border-control bg-ds-surface px-[10px] text-ds-label text-ds-fg-muted focus-visible:outline-none focus-visible:shadow-ds-ring">
          <option value="">{placeholder}</option>
          {roles.length > 0 && <optgroup label="Roles">{roles.map((r) => <option key={r} value={`role:${r}`}>{r}</option>)}</optgroup>}
          {people.length > 0 && <optgroup label="People">{people.map((p) => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}</optgroup>}
        </select>
      )}
      {disabled && value.length === 0 && <span className="text-ds-label text-ds-fg-muted">Nobody</span>}
    </div>
  );
}
