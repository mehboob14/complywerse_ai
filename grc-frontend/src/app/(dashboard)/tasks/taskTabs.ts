// The tabs of Task Management, apart from React so `node --test` pins them (taskTabs.test.ts): My work (the front door), All tasks (the register), Reports and Settings, the names the
// address knows them by, and the one rule that keeps the OLD board links alive now that the default tab is My work: an address with no ?tab= that carries a parameter of the register
// (?status= ?priority= ?mine=1 ?view=kanban ...) is a link to the board, so it opens All tasks with those filters, exactly as it did when the board was the first tab.
import { REGISTER_SCHEMA } from './_register/taskAddress.ts';

export const TASK_TABS = ['work', 'all', 'reports', 'settings'] as const;
export type TaskTab = (typeof TASK_TABS)[number];
export const TAB_LABELS: Record<TaskTab, string> = { work: 'My work', all: 'All tasks', reports: 'Reports', settings: 'Settings' };

/** The old names of the tabs, which still arrive from bookmarks, e-mails and notifications: `board` was the Task Board, `my-tasks` (and `mine`) My Tasks, `sla` the Settings tab. */
export const TAB_ALIASES: Readonly<Record<string, TaskTab>> = { board: 'all', 'my-tasks': 'work', mine: 'work', sla: 'settings', report: 'reports' };

/** The names of the register's own parameters (the filters, sort, view, page, details): the address the old board wrote. */
export const REGISTER_PARAMS: readonly string[] = Object.keys(REGISTER_SCHEMA);

/** The tab an address with no (usable) ?tab= opens: All tasks when it carries a parameter of the register (an old board link), else My work. */
export function defaultTab(search: string): TaskTab {
  const query = new URLSearchParams(search);
  return REGISTER_PARAMS.some((name) => query.has(name)) ? 'all' : 'work';
}

/** The address of a tab of Task Management: `/tasks` for My work, else `/tasks?tab=<tab>` followed by the register's parameters (a list is one comma-separated value, as the register writes it). */
export function tasksHref(tab: TaskTab, params: Readonly<Record<string, string | readonly string[]>> = {}): string {
  const query = new URLSearchParams();
  if (tab !== 'work') query.set('tab', tab);
  Object.keys(params).forEach((name) => {
    const value = params[name];
    const text = typeof value === 'string' ? value : value.join(',');
    if (text) query.set(name, text);
  });
  const written = query.toString();
  return written ? `/tasks?${written}` : '/tasks';
}
