// What each group of pages says about itself to the navigation registry (lib/navRegistry.ts). One file per group, so the builders of different
// groups never edit the same lines; this file only lists them. `node --test src/lib/navRegistry.test.ts` checks every entry.
//
// A group file exports:
//   LEAVES - what a SIDEBAR LEAF of the group adds to its entry, by href: usually `{ ownHeading: true }` once the page draws the kit's page head
//   PAGES  - the pages of the group that have no menu entry (details, tabs, forwards, legacy pages), each with its `area`, `label`, `parent` and the
//            `hidden` sentence that says where it opens from
// Type-only import: nothing runs when this file loads the types, so the registry and the group files do not import each other at run time.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';
import * as risk from './risk.ts';
import * as vendor from './vendor.ts';
import * as controls from './controls.ts';
import * as accessReviews from './accessReviews.ts';
import * as issues from './issues.ts';
import * as auditor from './auditor.ts';
import * as reports from './reports.ts';
import * as admin from './admin.ts';
import * as workflow from './workflow.ts';
import * as complychat from './complychat.ts';
import * as cyberAssurance from './cyberAssurance.ts';
import * as cyberNative from './cyberNative.ts';
import * as misc from './misc.ts';
import * as dashboard from './dashboard.ts';
import * as tasks from './tasks.ts';
import * as frameworks from './frameworks.ts';
import * as evidence from './evidence.ts';
import * as assessments from './assessments.ts';
import * as bcm from './bcm.ts';
import * as regulatory from './regulatory.ts';

const groups: Array<{ LEAVES: Record<string, RouteExtra>; PAGES: PageSpec[] }> = [dashboard, tasks, frameworks, evidence, assessments, bcm, regulatory];

// The rest of the app (R-REG, 2026-11-01): one file per module, listed here in its own array so a group added to the line above merges cleanly.
const registry: Array<{ LEAVES: Record<string, RouteExtra>; PAGES: PageSpec[] }> = [risk, vendor, controls, accessReviews, issues, auditor, reports, admin, workflow, complychat, cyberAssurance, cyberNative, misc];
const every = groups.concat(registry);

export const MODULE_LEAVES: Record<string, RouteExtra> = Object.assign({}, ...every.map((group) => group.LEAVES));
export const MODULE_PAGES: PageSpec[] = every.reduce<PageSpec[]>((all, group) => all.concat(group.PAGES), []);
