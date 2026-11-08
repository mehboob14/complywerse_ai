// What the assessment workspace decides without a server or a screen: which tabs an assessment has, what its score reads, which actions are on offer, and the
// words of the heading. Pure (`node --test workspaceModel.test.ts`); relative imports with the .ts extension.
import { lifecycleOf } from '../../../lib/statuses/assessments.ts';
import { kindOf } from './kinds.ts';
import type { LensDef } from './lens.ts';
import type { AssessmentDetail, OverviewEntry, OverviewResult } from './types.ts';

// ── the address ─────────────────────────────────────────────────────────────────
export const WORKSPACE_PATH = '/assessments/a';
export const workspaceHref = (id: number | string): string => `${WORKSPACE_PATH}/${id}`;

/** Where "Back" goes. The register is the next group's page; until it exists the overview is the list of assessments. */
export const BACK = { href: '/assessments', label: 'Back to Assessments' } as const;

/** The id in the address: a positive whole number, else null (the page says it is not an assessment). */
export function idOfParam(param: string | string[] | undefined): number | null {
  const text = Array.isArray(param) ? param[0] : param;
  return text !== undefined && /^[1-9]\d{0,9}$/.test(text) ? Number(text) : null;
}

// ── the tabs ────────────────────────────────────────────────────────────────────
export interface TabSpec { key: string; label: string; count?: number; disabled?: boolean }

export interface TabInput {
  /** made per application, function or system */
  scoped: boolean;
  phase: 'scoping' | 'in_progress' | null;
  /** null: no count on the tab (the NCA workspace holds no controls of its own) */
  totalItems: number | null;
  /** open gaps, the server's count; null when the board does not count the assessment */
  openGaps: number | null;
  controls: LensDef | null;
  lensTabs: readonly LensDef[];
}

/** A scoped draft: its stages first (the questions do not exist yet), the controls waiting. Otherwise Controls, Remediation, the lens tabs, and for a scoped assessment its Scope, People and Plan (what was agreed before the start). */
export function tabsFor(a: TabInput): TabSpec[] {
  const stages: TabSpec[] = [{ key: 'scope', label: 'Scope' }, { key: 'people', label: 'People' }, { key: 'plan', label: 'Plan' }];
  if (a.scoped && a.phase === 'scoping') return [...stages, { key: 'controls', label: 'Controls', disabled: true }];
  const tabs: TabSpec[] = [{ key: 'controls', label: a.controls?.label ?? 'Controls', ...(a.totalItems === null ? {} : { count: a.totalItems }) }, { key: 'remediation', label: 'Remediation', ...(a.openGaps === null ? {} : { count: a.openGaps }) }];
  for (const l of a.lensTabs) tabs.push({ key: l.key, label: l.label });
  return a.scoped ? [...tabs, ...stages] : tabs;
}

export const defaultTabFor = (a: Pick<TabInput, 'scoped' | 'phase'>): string => (a.scoped && a.phase === 'scoping' ? 'scope' : 'controls');

// ── the score ───────────────────────────────────────────────────────────────────
export type GradeWord = 'excellent' | 'good' | 'fair' | 'poor';

/** The server's grade of a score (/overview): 85, 70, 50. The one band system of the module (audit decision 3). */
export function gradeOf(score: number | null | undefined): GradeWord | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
}

/** This assessment's entry in the board's answer; null when the board does not count it (a draft, a plain upload, an unanswered questionnaire once another was started). */
export function entryOf(result: OverviewResult | null | undefined, id: number): OverviewEntry | null {
  for (const c of result?.categories ?? []) {
    const found = c.assessments.find((a) => a.id === id);
    if (found) return found;
  }
  return null;
}

export interface ScoreView {
  /** the board counts this assessment */
  counted: boolean;
  /** 0 to 100, one decimal; null: counted but nothing is answered yet */
  score: number | null;
  grade: GradeWord | null;
  sla: number | null;
}

export function scoreView(entry: OverviewEntry | null): ScoreView {
  if (!entry) return { counted: false, score: null, grade: null, sla: null };
  return { counted: true, score: entry.content, grade: gradeOf(entry.content), sla: entry.sla };
}

// ── who may do what ─────────────────────────────────────────────────────────────
/** The workspace shows the controls to change nothing to a person without the Assessments edit right (what the older detail page did). The server lets any signed-in person write: a gap the user decides (audit G-1..G-8). */
export const readOnlyFor = (canEdit: boolean): boolean => !canEdit;

export interface Actions {
  start: boolean;
  discard: boolean;
  complete: boolean;
  reopen: boolean;
  editDetails: boolean;
  exportFile: boolean;
  refresh: boolean;
  remove: boolean;
  addControl: boolean;
}

/** What the heading's buttons and menu offer. A scoped draft can be started and discarded; a started or uploaded assessment can be completed and reopened; nothing changes for a read-only person. */
export function actionsFor(a: { phase: 'scoping' | 'in_progress' | null; status: string | null; scoped: boolean; readOnly: boolean; format: string }): Actions {
  const life = lifecycleOf({ phase: a.phase, status: a.status });
  const draft = life === 'scoping';
  const write = !a.readOnly;
  return {
    start: write && draft,
    discard: write && draft,
    complete: write && !draft && life !== 'completed',
    reopen: write && !draft && life === 'completed',
    editDetails: write,
    exportFile: !draft,
    refresh: write && !draft && !a.scoped && a.format !== 'nca_container',          // a workbook can be read again; a question set copied from a template or the library cannot
    remove: write && !(draft),                                                       // a draft has its own "Discard"
    addControl: write && !draft,
  };
}

// ── the heading ─────────────────────────────────────────────────────────────────
export interface HeadFacts { kind: string; category: string; lifecycle: string }
export function headFacts(a: Pick<AssessmentDetail, 'assessment_format' | 'phase' | 'status'>): HeadFacts {
  const k = kindOf(a.assessment_format);
  return { kind: k.label, category: k.category, lifecycle: lifecycleOf(a) };
}

/** The counts under the score: "12 of 40 answered" style facts are the page's; this gives the numbers. */
export function answeredShare(a: Pick<AssessmentDetail, 'total_items' | 'in_progress_count'>): { answered: number; total: number } {
  const total = a.total_items ?? 0;
  return { answered: Math.max(0, total - (a.in_progress_count ?? 0)), total };
}
