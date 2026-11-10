// The words of Third-Party Vendor Risk > Monitoring (vendor-monitoring, 2026-11-10): where an alert stands, what kind of signal it is, how severe, and the outside-in grade of a supplier.
// One registry per kind of word, on the platform's tone model (lib/status.ts); a word nobody registered reads neutral with its own readable label (defineStatuses). Every word is said in
// words, never a colour alone. Pure (no React), so `node --test` runs vendorMonitoring.test.ts against it.
//
// Tones: pending = waiting for someone, progress = being worked, success = good, warning = needs a look, danger = serious, neutral = at rest or no meaning to colour.
import { defineStatuses } from '../status.ts';

/** Where a monitoring signal stands (the server's `stage`, tpra/alerts.py STAGES). Acknowledged is "seen, not worked": still open for a decision. Closed is a decision wrapped up with a note. */
export const alertStage = defineStatuses('alert stage', {
  new: { tone: 'warning', label: 'New' },
  acknowledged: { tone: 'pending', label: 'Acknowledged' },
  investigating: { tone: 'progress', label: 'Investigating' },
  confirmed: { tone: 'danger', label: 'Confirmed' },
  not_relevant: { tone: 'neutral', label: 'Not relevant' },
  closed: { tone: 'neutral', label: 'Closed' },
});

/** What a monitoring signal is about (TPRAMonitoringSignal.signal_type). A kind has no meaning to colour. */
export const signalKind = defineStatuses('signal kind', {
  breach: { tone: 'neutral', label: 'Breach' },
  adverse_media: { tone: 'neutral', label: 'Adverse media' },
  vulnerability: { tone: 'neutral', label: 'Vulnerability' },
  security_rating: { tone: 'neutral', label: 'Rating change' },
  financial: { tone: 'neutral', label: 'Financial' },
  sla: { tone: 'neutral', label: 'Service level' },
  cert_expiry: { tone: 'neutral', label: 'Certificate expiry' },
});

/** A signal's severity: the module's tier ramp, with the fifth word the feed can carry. */
export const signalSeverity = defineStatuses('signal severity', {
  critical: 'danger', high: 'warning', medium: 'progress', low: 'neutral', info: { tone: 'neutral', label: 'Info' },
});

/** The outside-in grade of a supplier: A best, F worst, HIGHER score is better. It is not the assessment grade (vendorGrade: lower residual is better), so the scale is in the word. */
export const outsideInGrade = defineStatuses('outside-in grade', {
  a: { tone: 'success', label: 'Outside-in A' }, b: { tone: 'success', label: 'Outside-in B' }, c: { tone: 'warning', label: 'Outside-in C' },
  d: { tone: 'danger', label: 'Outside-in D' }, f: { tone: 'danger', label: 'Outside-in F' },
  none: { tone: 'neutral', label: 'Not rated' },
});

/** The stages in the order a signal moves through them. */
export const STAGE_ORDER = ['new', 'acknowledged', 'investigating', 'confirmed', 'not_relevant', 'closed'] as const;
export type Stage = (typeof STAGE_ORDER)[number];

/** The kinds the server works as cases (alerts.py ALERT_TYPES); the others are acknowledged, dismissed or raised as a finding. */
export const ALERT_KINDS = ['breach', 'adverse_media', 'vulnerability'] as const;
/** Every kind, the alert kinds first. */
export const KIND_ORDER = ['breach', 'adverse_media', 'vulnerability', 'security_rating', 'financial', 'sla', 'cert_expiry'] as const;
/** Most severe first. */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
/** The grades, best first. */
export const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'] as const;
