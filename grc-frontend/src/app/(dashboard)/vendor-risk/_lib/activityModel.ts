// One line of a supplier's activity trail, in the words a person reads: "S. Ali changed the tier", never "Finding #12" or "User 5". The trail is the vendor audit read
// (`GET /vendor-risk/tpra/vendors/{id}/audit`: entity, action, from, to, reason, who); this file only words it. Pure, so `node --test` runs activityModel.test.ts against it.
import { statusLabel, truncate } from '../../../../lib/format.ts';

export interface ActivityEntry {
  id: number;
  entity: string;
  action: string;
  actor_name: string | null;
  from_value: string | null;
  to_value: string | null;
  reason: string | null;
  created_at: string | null;
}

// what the entry is about, as a phrase that follows a verb
const NOUN: Record<string, string> = {
  vendor: 'the supplier', finding: 'a finding', signal: 'a monitoring signal', supplier_request: 'a request to the supplier', request: 'a request', stage: 'a lifecycle step',
  evidence: 'a piece of evidence', report: 'a report', engagement: 'an engagement', contract: 'a contract', remediation: 'a remediation task', fair_analysis: 'a risk analysis',
  assessment: 'an assessment', approval: 'an approval', soc_review: 'an assurance report', questionnaire_template: 'a questionnaire', fourth_party: 'a subprocessor',
  contact: 'a contact', alert_rule: 'an alert rule', action: 'a planned action', tiering: 'the tier', risk_acceptance: 'an accepted risk', portal_link: 'a portal link',
  obligation: 'an obligation', vendor_product: 'a watched product', vendor_link: 'a link', surface_waiver: 'a waiver', sla: 'a service level', shared_assessment: 'a shared assessment',
  shadow_app: 'a discovered app',
};

// what was done, in the past tense
const VERB: Record<string, string> = {
  create: 'added', update: 'changed', delete: 'removed', remove: 'removed', restore: 'restored', reopen: 'reopened', archive: 'archived', import: 'imported', skip: 'skipped',
  revoke: 'revoked', revoke_all: 'revoked', revoke_share: 'stopped sharing', override: 'overrode', offboard: 'started the exit of', decide: 'decided', cancel: 'cancelled',
  assign: 'assigned', submit: 'submitted', review: 'reviewed', reject: 'rejected', reactivate: 'reactivated', suspend: 'suspended', send_back: 'sent back', share: 'shared',
  start: 'started', start_remediation: 'started remediation on', renew: 'renewed', reset: 'reset', return: 'returned', verify: 'verified', triage: 'triaged', transition: 'moved',
  unblock: 'unblocked', write_up: 'wrote up', sync: 'synced', status: 'changed the status of', reorder: 'reordered', research: 'researched',
};

export interface ActivityLine {
  /** who did it ("The system" when nobody signed in did) */
  who: string;
  /** "changed the tier", "added a finding" */
  what: string;
  /** "Medium to High" / "Now Complete", then the reason; '' when there is neither */
  detail: string;
  at: string | null;
}

const sentence = (s: string): string => s.replace(/^./, (c) => c.toUpperCase());
const said = (v: string | null): string => (v == null || v === '' ? '' : truncate(statusLabel(v, ''), 80).text);

export function activityLine(a: ActivityEntry): ActivityLine {
  const noun = NOUN[a.entity] ?? 'a record';
  const verb = VERB[a.action] ?? statusLabel(a.action, 'changed').toLowerCase();
  const from = said(a.from_value);
  const to = said(a.to_value);
  const change = from && to ? `${from} to ${to}` : to ? `Now ${to}` : '';
  const why = a.reason ? truncate(a.reason, 160).text : '';
  return { who: (a.actor_name ?? '').trim() || 'The system', what: `${verb} ${noun}`, detail: [change, why].filter(Boolean).map((p, i) => (i === 0 ? sentence(p) : p)).join(' · '), at: a.created_at };
}
