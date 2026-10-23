// Vulnerabilities → Departments: a department's escalation paths as the server holds them, how they read on the page and what
// the "Add" form sends. Pure (no React), so `node --test` runs vulnDepartments.test.ts against it. The four copies of the page
// (vulnerabilities/departments and its tab, and their cyber-assurance twins) all read it.

/** One escalation path of a department (GET /vuln-management/departments/{id}/escalation-paths). */
export interface EscalationPath {
  id: number;
  department_id: number;
  escalation_level: number;
  target_role: string;
  sla_threshold_percent: number;
  auto_escalate: boolean;
}

/** Who a path escalates to: the server accepts these three and refuses anything else. */
export const PATH_TARGETS = [
  { value: 'lead', label: 'Department lead' },
  { value: 'head', label: 'Department head' },
  { value: 'parent_dept_head', label: "Parent department's head" },
] as const;

/** A department has one path for each of the levels 1 to 3. */
export const PATH_LEVELS = [1, 2, 3] as const;

/** What the server uses when a path names no threshold. */
export const DEFAULT_THRESHOLD = 75;

export function targetLabel(role: string): string {
  return PATH_TARGETS.find((t) => t.value === role)?.label ?? role;
}

/** The levels no path uses yet, lowest first. */
export function freeLevels(paths: readonly { escalation_level: number }[]): number[] {
  return PATH_LEVELS.filter((l) => !paths.some((p) => p.escalation_level === l));
}

/** "Department head · at 75% of the SLA". A path whose automatic switch is off is never used by the SLA check, so it says so. */
export function pathSummary(p: Pick<EscalationPath, 'target_role' | 'sla_threshold_percent' | 'auto_escalate'>): string {
  return `${targetLabel(p.target_role)} · at ${p.sla_threshold_percent}% of the SLA${p.auto_escalate ? '' : ' · automatic escalation is off'}`;
}

/** The POST body of a new path from the form's raw values; the threshold is a whole percentage of at least 1 (else 75). */
export function pathBody(f: { level: string | number; target: string; threshold: string | number; auto: boolean }) {
  const threshold = Math.round(Number(f.threshold));
  return {
    escalation_level: Number(f.level),
    target_role: f.target,
    sla_threshold_percent: Number.isFinite(threshold) && threshold >= 1 ? threshold : DEFAULT_THRESHOLD,
    auto_escalate: f.auto,
  };
}
