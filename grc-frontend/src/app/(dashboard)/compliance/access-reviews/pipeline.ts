// src/app/(dashboard)/compliance/access-reviews/pipeline.ts
// Single source of truth for the gated 6-stage pipeline + display helpers.
// Keep this in lockstep with the backend status machine in
// access_review_router.py (_assert_not_completed and the stage endpoints).

import type { Campaign, CampaignStatus, StageIndex, Severity, Decision } from './types';

export interface StageDef {
  n: StageIndex;
  key: 'sync' | 'sample' | 'checks' | 'certify' | 'report' | 'close';
  label: string;
  desc: string;
}

export const STAGES: StageDef[] = [
  { n: 1, key: 'sync',    label: 'Collect people', desc: 'Gather every in-scope identity from the connected sources.' },
  { n: 2, key: 'sample',  label: 'Draw sample',    desc: 'Freeze a snapshot of the identities to certify.' },
  { n: 3, key: 'checks',  label: 'Run rules',      desc: 'Test the sample and the connected estate against the rules.' },
  { n: 4, key: 'certify', label: 'Certify',        desc: 'Decide approve, revoke or exception for each identity.' },
  { n: 5, key: 'report',  label: 'Report',         desc: 'Read the verdict and export the evidence.' },
  { n: 6, key: 'close',   label: 'Seal',           desc: 'Lock the review as read-only audit evidence.' },
];

/** Map the backend campaign.status to a 1..6 stage index. */
export function statusToStage(status: CampaignStatus): StageIndex {
  // Real backend statuses (verified): draft → population_built → sampled → in_review → completed.
  // Stages: 1 sync · 2 sample · 3 run-checks · 4 certify · 5 report · 6 close.
  switch (status) {
    case 'draft':            return 1;  // population not yet synced
    case 'population_built': return 2;  // population synced, draw sample next
    case 'sampled':          return 3;  // snapshot frozen, run checks next
    case 'in_review':        return 4;  // findings produced, certifying
    case 'completed':        return 6;  // sealed (report available throughout in_review+)
    default:                 return 1;
  }
}

export type StageState = 'done' | 'current' | 'locked';

export function stageState(n: StageIndex, current: StageIndex, closed: boolean): StageState {
  if (closed || n < current) return 'done';
  if (n === current) return 'current';
  return 'locked';
}

export const isClosed = (status: CampaignStatus) => status === 'completed';

// ---- display helpers (Tailwind classes consistent with the app) ----------
// Severity is a genuine data-viz scale — critical→low runs rose→orange→amber→
// slate so the gradient stays legible; info maps to neutral slate.
// Text is the -800 shade of its tint so every pairing is at least 4.5:1.
export const severityClass: Record<Severity, string> = {
  critical: 'bg-rose-100 text-rose-800',
  high:     'bg-orange-100 text-orange-800',
  medium:   'bg-amber-100 text-amber-900',
  low:      'bg-[#eef1f4] text-slate-700',
  info:     'bg-[#eef1f4] text-slate-700',
};

export const decisionClass: Record<Decision, string> = {
  approved:  'bg-emerald-100 text-emerald-800',
  revoke:    'bg-rose-100 text-rose-800',
  exception: 'bg-amber-100 text-amber-900',
  pending:   'bg-[#eef1f4] text-slate-700',
};

export const decisionLabel: Record<Decision, string> = {
  approved: 'Approved', revoke: 'Revoked', exception: 'Exception', pending: 'Pending',
};

// Risk-score buckets — a genuine data-viz scale (high→low = rose→orange→amber→
// emerald) kept distinct so reviewers can triage at a glance.
export function riskClass(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 60) return 'bg-rose-100 text-rose-800';
  if (s >= 30) return 'bg-orange-100 text-orange-800';
  if (s > 0)   return 'bg-amber-100 text-amber-900';
  return 'bg-emerald-100 text-emerald-800';
}

export const scopeLabel: Record<string, string> = {
  user_access: 'All users', privileged_access: 'Privileged', terminated_access: 'Terminated',
  // what campaigns created before the UI spoke the backend's words carry
  all: 'All users', privileged: 'Privileged', terminated: 'Terminated',
};

export const statusLabel: Record<CampaignStatus, string> = {
  draft: 'Not started', population_built: 'People collected', sampled: 'Sample drawn',
  in_review: 'Certifying', completed: 'Sealed',
};

/** "EMEA Saudi Arabia ECC-1 2018" reads as "ECC-1 2018" on a chip. */
export function shortFramework(name: string): string {
  return name.replace(/^(EMEA|APAC|AMER|Americas)\s+/, '').replace(/^(Saudi Arabia|Australia|Japan|Canada|Spain)\s+/, '')
    .replace(/\s*\(used for SOC 2\)/, ' (SOC 2)');
}

/** "ECC-1 2018 rules (36)", "Every enabled rule (18)", "5 picked rules". */
export function ruleSetLabel(c: Pick<Campaign, 'rule_scope' | 'rule_framework' | 'rule_framework_name' | 'rules_run' | 'rule_ids'>): string {
  const n = c.rules_run?.length;
  const count = n !== undefined ? ` (${n})` : '';
  if (c.rule_scope === 'framework') return `${shortFramework(c.rule_framework_name || c.rule_framework || 'Framework')} rules${count}`;
  if (c.rule_scope === 'custom') return `${n ?? c.rule_ids?.length ?? 0} picked rules`;
  return `Every enabled rule${count}`;
}
