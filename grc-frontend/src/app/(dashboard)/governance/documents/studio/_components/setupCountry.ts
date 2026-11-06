/**
 * What the setup's lists offer once a country is chosen, apart from React so it can be tested: the country picker (every country with its flag,
 * a search that also knows "Turkey" and "UAE", the platform's own markets first), the regulators and laws of the country, then its bloc's, then
 * the international ones, and the installed frameworks that apply there ahead of the rest.
 */
import type { ComboBoxOption } from '@/components/ui/ComboBoxInput';
import type { MultiSelectDropdownItem } from '@/components/ui/MultiSelectDropdown';
import type { CountryDetail, CountryItem, CountryRow } from '@/lib/studio/api';

export const SEVERAL = 'Several countries';

/** Every country for the picker: flag, headings (Main markets, then the regions), and the other names a search matches. Without the new list
 * (an older server) the plain names. "Several countries" is last, under "Other". */
export function countryOptions(rows: CountryRow[] | undefined, names: string[]): ComboBoxOption[] {
  if (!rows?.length) return names.map((n) => ({ value: n, label: n }));
  return [
    ...rows.map((r) => ({ value: r.name, label: r.name, group: r.group, icon: r.flag, keywords: [r.code, ...r.aliases] })),
    { value: SEVERAL, label: SEVERAL, group: 'Other' },
  ];
}

const AREA_ORDER = ['Banking', 'Financial supervision', 'Securities', 'Capital markets', 'Insurance', 'Payments', 'Data protection', 'Cybersecurity',
  'AML/CFT', 'Telecom', 'Health', 'Pensions'];
const rank = (area: string) => { const i = AREA_ORDER.indexOf(area); return i < 0 ? AREA_ORDER.length : i; };

/** The line under an item: its area, and where it comes from when that is not the country ("EU · Banking", "International · AML/CFT"). */
export function sub(item: CountryItem, extra?: string): string {
  const from = item.scope === 'bloc' ? item.bloc || 'Bloc' : item.scope === 'international' ? 'International' : '';
  return [from, item.kind, item.area, extra].filter(Boolean).join(' · ');
}

const once = <T extends { value: string }>(items: T[]): T[] => items.filter((x, i, all) => all.findIndex((y) => y.value === x.value) === i);

/** The regulators to pick from: the ones followed in Regulatory Feeds, the chosen country's (banking, then the other supervisors by area), its bloc's,
 * then the international bodies. Without a country's lists (none chosen, or a country typed by hand) the older per-country list, then the
 * international bodies. */
export function regulatorItems(opts: {
  followed: { label: string; country: string }[];
  country: string;
  detail?: CountryDetail;
  legacy?: Record<string, string[]>;
  international?: CountryItem[];
}): MultiSelectDropdownItem[] {
  const { followed, country, detail, legacy, international } = opts;
  const own = followed.filter((r) => !country || !r.country || r.country === country);
  const items: MultiSelectDropdownItem[] = own.map((r) => ({ value: r.label, label: r.label, subLabel: 'Followed in Regulatory Feeds' }));
  if (detail) {
    const order = { country: 0, bloc: 1, international: 2 } as const;
    const sorted = detail.regulators.map((r, i) => ({ r, i })).sort((a, b) => order[a.r.scope] - order[b.r.scope] || rank(a.r.area) - rank(b.r.area) || a.i - b.i);
    items.push(...sorted.map(({ r }) => ({ value: r.label, label: r.label, subLabel: sub(r) })));
  } else {
    items.push(...(legacy?.[country] ?? []).map((r) => ({ value: r, label: r })));
    items.push(...(international ?? []).map((r) => ({ value: r.label, label: r.label, subLabel: sub(r) })));
  }
  return once(items);
}

/** The laws, circulars and frameworks to pick from: the country's, its bloc's, the international ones, then the platform's own register of
 * regulatory changes (what the organisation already tracks). */
export function lawItems(opts: {
  detail?: CountryDetail;
  register: { label: string; detail: string }[];
  international?: CountryItem[];
}): MultiSelectDropdownItem[] {
  const { detail, register, international } = opts;
  const offered = detail ? detail.laws : (international ?? []);
  const items: MultiSelectDropdownItem[] = offered.map((l) => ({ value: l.label, label: l.label, subLabel: sub(l) }));
  items.push(...register.map((r) => ({ value: r.label, label: r.label, subLabel: r.detail || 'Regulatory register' })));
  return once(items);
}

export interface FrameworkRow { id: number; name?: string; label: string; of_document?: boolean }

/** The installed frameworks, the document's own first, then the ones that apply in the country (the ones named for it), then the widely used,
 * then the rest; each with a line saying why it is where it is. */
export function frameworkItems(frameworks: FrameworkRow[], country: string, detail?: CountryDetail): (FrameworkRow & { note: string; tier: number })[] {
  const applies = new Set(detail?.frameworks.applies ?? []);
  const widely = new Set(detail?.frameworks.widely_used ?? []);
  const rows = frameworks.map((f) => {
    const named = f.name ?? f.label;
    if (f.of_document) return { ...f, note: 'This document’s', tier: 0 };
    if (applies.has(named)) return { ...f, note: country ? `Applies in ${country}` : 'Applies', tier: 1 };
    if (widely.has(named)) return { ...f, note: 'Widely used', tier: 2 };
    return { ...f, note: '', tier: 3 };
  });
  return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.tier - b.r.tier || a.i - b.i).map((x) => x.r);
}
