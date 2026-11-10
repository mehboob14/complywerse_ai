// Navigation-registry entry of the Workflow Engine page (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01; rewritten by adm-audit-ai, 2026-11-08.
// It is a full-width page of its own now (it was a tab of the Administration page): the Administration menu's "Workflow Engine" opens it, and ?tab=workflow on /admin forwards to it.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {};

export const PAGES: PageSpec[] = [
  { path: '/workflow-engine', label: 'Workflow Engine', area: 'administration', parent: '/admin', hidden: 'opens from the Administration menu (Workflow Engine); a full-width page of its own, outside the section list', keywords: ['Workflows', 'Automation rules', 'Triggers'], ownHeading: true },
];
