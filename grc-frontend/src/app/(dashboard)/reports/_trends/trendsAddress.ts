// The Trends board's state in its address, on the kit's useAddressState: /reports/trends?view=table&order=attention&status=critical,warn&range=90&metric=open_risks. A link opens the same view, and a link to
// one figure (`metric`) opens its Sheet. Pure (no React). Defined once, outside any component (useAddressState reads the address again for a new schema).
import { integer, listOf, oneOf, sortOf, text } from '../../../../lib/addressState.ts';
import { DEFAULT_RANGE, RANGES, type Order, type Rag } from './trendsModel.ts';

export const VIEWS = ['board', 'table'] as const;
export type View = (typeof VIEWS)[number];
export const ORDERS: readonly Order[] = ['module', 'attention'];
export const STATUS_KEYS: readonly Rag[] = ['critical', 'warn', 'ok', 'none'];
export const SORT_KEYS = ['figure', 'module', 'now', 'change', 'status'] as const;

export const TRENDS_SCHEMA = {
  view: oneOf(VIEWS, 'board'),
  order: oneOf(ORDERS, 'module'),
  status: listOf(STATUS_KEYS),
  range: integer(DEFAULT_RANGE, { min: 7, max: 730 }),
  metric: text(),
  sort: sortOf(SORT_KEYS, null),
};

/** A range from the address is one of the four the page offers, else the default (?range=45 is a link nobody made by hand). */
export const rangeOf = (days: number): number => (RANGES.some((r) => r.days === days) ? days : DEFAULT_RANGE);

/** The link to one figure's Sheet, keeping what the board shows. */
export const metricHref = (key: string, search = ''): string => {
  const q = new URLSearchParams(search);
  q.set('metric', key);
  return `/reports/trends?${q.toString()}`;
};
