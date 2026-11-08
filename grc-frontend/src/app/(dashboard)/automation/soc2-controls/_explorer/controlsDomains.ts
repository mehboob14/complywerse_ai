// The "By domain" view of the Controls explorer, apart from React so `node --test` pins it (controlsDomains.test.ts): the controls that pass the filters grouped by domain, each with how many
// are in which board column, how many nobody owns and how many are late. The groups are the filters' own result, so the numbers on this view are the numbers the list would show after a click.
import { BOARD_COLUMNS, columnOf, type BoardId, type Row } from './controlsModel.ts';
import { NO_VALUE } from './controlsModel.ts';

export interface DomainGroup {
  /** the domain as the control stores it (the value the Domain facet filters by); NO_VALUE for a control with none */
  key: string;
  label: string;
  total: number;
  columns: Record<BoardId, number>;
  unowned: number;
}

const empty = (): Record<BoardId, number> => Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, 0])) as Record<BoardId, number>;

/** Domains with the most that needs a person first (failing, then needs a look), then by name in reading order; a control with no domain is last. */
export function domainGroups(rows: readonly Row[]): DomainGroup[] {
  const m = new Map<string, DomainGroup>();
  rows.forEach((r) => {
    const key = r.category || NO_VALUE;
    const g = m.get(key) ?? { key, label: r.category || 'No domain', total: 0, columns: empty(), unowned: 0 };
    g.total += 1;
    g.columns[columnOf(r.overall_status)] += 1;
    if (r.ownership_status === 'unowned') g.unowned += 1;
    m.set(key, g);
  });
  return Array.from(m.values()).sort((a, b) =>
    Number(a.key === NO_VALUE) - Number(b.key === NO_VALUE)
    || b.columns.failing - a.columns.failing
    || b.columns.attention - a.columns.attention
    || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
}
