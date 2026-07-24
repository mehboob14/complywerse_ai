// src/app/(dashboard)/compliance/access-reviews/pipeline.ts
// Single source of truth for the gated 6-stage pipeline + display helpers.
// Keep this in lockstep with the backend status machine in
// access_review_router.py (_assert_not_completed and the stage endpoints).

import type { CampaignStatus, StageIndex, Severity, Decision } from './types';

export interface StageDef {
  n: StageIndex;
  key: 'sync' | 'sample' | 'checks' | 'certify' | 'report' | 'close';
  label: string;
  desc: string;
}

export const STAGES: StageDef[] = [
  { n: 1, key: 'sync',    label: 'Sync population', desc: 'Pull every in-scope user from connected sources' },
  { n: 2, key: 'sample',  label: 'Draw sample',     desc: 'Freeze a snapshot of the sampled users' },
  { n: 3, key: 'checks',  label: 'Run checks',      desc: 'Apply enabled rules to produce findings' },
  { n: 4, key: 'certify', label: 'Certify',         desc: 'Decide approve / revoke / exception per user' },
  { n: 5, key: 'report',  label: 'Report',          desc: 'Generate the verdict and export pack' },
  { n: 6, key: 'close',   label: 'Close',           desc: 'Seal as read-only audit evidence' },
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
export const severityClass: Record<Severity, string> = {
  critical: 'bg-rose-100 text-rose-700',
  high:     'bg-orange-100 text-orange-700',
  medium:   'bg-amber-100 text-amber-700',
  low:      'bg-slate-100 text-slate-600',
  info:     'bg-slate-100 text-slate-600',
};

export const decisionClass: Record<Decision, string> = {
  approved:  'bg-emerald-100 text-emerald-700',
  revoke:    'bg-rose-100 text-rose-700',
  exception: 'bg-amber-100 text-amber-700',
  pending:   'bg-slate-100 text-slate-500',
};

export const decisionLabel: Record<Decision, string> = {
  approved: 'Approved', revoke: 'Revoked', exception: 'Exception', pending: 'Pending',
};

// Risk-score buckets — a genuine data-viz scale (high→low = rose→orange→amber→
// emerald) kept distinct so reviewers can triage at a glance.
export function riskClass(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 60) return 'bg-rose-100 text-rose-700';
  if (s >= 30) return 'bg-orange-100 text-orange-700';
  if (s > 0)   return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

export const scopeLabel: Record<string, string> = {
  all: 'All users', privileged: 'Privileged', terminated: 'Terminated',
};
