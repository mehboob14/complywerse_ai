// What the Issue settings page decides, apart from React so `node --test` pins it (settingsModel.test.ts): the severity matrix as a 3x3 grid, how a number of hours is said, what a cell's form may
// send, and the one automation switch that does something. The matrix is GET/PUT /issue-management/matrices/severity; the flags are GET/PUT /issue-management/automation-flags.

export const LEVELS = ['high', 'medium', 'low'] as const;
export type Level = (typeof LEVELS)[number];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export interface MatrixCell { impact: string; urgency: string; severity: string; sla_ack_hours: number; sla_resolve_hours: number; is_default: boolean }
export interface GridRow { impact: Level; cells: Array<{ urgency: Level; cell: MatrixCell | null }> }

/** Impact down (high first), urgency across (high first). A cell the server did not send is null (the grid still has nine places). */
export function gridOf(cells: readonly MatrixCell[] | undefined): GridRow[] {
  return LEVELS.map((impact) => ({ impact, cells: LEVELS.map((urgency) => ({ urgency, cell: (cells ?? []).find((c) => c.impact === impact && c.urgency === urgency) ?? null })) }));
}

/** "3 days" / "36 hours" / "1 hour": whole days from two days up, hours otherwise (so 100 hours stays 100 hours, never "4.2 days"). */
export function slaWords(hours: number): string {
  const h = Math.round(hours);
  if (h >= 48 && h % 24 === 0) return `${h / 24} days`;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** What a cell is called to a screen reader: "High impact, high urgency: Critical, fixed within 3 days". */
export function cellName(cell: MatrixCell, severityLabel: string): string {
  return `${cap(cell.impact)} impact, ${cell.urgency} urgency: ${severityLabel}, fixed within ${slaWords(cell.sla_resolve_hours)}`;
}

export interface CellDraft { severity: string; hours: string }
export const draftOf = (cell: MatrixCell): CellDraft => ({ severity: cell.severity, hours: String(cell.sla_resolve_hours) });

/** The words under the hours field, or null when it can be saved: a whole number of hours, at least 1 (the server turns 0 into a week without saying so). */
export function hoursError(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Enter the number of hours.';
  if (!/^\d+$/.test(t) || Number(t) < 1) return 'Enter a whole number of hours, at least 1.';
  return null;
}

export const isDirty = (cell: MatrixCell, draft: CellDraft): boolean => draft.severity !== cell.severity || draft.hours.trim() !== String(cell.sla_resolve_hours);

/** The body of PUT /matrices/severity/{impact}/{urgency}. The acknowledge window is not shown (nothing uses it) but is sent as it is: the server resets a missing one to 24 hours. */
export function cellPayload(cell: MatrixCell, draft: CellDraft): { severity: string; sla_ack_hours: number; sla_resolve_hours: number } {
  return { severity: draft.severity, sla_ack_hours: cell.sla_ack_hours, sla_resolve_hours: Number(draft.hours.trim()) };
}

// ── automation: the one switch with a reader ──
export interface Flags {
  refresh_document_review?: boolean;
  kri_red_breach?: boolean;
  overdue_mitigation?: boolean;
  control_evidence_rejected?: boolean;
  all_enabled?: boolean;
}

/** On when its own switch is on or the "all on" override is (the server's `is_enabled` reads both). */
export const kriOn = (f: Flags | undefined): boolean => !!f && (f.kri_red_breach === true || f.all_enabled === true);

/** Turning it off must also clear the override, or it would stay on; turning it on needs only its own flag. The other three flags are never written: nothing reads them. */
export const kriPayload = (on: boolean): Flags => (on ? { kri_red_breach: true } : { kri_red_breach: false, all_enabled: false });
