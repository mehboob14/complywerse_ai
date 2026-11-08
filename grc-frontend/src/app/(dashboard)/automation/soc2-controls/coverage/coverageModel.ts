// What the Requirement coverage page decides, apart from React so `node --test` pins it (coverageModel.test.ts): the order of the frameworks (what is still to assess first), what a search leaves of a
// framework's unmapped requirements, how much of a framework was matched by roll-up rather than on the code itself, and the totals. The figures are the server's (GET /automation/common/coverage);
// nothing is recomputed here except those two ratios, and a ratio of nothing is a dash, never NaN.
export type Disposition = 'mapped' | 'other_party' | 'out_of_scope' | 'pending';
export const DISPOSITIONS: readonly Disposition[] = ['mapped', 'other_party', 'out_of_scope', 'pending'];

export interface Unmapped { code: string; reference: string; title: string | null; disposition: Disposition; rule: string; reason: string | null }
export interface FrameworkCoverage {
  key: string; label: string; total: number; counts: Record<Disposition, number>; mapped_pct: number; accounted_pct: number;
  /** mapped by parent/child roll-up rather than on the code itself: a framework can read 100% mapped while every row is an inference */
  inferred: number;
  unmapped: Unmapped[];
}
export interface Coverage {
  generated: string; total: number; counts: Record<Disposition, number>; labels: Record<Disposition, string>; mapped_pct: number; accounted_pct: number; frameworks: FrameworkCoverage[];
}

/** What is still to assess first (the only real to-do), then the least mapped. */
export function orderedFrameworks(list: readonly FrameworkCoverage[]): FrameworkCoverage[] {
  return list.slice().sort((a, b) => (b.counts.pending - a.counts.pending) || (a.mapped_pct - b.mapped_pct) || a.label.localeCompare(b.label));
}

/** The unmapped requirements that contain every word of the search (code, name or reason); no search leaves them all. */
export function matchingUnmapped(fw: FrameworkCoverage, query: string): Unmapped[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return fw.unmapped;
  return fw.unmapped.filter((u) => {
    const hay = `${u.code} ${u.reference} ${u.title ?? ''} ${u.reason ?? ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** The share of a framework's mapped requirements that were matched by roll-up: 0 to 1, null when nothing is mapped. */
export function inferredShare(fw: Pick<FrameworkCoverage, 'inferred' | 'counts'>): number | null {
  return fw.counts.mapped > 0 ? fw.inferred / fw.counts.mapped : null;
}

/** "Exact", "12% inferred": how a framework reached its mapping; a framework mapped mostly by roll-up reads as the weaker claim it is. */
export function matchWords(fw: Pick<FrameworkCoverage, 'inferred' | 'counts'>): { text: string; weak: boolean } {
  if (fw.inferred <= 0) return { text: 'Exact', weak: false };
  const share = inferredShare(fw) ?? 0;
  return { text: `${Math.round(share * 100)}% inferred`, weak: share >= 0.5 };
}

export const totalInferred = (frameworks: readonly Pick<FrameworkCoverage, 'inferred'>[]): number => frameworks.reduce((n, f) => n + (f.inferred || 0), 0);

/** Whether every requirement of a framework is accounted for (nothing is still to assess). */
export const isAccounted = (fw: Pick<FrameworkCoverage, 'counts'>): boolean => fw.counts.pending === 0;
