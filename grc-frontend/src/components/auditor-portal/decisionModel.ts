// What the Decision sheet decides, apart from React so `node --test` can pin it (decisionModel.test.ts): the two decisions, when the remarks are required,
// the sentences that name a problem or an earlier decision. The sheet (DecisionSheet.tsx) draws it; the Auditor Portal's review queue is its first user and
// the Issue Register's validation uses it too, with its own words and its own rule for the remarks.
import { formatCount, formatDate } from '../../lib/format.ts';

/** The two things an auditor can decide. The server writes "rejected"; a person reads it as "Turned down" (lib/statuses/auditPortal.ts). */
export type Decision = 'approved' | 'rejected';

export interface RemarksRule {
  /** the decision that needs the remarks written: turning down (the default), approving too, or neither */
  requiredFor: Decision | 'both' | 'none';
  /** the longest the server takes (reviews.py: 4000) */
  max: number;
  /** what is said when the remarks are needed and missing, for a page whose words differ from "turn down" (the Issue Register's validation says "not passed") */
  requiredMessage?: string;
}

export const DEFAULT_RULE: RemarksRule = { requiredFor: 'rejected', max: 4000 };

export function ruleOf(partial?: Partial<RemarksRule> | null): RemarksRule {
  return { requiredFor: partial?.requiredFor ?? DEFAULT_RULE.requiredFor, max: partial?.max && partial.max > 0 ? partial.max : DEFAULT_RULE.max, requiredMessage: partial?.requiredMessage };
}

/** What the remarks are sent as: trimmed. An empty note is an empty string, never a space. */
export const cleanRemarks = (remarks: string | null | undefined): string => String(remarks ?? '').trim();

export const remarksRequired = (decision: Decision, rule: RemarksRule): boolean => rule.requiredFor === 'both' || rule.requiredFor === decision;

/** The sentence that says why a decision cannot be saved yet, or null when it can. It says what to do, not what the server would refuse. */
export function remarksProblem(decision: Decision, remarks: string, rule: RemarksRule = DEFAULT_RULE): string | null {
  const text = cleanRemarks(remarks);
  if (remarksRequired(decision, rule) && text.length === 0) {
    if (rule.requiredMessage) return rule.requiredMessage;
    return decision === 'rejected' ? 'Say why it is turned down, so the person who sent it knows what to change.' : 'Add a note before you approve.';
  }
  if (text.length > rule.max) return `Keep the note to ${formatCount(rule.max)} characters or fewer (it is ${formatCount(text.length)}).`;
  return null;
}

export interface PreviousDecision {
  /** the word the server wrote (approved, rejected) */
  decision: string;
  by?: string | null;
  /** the server's naive-UTC moment */
  at?: string | null;
  remarks?: string | null;
}

/** "Turned down by Ada Admin on 12 Nov 2026" - who and when are left out when they are not recorded; null when nothing was decided yet. */
export function previousLine(previous: PreviousDecision | null | undefined, label: (word: string) => string): string | null {
  if (!previous || !previous.decision) return null;
  const who = previous.by ? ` by ${previous.by}` : '';
  const when = previous.at ? ` on ${formatDate(previous.at)}` : '';
  return `${label(previous.decision)}${who}${when}`;
}
