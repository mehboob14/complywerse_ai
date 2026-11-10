// What the vendor record's SHELL (vendors/[id]/page.tsx and its head, strip and "At a glance" card) works out: the tabs with their counts, which parameters a tab click drops, who the
// lifecycle's next step goes to, and when the next review falls in words. vendorRecordModel.ts holds the address rules and the engagement arithmetic; this file is what the shell adds
// (vendor-record, 2026-11-10). Pure, so `node --test` runs recordShellModel.test.ts against it.
import { formatRelative } from '../../../../lib/format.ts';
import { TABS, daysUntil, nextReview, type Scope, type TabKey } from './vendorRecordModel.ts';

// ── tabs ─────────────────────────────────────────────────────────────────────

export interface RecordTab { key: TabKey; label: string; count?: number }
export interface TabCounts {
  /** open findings of the vendor (open or in remediation), once the Findings list has been read */
  findings?: number | null;
  /** questionnaires sent to the vendor, once the Assessments cards have been read */
  assessments?: number | null;
}

/** The six tabs in the order people know them. A count is drawn only where the work is: more than none, and only once it is known (a list that has not loaded draws no badge, never a 0). */
export function recordTabs(counts: TabCounts = {}): RecordTab[] {
  const some = (n?: number | null) => (typeof n === 'number' && n > 0 ? n : undefined);
  return TABS.map((t) => {
    const count = t.key === 'findings' ? some(counts.findings) : t.key === 'assessments' ? some(counts.assessments) : undefined;
    return count ? { key: t.key, label: t.label, count } : { key: t.key, label: t.label };
  });
}

/** The parameters that act once (a stage to open, a finding to scroll to, the tiering dialog, a request): a tab click drops them so they do not fire again. */
export const ONE_SHOT = ['stage', 'finding', 'tier', 'request'] as const;

/** The address patch a tab click makes: the tab, and every one-shot parameter cleared ('' leaves a name out of the address). */
export function tabPatch(key: TabKey): Record<string, string> {
  const patch: Record<string, string> = { tab: key };
  for (const name of ONE_SHOT) patch[name] = '';
  return patch;
}

/** How many of a vendor's findings are still open (open or in remediation); null while the list has not been read. */
export function openFindingCount(items?: ReadonlyArray<{ status?: string | null }> | null): number | null {
  if (!items) return null;
  return items.filter((f) => f.status === 'open' || f.status === 'in_remediation').length;
}

// ── "Next up" ────────────────────────────────────────────────────────────────

/** What the next-stage read returns (lifecycleApi.NextStage), as far as the strip needs it. */
export interface NextStageLike {
  stage_key: string | null;
  stage_label: string | null;
  roles: Array<{ key: string; label: string; members: Array<{ name: string }>; missing: boolean }>;
  anyone_who_can_approve: boolean;
}

export interface NextUp {
  stage: string;
  /** the people who hold a role of the stage, by role: "S. Ali" (Security) */
  heldBy: Array<{ role: string; names: string }>;
  /** nobody holds a role, but anyone allowed to approve vendors can take the step */
  anyApprover: boolean;
  /** roles nobody holds on the roster */
  missing: string[];
}

/** Who the lifecycle's next step goes to; null when the supplier has no next step to show. */
export function nextUp(data?: NextStageLike | null): NextUp | null {
  if (!data?.stage_key || !data.stage_label) return null;
  const heldBy = data.roles.filter((r) => r.members.length > 0).map((r) => ({ role: r.label, names: r.members.map((m) => m.name).join(', ') }));
  return { stage: data.stage_label, heldBy, anyApprover: heldBy.length === 0 && data.anyone_who_can_approve, missing: data.roles.filter((r) => r.missing).map((r) => r.label) };
}

/** The strip's sentence: "Approval goes to S. Ali (Security), L. Ng (Legal)"; a role nobody holds is said after it ("No Legal on the roster"). */
export function nextUpText(n: NextUp): string {
  const gap = n.missing.length > 0 ? `No ${n.missing.join(' or ')} on the roster` : '';
  if (n.heldBy.length > 0) return `${n.stage} goes to ${n.heldBy.map((h) => `${h.names} (${h.role})`).join(', ')}${gap ? `. ${gap}` : ''}`;
  if (n.anyApprover) return `${n.stage} goes to anyone who can approve vendors${gap ? `. ${gap}` : ''}`;
  return gap ? `${n.stage}. ${gap}` : n.stage;
}

// ── the next review ──────────────────────────────────────────────────────────

export interface ReviewWords { text: string; tone: 'danger' | 'warning' | 'neutral' }

/** "Reassessment in 41 days" (a month or less is a warning, a date that has passed is red): the earliest review among the engagements in use, else the supplier's own date; before there is a tier there is none. */
export function reviewWords(items: Scope[] | undefined, fallback: string | null | undefined, today: Date = new Date()): ReviewWords {
  const next = nextReview(items, fallback);
  const days = daysUntil(next, today);
  if (!next || days == null) return { text: 'Reassessment is set once it is tiered', tone: 'neutral' };
  const when = formatRelative(next, today);
  if (days < 0) return { text: `Reassessment overdue, was due ${when}`, tone: 'danger' };
  return { text: `Reassessment ${when}`, tone: days <= 30 ? 'warning' : 'neutral' };
}

// ── the head ─────────────────────────────────────────────────────────────────

export const BACK = { href: '/vendor-risk/vendors', label: 'Vendors' } as const;

/** The engagement picker is drawn on the Lifecycle and Assessments tabs, and only when there is more than one use to pick from. */
export const showsPicker = (tab: TabKey, openCount: number): boolean => (tab === 'lifecycle' || tab === 'assessments') && openCount > 1;

/** Facts under the name, in order: type, industry, business unit (the website is a link of its own). */
export const metaLine = (parts: string[]): string => parts.filter(Boolean).join(' · ');
