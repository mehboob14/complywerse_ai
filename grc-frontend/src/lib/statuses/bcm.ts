// The words of the Business Continuity module (app/(dashboard)/bcm): one registry per kind of word, on the same tone model as the Governance registries in
// status.ts (kept in its own file so the two never touch the same lines). Every word the server accepts is registered here (bcm.test.ts re-reads the lists in
// backend/grc/modules/bcm/routers/_common.py), and every word keeps the label the module has always shown ("Under Review", "Full Failover", "BCP Confirmed").
// A word nobody registered is neutral with its own readable label, as everywhere in the registry.
//
// Tones, one reading of what a word means to the person looking at the row (the Governance reading): pending = waiting for someone or for its day,
// progress = moving, success = in force or done, warning = needs a look, danger = refused, overdue or critical, neutral = at rest.
// The words that only name a kind (a drill's type, a strategy's type, a cadence) have no meaning to colour: they are registered neutral, for their label.
import { defineStatuses, type Statuses } from '../status.ts';

/** BcmPlan.status: draft, under_review, approved, retired (models/_44; the plan moves freely between them, `approved` needs RTO and RPO). */
export const planStatus = defineStatuses('continuity plan', {
  draft: 'neutral',
  under_review: { tone: 'pending', label: 'Under Review' },
  approved: 'success',
  retired: 'neutral',
});

/** BcmDrill.status plus the derived `overdue` (the server replaces `scheduled` by `overdue` in `effective_status` once the scheduled day has begun). */
export const drillStatus = defineStatuses('drill', {
  scheduled: 'pending',
  in_progress: { tone: 'progress', label: 'In Progress' },
  completed: 'success',
  under_review: { tone: 'pending', label: 'Under Review' },
  closed: 'neutral',
  cancelled: 'neutral',
  overdue: 'danger',
});

/** A finding's severity and a BIA process's or dependency's criticality: the same four words. The tones are the platform's priority scale (status.ts `priority`). */
export const severity = defineStatuses('severity', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
});

/** BcmRecoveryStrategy.status. */
export const strategyStatus = defineStatuses('recovery strategy', {
  proposed: 'pending',
  approved: 'success',
  rejected: 'danger',
});

/** A finding's remediation, read live from its linked Issue/CAPA (the Issue's workflow_state), or `open` when it has no issue yet (_common.py `finding_issue_view`). */
export const findingStatus = defineStatuses('finding remediation', {
  open: 'warning',
  new: 'pending',
  triage: 'pending',
  in_progress: { tone: 'progress', label: 'In Progress' },
  resolution: 'progress',
  closure_review: { tone: 'pending', label: 'Closure Review' },
  closed: 'success',
  cancelled: 'neutral',
});

// ── words that name a kind, not a state ───────────────────────────────────────────────────────────────────────────────────────────────────
/** BcmDrill.drill_type. */
export const drillType = defineStatuses('drill type', {
  tabletop: 'neutral',
  simulation: 'neutral',
  full_failover: { tone: 'neutral', label: 'Full Failover' },
  call_tree: { tone: 'neutral', label: 'Call Tree' },
});

/** BcmDrill.source_type: a rehearsed test or a real activation. */
export const sourceType = defineStatuses('drill source', {
  scheduled_test: { tone: 'neutral', label: 'Scheduled Test' },
  incident_triggered: { tone: 'neutral', label: 'Incident-Triggered' },
});

/** BcmRecoveryStrategy.strategy_type. */
export const strategyType = defineStatuses('strategy type', {
  alternate_site: { tone: 'neutral', label: 'Alternate Site' },
  remote_work: { tone: 'neutral', label: 'Remote Work' },
  manual_workaround: { tone: 'neutral', label: 'Manual Workaround' },
  vendor_failover: { tone: 'neutral', label: 'Vendor Failover' },
  warm_site: { tone: 'neutral', label: 'Warm Site' },
  cold_site: { tone: 'neutral', label: 'Cold Site' },
  hot_site: { tone: 'neutral', label: 'Hot Site' },
});

/** BcmBiaDependency.dependency_type. */
export const dependencyType = defineStatuses('dependency type', {
  system: 'neutral',
  vendor: 'neutral',
  staff: 'neutral',
  facility: 'neutral',
});

/** BcmBiaDependency.external_bcp_status (a vendor's own continuity plan). "N/A" is a value a person chooses, not a missing one, and it is the label it has always had. */
export const externalBcp = defineStatuses('vendor BCP', {
  confirmed: { tone: 'neutral', label: 'BCP Confirmed' },
  requested: { tone: 'neutral', label: 'BCP Requested' },
  not_provided: { tone: 'neutral', label: 'No BCP' },
  na: { tone: 'neutral', label: 'N/A' },
});

/** BcmPlan.testing_frequency. */
export const frequency = defineStatuses('testing frequency', {
  annual: 'neutral',
  semi_annual: { tone: 'neutral', label: 'Semi-Annual' },
  quarterly: 'neutral',
});

// ── where a day stands, for the registers' "when" facets (a plan's review day, a drill's scheduled day, a finding's due day) ─────────────────
/** A day against today: before it (overdue), within the next 30 days (soon), further off (later), or none was set. These are readings of a date, not stored words. */
export const dayWindow = defineStatuses('day window', {
  overdue: 'danger',
  soon: { tone: 'warning', label: 'Next 30 days' },
  later: 'neutral',
  none: { tone: 'neutral', label: 'No date' },
});

/** Whether a plan has been tested lately: a drill scheduled or made within the last 12 months (the Overview's coverage rule), or none in that time, or none ever. */
export const testedState = defineStatuses('plan testing', {
  recent: { tone: 'success', label: 'Tested in the last 12 months' },
  lapsed: { tone: 'warning', label: 'Not tested in 12 months' },
  never: { tone: 'danger', label: 'Never tested' },
});

/** What a select offers for a registry: its words in order, each with its label (what the form stores is the word). */
export const optionsOf = (registry: Statuses): Array<{ value: string; label: string }> => registry.words.map((value) => ({ value, label: registry.label(value) }));
