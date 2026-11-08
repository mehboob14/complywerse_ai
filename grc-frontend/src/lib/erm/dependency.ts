// Risk dependencies, apart from React (`node --test src/lib/erm/dependency.test.ts`). The server stores `impact_factor` (a multiplier, default 1.0) and the cascade
// scores a downstream risk as `(its residual, else inherent, score) x impact_factor`. The page offered a 1-5 "strength" slider and sent it as `strength`, which the server
// dropped: every dependency was saved with 1.0 and the row printed "/5". Strength n of 5 is now sent as the factor n / 5 (5, the slider's top and the default, is 1.0 -
// exactly what every dependency has had so far). A factor a workflow wrote (`add_risk_dependency`) that is not one of the five steps is shown as the factor.

export const STRENGTHS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_STRENGTH = 5;
export const DEPENDENCY_TYPES = ['causes', 'caused_by', 'amplifies', 'mitigates', 'related'] as const;

export const factorOfStrength = (strength: number): number => Math.round((Math.min(5, Math.max(1, Math.round(strength))) / 5) * 100) / 100;

/** The 1-5 step an impact factor stands for, or null when it is not one of the five (0.2, 0.4, 0.6, 0.8, 1.0). */
export function strengthOfFactor(factor: number | null | undefined): number | null {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return null;
  const step = Math.round(factor * 5);
  return step >= 1 && step <= 5 && Math.abs(step / 5 - factor) < 0.005 ? step : null;
}

/** "Strength 3 of 5 (x0.6)", or "x1.5" for a factor that is not a step. */
export function strengthWords(factor: number | null | undefined): string {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return '—';
  const step = strengthOfFactor(factor);
  const f = `x${Math.round(factor * 100) / 100}`;
  return step ? `${step} of 5 (${f})` : f;
}

// ── the cascade the server sends (dependencies.py get_cascade_impact) ──
export interface CascadeNode { risk_id: number; risk_title: string; dependency_type?: string; impact_factor?: number; cascade_score: number; depth: number; downstream?: CascadeNode[] }
export interface CascadeResult { source_risk_id: number; source_risk_title: string; source_score: number | null; cascade_impact: CascadeNode[]; total_cascade_score: number }
export interface CascadeRow { node: CascadeNode; depth: number }

/** The tree, flattened in reading order (a risk, then what it reaches), each with its depth (1 = directly reached). */
export function flattenCascade(nodes: readonly CascadeNode[] | undefined, depth = 1): CascadeRow[] {
  const out: CascadeRow[] = [];
  (nodes ?? []).forEach((node) => {
    out.push({ node, depth });
    out.push(...flattenCascade(node.downstream, depth + 1));
  });
  return out;
}

/** The server's total counts the first level only; this says how many risks the whole cascade reaches. */
export const reachedCount = (result: Pick<CascadeResult, 'cascade_impact'> | undefined): number => flattenCascade(result?.cascade_impact).length;

/** Both ends must be chosen and differ: the form's check (the page used a native alert, and its first state was 0 and 0). */
export function dependencyError(source: number | null, target: number | null): string | undefined {
  if (!source) return 'Choose the risk that causes the impact.';
  if (!target) return 'Choose the risk that is affected.';
  if (source === target) return 'A risk cannot depend on itself.';
  return undefined;
}
