// The words of Regulatory Changes and the Regulatory Feed (app/(dashboard)/governance/regulatory-changes, .../regulatory-feeds): one registry per kind of word, on the same tone model
// as the other registries (status.ts), kept in its own file. regulatory.test.ts re-reads the lists the server accepts (routers/regulatory_changes.py, models/_28, _68, _32) so a word the
// server starts writing fails a test until it is registered here. A word nobody registered is neutral with its own readable label, as everywhere in the registry.
//
// Tones: pending = waiting for someone, progress = moving, success = in force or done, warning = needs a look, danger = refused, late or failed, neutral = at rest or a kind.
// Priorities use the platform's scale (status.ts `priority`: critical danger, high warning, medium progress, low neutral): this file does not repeat it.
import { defineStatuses, type Statuses } from '../status.ts';

/** RegulatoryChange.status. `closed` is what Close writes; `completed` is what the status field accepts (the screens treat both as finished). */
export const changeStatus = defineStatuses('regulatory change', {
  identified: 'pending',
  under_assessment: { tone: 'progress', label: 'Under assessment' },
  implementation: 'progress',
  completed: 'success',
  closed: 'success',
  not_applicable: { tone: 'neutral', label: 'Not applicable' },
});

/** RegulatoryObligation.compliance_status. The old pill said "Partial" and "N/A"; the full words are used now. */
export const compliance = defineStatuses('obligation compliance', {
  not_assessed: { tone: 'neutral', label: 'Not assessed' },
  compliant: 'success',
  partially_compliant: { tone: 'warning', label: 'Partially compliant' },
  non_compliant: { tone: 'danger', label: 'Non-compliant' },
  not_applicable: { tone: 'neutral', label: 'Not applicable' },
});

/** RegulatoryImplementationTask.status. */
export const taskStatus = defineStatuses('regulatory task', {
  pending: 'neutral',
  in_progress: { tone: 'progress', label: 'In progress' },
  blocked: 'danger',
  completed: 'success',
});

/** A control link on an obligation (RegulatoryLink.status): the platform suggests, a person decides. */
export const linkStatus = defineStatuses('control link', {
  proposed: { tone: 'pending', label: 'Suggested' },
  confirmed: 'success',
  rejected: { tone: 'neutral', label: 'Not this one' },
});

/** RegulatoryFeedItem.status. `processed` is an item turned into a regulatory change; the screens say "Converted" next to the Convert button. `ignored` is "Not relevant". */
export const feedItemStatus = defineStatuses('feed item', {
  new: 'pending',
  analyzed: 'progress',
  processed: { tone: 'success', label: 'Converted' },
  ignored: { tone: 'neutral', label: 'Not relevant' },
  error: 'danger',
});

/** The state of the AI's reading of a circular (regulatory_engine.analysis_state). */
export const analysisStatus = defineStatuses('circular reading', {
  queued: { tone: 'pending', label: 'Starting' },
  running: { tone: 'progress', label: 'Reading' },
  done: { tone: 'success', label: 'Read' },
  failed: 'danger',
});

/** Impact on one assessment. */
export const gapState = defineStatuses('impact assessment', {
  gap: { tone: 'danger', label: 'Gap' },
  covered: 'success',
});

// ── words that name a kind, not a state ───────────────────────────────────────────────────────────────────────────────────────────────────
/** RegulatoryImplementationTask.task_type. */
export const taskType = defineStatuses('task type', {
  policy_update: { tone: 'neutral', label: 'Policy update' },
  control_update: { tone: 'neutral', label: 'Control update' },
  process_change: { tone: 'neutral', label: 'Process change' },
  training: 'neutral',
  communication: 'neutral',
});

/** RegulatoryObligation.obligation_type (regulatory_engine.OBLIGATION_TYPES). */
export const obligationType = defineStatuses('obligation type', {
  requirement: 'neutral',
  prohibition: 'neutral',
  reporting: 'neutral',
  deadline: 'neutral',
  governance: 'neutral',
  disclosure: 'neutral',
  record_keeping: { tone: 'neutral', label: 'Record keeping' },
});

/** RegulatoryImpactAssessment.assessment_type. */
export const assessmentKind = defineStatuses('assessment kind', {
  policy: 'neutral',
  control: 'neutral',
  process: 'neutral',
  technology: 'neutral',
});

export const optionsOf = (registry: Statuses): Array<{ value: string; label: string }> => registry.words.map((value) => ({ value, label: registry.label(value) }));
