/**
 * What the screens that start a journey need to know about the gate, without a server or a screen: whether a framework's journey waits for its onboarding
 * (read from the register, the same rule as the server's gate; the server decides and says so with a refusal), how a refusal is read, and which frameworks the
 * Controls Automation scope could not start a journey for.
 */
import type { OnboardingState, Problem, RegisterRow } from '@/lib/frameworkOnboarding';

export interface GateFacts { needed: boolean; state: OnboardingState; onboardingId: number | null }

/** Does this framework's journey wait for its onboarding? Null when the register has not answered or does not list the framework (then the screen lets the server decide). */
export function gateFacts(rows: readonly RegisterRow[] | undefined, frameworkId: number): GateFacts | null {
  const row = rows?.find((r) => r.uploaded_framework_id === frameworkId);
  if (!row) return null;
  // the same rule as journeyBlocked() in lib/frameworkOnboarding.ts: no journey yet, and the onboarding neither complete nor underway
  return { needed: row.journey == null && row.state !== 'complete' && row.state !== 'underway', state: row.state, onboardingId: row.onboarding_id };
}

export interface Refusal { onboardingId: number | null; state: OnboardingState | null; message: string; open: number }

/** The gate's 409 (`code: onboarding_required`), or null for any other refusal. `open` is how many required items the server listed as unmet. */
export function refusalFromProblem(p: Pick<Problem, 'status' | 'code' | 'onboardingId' | 'state' | 'message' | 'checks'>): Refusal | null {
  if (p.status !== 409 || p.code !== 'onboarding_required') return null;
  return { onboardingId: p.onboardingId, state: p.state, message: p.message, open: p.checks.length };
}

/** The sentence under "Onboarding needed": where the onboarding is. */
export function neededWords(state: OnboardingState | null, open = 0): string {
  switch (state) {
    case 'draft': return open > 0 ? `Its onboarding is a draft with ${open} required ${open === 1 ? 'item' : 'items'} open.` : 'Its onboarding is a draft. Submit it and have it approved.';
    case 'ready': return 'Its onboarding waits for approval.';
    case 'not_started': case null: return 'Start its onboarding first.';
    default: return 'Finish its onboarding first.';
  }
}

export const startLabel = (onboardingId: number | null, state: OnboardingState | null): string =>
  onboardingId == null ? 'Start onboarding' : state === 'draft' ? 'Continue onboarding' : 'Open onboarding';

export interface BlockedJourney { slug: string; frameworkId: number | null; state: string; reason: string }

/** The `journeys.blocked` of a saved Controls Automation scope, read defensively (a server without the gate answers none). */
export function blockedFrom(journeys: unknown): BlockedJourney[] {
  const list = (journeys as { blocked?: unknown } | null | undefined)?.blocked;
  if (!Array.isArray(list)) return [];
  return list
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && typeof (b as Record<string, unknown>).slug === 'string')
    .map((b) => ({ slug: String(b.slug), frameworkId: typeof b.framework_id === 'number' ? b.framework_id : null, state: typeof b.state === 'string' ? b.state : '', reason: typeof b.reason === 'string' ? b.reason : '' }));
}
