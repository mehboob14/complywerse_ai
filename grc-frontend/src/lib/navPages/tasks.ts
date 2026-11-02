// Navigation-registry entries of the Task Management pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// The label of a page is its heading (the sidebar's name for the leaf); a detail page keeps the record's own name as its heading and the label names the kind of page.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/tasks': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  { path: '/tasks/:id', label: 'Task', area: 'task-management', parent: '/tasks', hidden: 'opens from a task row, a notification, a regulatory change, an issue or a report', ownHeading: true },
  { path: '/tasks/reports', label: 'Task reports', area: 'task-management', parent: '/tasks', hidden: 'the Reports tab of Task Management shows the same view; no link opens this page', ownHeading: true },
  { path: '/tasks/my-tasks', label: 'My tasks', area: 'task-management', parent: '/tasks', hidden: 'the My Tasks tab of Task Management shows the same view; no link opens this page', ownHeading: true },
  { path: '/tasks/sla', label: 'Task SLA levels', area: 'task-management', parent: '/tasks', hidden: 'no link opens it; the days it keeps (in this browser) fill in the New task form where Settings give a level no target', ownHeading: true },
  { path: '/my-work', label: 'My work', area: 'task-management', parent: '/tasks', hidden: 'opens from the Performance Overview banner and from notifications', ownHeading: true },
  // { path: '/my-runs', label: 'My runs', area: 'task-management', parent: '/tasks', hidden: 'opens from My work', ownHeading: true },   <- the Controls Automation pass's page, not this group's
];
