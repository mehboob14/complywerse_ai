// Where each number of the Insights tab opens: the address of All tasks (the register's own parameters) that lists exactly the tasks the number counted. Pure (no React), tested in
// insightsLinks.test.ts, which reads every address back with the register's own rules (`readAddress(REGISTER_SCHEMA)`, `pageOf`, the facet engine) over the same rows and holds the count it shows
// to the number on the tab, with the document requests in and out. "Open" is every status that is not Completed or Verified among the tasks given (the words the tasks hold, so a status a module
// wrote with its own word is in it); with "Include document requests" off every address also names the kinds of task it keeps, so the register shows the same count.
import { oneOf } from '../../../../lib/addressState.ts';
import { statusValue } from '../_register/taskFacets.ts';
import { KINDS, isDoneStatus, type RegisterTask } from '../taskRecord.ts';
import { STATUSES } from '../tasksModel.ts';
import { tasksHref } from '../taskTabs.ts';

/** The tab's own address state: `?documents=off` leaves the document requests out; the plain address has them in (today's numbers). */
export const INSIGHTS_SCHEMA = { documents: oneOf(['on', 'off'] as const, 'on') };

/** The words of a value that cannot travel in an address: a list is one comma-separated parameter, so a word with a comma in it would read back as two. Such a row is counted but not linked. */
const travels = (word: string): boolean => word.indexOf(',') < 0;

/** The words, in the workflow's order and then any other, of the statuses the tasks hold that are (not) done. */
function statusWords(rows: readonly RegisterTask[], done: boolean): string[] {
  const held = new Set<string>();
  rows.forEach((t) => { if (isDoneStatus(t.status) === done) held.add(statusValue(t.status)); });
  const rank = (w: string) => { const at = STATUSES.indexOf(w); return at < 0 ? STATUSES.length : at; };
  return Array.from(held).filter(travels).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export interface InsightsLinks {
  /** every task counted */
  all: string;
  overdue: string;
  /** the open tasks; null when there is none (an empty status list would be every task) */
  active: string | null;
  /** the finished ones; null when there is none */
  done: string | null;
  /** the overdue tasks, the longest overdue first */
  oldest: string;
  status: (word: string) => string | null;
  priority: (word: string) => string | null;
  source: (word: string) => string | null;
  category: (word: string) => string | null;
  /** a person's open tasks */
  owner: (id: string | number) => string | null;
}

/** The addresses for the tasks the tab counts. `rows` are exactly those tasks (the caller has left the document requests out when the switch is off). */
export function linksOf(rows: readonly RegisterTask[], includeDocuments: boolean): InsightsLinks {
  const kinds: Record<string, string[]> = includeDocuments ? {} : { kind: KINDS.filter((k) => k !== 'document') };
  const href = (params: Record<string, string | string[]> = {}) => tasksHref('all', { ...params, ...kinds });
  const open = statusWords(rows, false);
  const finished = statusWords(rows, true);
  const word = (name: 'status' | 'priority' | 'source' | 'category') => (value: string) => (travels(value) ? href({ [name]: [value] }) : null);
  return {
    all: href(),
    overdue: href({ due: ['overdue'] }),
    active: open.length ? href({ status: open }) : null,
    done: finished.length ? href({ status: finished }) : null,
    oldest: href({ due: ['overdue'], sort: 'due_date:asc' }),
    status: word('status'),
    priority: word('priority'),
    source: word('source'),
    category: word('category'),
    owner: (id) => (open.length ? href({ owner: [String(id)], status: open }) : null),
  };
}
