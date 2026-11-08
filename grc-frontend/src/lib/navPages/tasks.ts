// Navigation-registry entries of the Task Management pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// The label of a page is its heading (the sidebar's name for the leaf); a detail page keeps the record's own name as its heading and the label names the kind of page.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/tasks': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  { path: '/tasks/:id', label: 'Task', area: 'task-management', parent: '/tasks', hidden: 'opens from a task row, a notification, a regulatory change, an issue or a report', ownHeading: true },
  // the three old pages of the module are forwards (a server redirect that keeps the query): their tabs are the tabs of /tasks. They draw no head, so they carry no `ownHeading`
  { path: '/tasks/reports', label: 'Task reports', area: 'task-management', parent: '/tasks', hidden: 'an old address that forwards to the Reports tab of Task Management; stored links and bookmarks carry it' },
  { path: '/tasks/my-tasks', label: 'My tasks', area: 'task-management', parent: '/tasks', hidden: 'an old address that forwards to My work, the first tab of Task Management; stored links and bookmarks carry it' },
  { path: '/tasks/sla', label: 'Task SLA levels', area: 'task-management', parent: '/tasks', hidden: 'an old address that forwards to the Settings tab of Task Management, where the SLA days of the organization are' },
  { path: '/my-work', label: 'My requirements', area: 'task-management', parent: '/tasks', hidden: 'opens from My work in Task Management, from the Performance Overview banner and from notifications', ownHeading: true, keywords: ['My work', 'Assigned requirements'] },
  // { path: '/my-runs', label: 'My runs', area: 'task-management', parent: '/tasks', hidden: 'opens from My work', ownHeading: true },   <- the Controls Automation pass's page, not this group's
];
