// The seven risk categories the server writes (backend `RISK_CATEGORIES` in modules/erm/routers/appetite.py, `Risk.category` in models/_11): ONE list for the
// appetite page, the heat-map filter and the aggregation. The three older pages each had their own (appetite had no "reputational", the heat map had no "project_change").
// A category nobody listed is shown by its readable name, never dropped.
import { statusLabel } from '../format.ts';

export const RISK_CATEGORIES = ['strategic', 'operational', 'financial', 'compliance', 'technology', 'third_party', 'project_change'] as const;

const LABELS: Readonly<Record<string, string>> = {
  strategic: 'Strategic',
  operational: 'Operational',
  financial: 'Financial',
  compliance: 'Compliance',
  technology: 'Technology',
  third_party: 'Third party',
  project_change: 'Project and change',
};

export const categoryLabel = (category?: string | null): string => (category ? LABELS[category] ?? statusLabel(category) : 'Uncategorised');

/** Options for a picker: the seven, then any other category the data holds (so a filter can always reach a real one). */
export function categoryOptions(present: ReadonlyArray<string | null | undefined> = []): Array<{ value: string; label: string }> {
  const known: string[] = RISK_CATEGORIES.slice();
  const extra: string[] = [];
  present.forEach((c) => { if (c && !known.includes(c) && !extra.includes(c)) extra.push(c); });
  return known.concat(extra.sort()).map((value) => ({ value, label: categoryLabel(value) }));
}
