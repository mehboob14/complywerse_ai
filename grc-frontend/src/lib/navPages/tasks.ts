// Navigation-registry entries of the Task Management pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// Uncomment an entry when its page moves to the kit; the builder confirms (or corrects) each label, parent and `hidden` sentence against the code.
export const LEAVES: Record<string, RouteExtra> = {
  // '/tasks': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // { path: '/tasks/:id', label: 'Task', area: 'task-management', parent: '/tasks', hidden: 'opens from a task row', ownHeading: true },
  // { path: '/tasks/reports', label: 'Task reports', area: 'task-management', parent: '/tasks', hidden: 'opens from Task Management', ownHeading: true },
  // { path: '/tasks/my-tasks', label: 'My tasks', area: 'task-management', parent: '/tasks', hidden: 'opens from Task Management', ownHeading: true },
  // { path: '/tasks/sla', label: 'Task SLA', area: 'task-management', parent: '/tasks', hidden: 'opens from Task Management', ownHeading: true },
  // { path: '/my-work', label: 'My work', area: 'task-management', parent: '/tasks', hidden: 'opens from a notification or the account menu', ownHeading: true },
  // { path: '/my-runs', label: 'My runs', area: 'task-management', parent: '/tasks', hidden: 'opens from My work', ownHeading: true },
];
