'use client';

// LEGACY SHIM. The Regulatory Changes screens no longer use this file (they use _lib/, _parts/ and the kit). It stays because three Vendor Risk files import three helpers from it:
// SendDialog.tsx and RenewalDialog.tsx (inDays) and PortalPanel.tsx (Segmented, fmtDate, inDays). They are another group's files and are not changed here; their output is unchanged.
// Retire this file when they move to lib/format.ts and the kit's SegmentedControl.

export type Option = { value: string; label: string; tone: string };

const toDate = (v: string) => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v);
};
export const fmtDate = (v?: string | null) =>
  v ? toDate(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };

/** A handful of choices, one click each. */
export function Segmented({ value, options, onChange, label }: {
  value: string; options: Option[]; onChange: (v: string) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              on ? `${o.tone} ring-2 ring-primary-500/40` : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
