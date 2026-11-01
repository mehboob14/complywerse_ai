// Navigation-registry entry of the Workflow Engine page (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// It is the Workflow Engine tab of the Administration page (?tab=workflow, the Administration menu's item), mounted from that page; its own address has no link.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {};

export const PAGES: PageSpec[] = [
  { path: '/workflow-engine', label: 'Workflow Engine', area: 'administration', parent: '/admin', hidden: 'no link opens it; the Administration page shows the same view as its Workflow Engine tab', keywords: ['Workflows', 'Automation rules', 'Triggers'] },
];
