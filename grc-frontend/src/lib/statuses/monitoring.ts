// The words of the Risk Management monitoring pages (KRIs, incidents, mitigation actions, risk appetite, dependencies), one registry per kind of word, on the same tone
// model as lib/status.ts (kept in its own file so builders of other groups never touch the same lines). Every word the server writes is registered (monitoring.test.ts re-reads
// the comments of models/_11_enterprise_risk_management.py), every word is said in full, and a word nobody registered reads neutral with a readable label.
// Tones: pending = waiting for someone, progress = moving, success = done or healthy, warning = needs a look, danger = late, refused or off target, neutral = at rest.
import { defineStatuses } from '../status.ts';

/** A KRI's state (lib/erm/kri.ts `kriState`): the rag words of status.ts, plus the two the register needs. */
export const kriStatus = defineStatuses('KRI state', {
  red: { tone: 'danger', label: 'Off target' },
  amber: { tone: 'warning', label: 'Watch' },
  green: { tone: 'success', label: 'On track' },
  unrated: { tone: 'neutral', label: 'Not rated' },
  no_value: { tone: 'neutral', label: 'No value' },
});

/** RiskIncident.status: open, investigating, contained (the model's word) / mitigating (the page's word), resolved, closed. */
export const incidentStatus = defineStatuses('incident', {
  open: 'danger',
  investigating: 'warning',
  mitigating: 'progress',
  contained: 'progress',
  resolved: 'success',
  closed: 'neutral',
});

/** RiskMitigationAction.status. "overdue" is also what an open action past its date reads (lib/erm/mitigation.ts `shownStatus`). */
export const mitigationStatus = defineStatuses('mitigation action', {
  open: 'pending',
  in_progress: { tone: 'progress', label: 'In progress' },
  completed: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
});

/** RiskMitigationAction.action_type: what kind of treatment it is. A kind has no meaning to colour. */
export const treatmentType = defineStatuses('treatment', {
  mitigate: 'neutral',
  transfer: 'neutral',
  avoid: 'neutral',
  accept: 'neutral',
});

/** An incident's severity, an action's priority and a score band: the same four words, on the platform's priority scale (status.ts `priority`). */
export const severity = defineStatuses('severity', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
});

/** RiskAppetiteConfig.appetite_level (appetite.py APPETITE_LEVELS), from the least risk accepted to the most. More appetite is more exposure, so the tone climbs with it. */
export const appetiteLevel = defineStatuses('appetite', {
  averse: 'success',
  minimal: 'success',
  cautious: 'progress',
  moderate: 'warning',
  open: 'danger',
  hungry: 'danger',
});

/** RiskDependency.dependency_type: the words the page offers; the model comment lists causes, aggravates, mitigates, related. A kind has no meaning to colour. */
export const dependencyType = defineStatuses('dependency', {
  causes: { tone: 'neutral', label: 'Causes' },
  caused_by: { tone: 'neutral', label: 'Is caused by' },
  amplifies: { tone: 'neutral', label: 'Amplifies' },
  aggravates: { tone: 'neutral', label: 'Aggravates' },
  mitigates: { tone: 'neutral', label: 'Reduces' },
  related: { tone: 'neutral', label: 'Is related to' },
});

/** Options for a select: every word of a registry with its label, in the order registered. */
export const optionsOf = (registry: { words: readonly string[]; label: (w: string) => string }, only?: readonly string[]): Array<{ value: string; label: string }> =>
  registry.words.filter((w) => !only || only.includes(w)).map((value) => ({ value, label: registry.label(value) }));
