// The status words of the Projects module (IS Projects: `app/(dashboard)/is-projects`), one registry per record type, on the same tone model as the
// Governance registries in status.ts (kept apart so the two files can grow without touching each other). The words are the ones the pages offer in
// their selects (is-projects/_model.ts lists them) plus the two the AI "apply" step writes ("Not Started"); projectStatus.test.ts keeps the two lists equal.
// Tones: pending = waiting to start, progress = moving, success = done or in force, warning = needs a look, danger = blocked, late or refused,
// neutral = at rest. A word nobody registered is neutral with its own readable label (never a guess), as everywhere in the registry.
import { defineStatuses } from './status.ts';

/** ISProject.status: Planning, In Progress, On Hold, Completed, Cancelled. */
export const projectStatus = defineStatuses('project', {
  planning: 'pending',
  in_progress: 'progress',
  on_hold: 'warning',
  completed: 'success',
  cancelled: 'neutral',
});

/** ISProject.health (and a status update's health assessment): On Track, At Risk, Off Track. */
export const projectHealth = defineStatuses('project health', {
  on_track: 'success',
  at_risk: 'warning',
  off_track: 'danger',
});

/** ISProjectTask.status. "Not Started" is written by the AI plan; "Completed" and "Under Review" are read by the server's completion rule. */
export const taskStatus = defineStatuses('project task', {
  to_do: 'neutral',
  not_started: 'neutral',
  in_progress: 'progress',
  in_review: 'pending',
  under_review: 'pending',
  done: 'success',
  completed: 'success',
  blocked: 'danger',
});

/** ISProjectMilestone.status. "Not Started" is written by the AI plan. */
export const milestoneStatus = defineStatuses('project milestone', {
  pending: 'pending',
  not_started: 'neutral',
  in_progress: 'progress',
  completed: 'success',
  delayed: 'danger',
});

/** ISProjectRisk.status. */
export const riskStatus = defineStatuses('project risk', {
  open: 'warning',
  mitigated: 'progress',
  closed: 'neutral',
  resolved: 'success',
});

/** ISProjectBudgetItem.status. */
export const budgetStatus = defineStatuses('project budget', {
  pending: 'pending',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
});

/** ISProjectComplianceMapping.coverage_status. */
export const coverageStatus = defineStatuses('project coverage', {
  verified: 'success',
  implemented: 'progress',
  in_progress: 'pending',
  planned: 'neutral',
  not_applicable: 'neutral',
});

/** ISProjectDependency.status. */
export const dependencyStatus = defineStatuses('project dependency', {
  active: 'progress',
  resolved: 'success',
  blocked: 'danger',
  cancelled: 'neutral',
});
