// The words of Statutory Audit: where an observation stands (the organisation's OWN status levels, with the five the platform ships as the fallback), how urgent it is,
// what kind of observation it is, where it stands against its SLA, and what a line of its history says. One registry per kind of word, built with defineStatuses
// (lib/status.ts), so a pill always has its word and a word nobody registered is neutral with a readable label. Pure, so `node --test` runs statutory.test.ts.
//
// The status LEVELS belong to the organisation (Settings > Statuses: key, label, tone, terminal); `levelPill` reads them first. A tone the Settings page calls "amber" is the
// platform's "warning", "blue" is "progress", and so on (`levelTone`), so a level the organisation added reads in the same colours as everything else on the platform.
import { defineStatuses, norm, type Tone } from '../status.ts';

// AuditObservation.status: services/module_settings.py MODULES["statutory_audit"] ships open, in_progress, complied, closed, cancelled (the tones are the shipped ones).
export const observationStatus = defineStatuses('audit observation', {
  open: { tone: 'warning', label: 'Open' },
  in_progress: { tone: 'progress', label: 'In progress' },
  complied: { tone: 'success', label: 'Complied' },
  closed: { tone: 'neutral', label: 'Closed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
});

// AuditObservation.priority (statutory_audit.py PRIORITIES): the platform's one priority scale.
export const observationPriority = defineStatuses('audit observation priority', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
});

// AuditObservation.observation_type (statutory_audit.py OBS_TYPES). A finding is what the regulator or auditor found wrong; a recommendation is advice.
export const observationType = defineStatuses('audit observation type', {
  requirement: { tone: 'progress', label: 'Requirement' },
  observation: { tone: 'neutral', label: 'Observation' },
  finding: { tone: 'warning', label: 'Finding' },
  recommendation: { tone: 'pending', label: 'Recommendation' },
});

// services/module_settings.sla_state: where an observation stands against the organisation's SLA, computed when it is read.
export const slaState = defineStatuses('audit observation SLA', {
  breached: { tone: 'danger', label: 'Overdue' },
  due_soon: { tone: 'warning', label: 'Due soon' },
  on_track: { tone: 'success', label: 'On track' },
  paused: { tone: 'neutral', label: 'Paused' },
  closed: { tone: 'neutral', label: 'Closed' },
  no_due_date: { tone: 'neutral', label: 'No due date' },
});

// AuditObservationActivity.activity_type: what the timeline draws a line for.
export const activityKind = defineStatuses('audit observation activity', {
  created: { tone: 'success', label: 'Registered' },
  update: { tone: 'neutral', label: 'Edited' },
  status_change: { tone: 'progress', label: 'Status changed' },
  link: { tone: 'pending', label: 'Linked' },
  unlink: { tone: 'neutral', label: 'Unlinked' },
});

// The tone names of Settings (module_settings.TONES) in the platform's six tones.
const TONE_OF: Readonly<Record<string, Tone>> = { slate: 'neutral', blue: 'progress', amber: 'warning', emerald: 'success', rose: 'danger', violet: 'pending' };

/** A Settings tone ("amber") as the platform's tone ("warning"); a name nobody knows is neutral. */
export const levelTone = (name?: string | null): Tone => (name && Object.prototype.hasOwnProperty.call(TONE_OF, name) ? TONE_OF[name] : 'neutral');

export interface LevelLike { key: string; label?: string; tone?: string }

/** What a status pill takes for an observation's status: the organisation's own level when it has one (its label and tone), else the platform's word. */
export function levelPill(levels: readonly LevelLike[] | null | undefined, word?: string | null): { tone: Tone; label: string } {
  const key = norm(word);
  const level = (levels ?? []).find((l) => norm(l.key) === key);
  if (level) return { tone: level.tone ? levelTone(level.tone) : observationStatus.tone(word), label: level.label?.trim() || observationStatus.label(word) };
  return { tone: observationStatus.tone(word), label: observationStatus.label(word) };
}
