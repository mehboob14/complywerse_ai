// The AI helpers of Task Management, apart from React so `node --test` pins them (aiModel.test.ts): what each one READS (the server looks at 50 tasks for two of them, and the old screens never said
// so), which of the AI's suggestions are worth offering (a change that changes nothing, a priority that is not one of the four, a task that is not there any more are left out), and how its
// answer to a prediction reads (the risk and the confidence arrive as a number of unknown scale or a word). The calls, bodies and keys are the old ones and are not here.
import { norm } from '../../../../lib/status.ts';
import { priorityValue } from '../_register/taskFacets.ts';
import { isDoneStatus, peopleOf, type RegisterTask } from '../taskRecord.ts';
import { PRIORITIES } from '../tasksModel.ts';

/** How many tasks the server reads for Predict escalations and AI Reprioritize (`.limit(50)` in routers/critical_tasks_router.py; a test re-reads it). */
export const AI_READS = 50;

export type AiKind = 'prioritize' | 'predict' | 'balance';

const tasks = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'task' : 'tasks'}`;

/**
 * What the helper reads, in a sentence: the same selection the server makes (Reprioritize: the open tasks created most recently; Predict: the open tasks with a due date that fall due soonest; Balance:
 * every open task, and a document request counts in the load but is never moved). `complete` says the loaded list is every task there is; when it is not, "of N" is left out rather than guessed.
 */
export function aiReach(kind: AiKind, rows: readonly RegisterTask[], complete: boolean): string {
  const open = rows.filter((t) => !isDoneStatus(t.status));
  if (kind === 'balance') {
    return open.length === 0 && complete ? 'There are no open tasks to read.' : `Reads every open task you can see${complete ? ` (${tasks(open.length)})` : ''}. A document request counts in the load and is never moved.`;
  }
  const pool = kind === 'predict' ? open.filter((t) => t.due_date) : open;
  const what = kind === 'predict' ? 'open tasks with a due date' : 'open tasks';
  if (complete && pool.length === 0) return `There are no ${what} to read.`;
  if (complete && pool.length <= AI_READS) return `Reads all ${tasks(pool.length)}: the ${what} you can see.`;
  const which = kind === 'predict' ? 'that fall due soonest' : 'created most recently';
  return `Reads ${AI_READS} tasks: the ${what} you can see ${which}${complete ? `, of ${pool.length.toLocaleString('en-US')}` : ''}. The others are not looked at.`;
}

// ── AI Reprioritize ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PrioritySuggestion { task_id?: number; current_priority?: string; suggested_priority?: string; justification?: string }
export interface PriorityRow { key: string; taskId: number; title: string | null; current: string; suggested: string; reason: string }

const byId = (rows: readonly RegisterTask[]): Map<number, RegisterTask> => new Map(rows.map((t) => [t.id, t]));
const isPriority = (word: string | undefined): boolean => !!word && PRIORITIES.map(norm).indexOf(norm(word)) >= 0;

/** The suggestions worth offering, one per task: it names a task and one of the four priorities, and the priority differs from the one the task has NOW (the list is newer than the AI's own idea of the
 *  current one). The priority is written in the workflow's own spelling. A task the list does not hold is not one the person may see (an id the AI made up) when the list is complete; when the list was
 *  cut at the ceiling it may be a real one it is too short to hold, and is offered without a title. */
export function priorityRows(suggestions: readonly PrioritySuggestion[] | null | undefined, rows: readonly RegisterTask[], complete: boolean): PriorityRow[] {
  const tasksById = byId(rows);
  const seen = new Set<number>();
  const out: PriorityRow[] = [];
  (suggestions ?? []).forEach((s) => {
    if (!s || typeof s.task_id !== 'number' || seen.has(s.task_id) || !isPriority(s.suggested_priority)) return;
    const task = tasksById.get(s.task_id);
    if (!task && complete) return;
    const current = task ? priorityValue(task.priority) : (s.current_priority ?? '');
    const suggested = priorityValue(s.suggested_priority as string);
    if (norm(current) === norm(suggested)) return;
    seen.add(s.task_id);
    out.push({ key: String(s.task_id), taskId: s.task_id, title: task?.title ?? null, current, suggested, reason: (s.justification ?? '').trim() });
  });
  return out;
}

// ── Balance workload ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Reassignment { task_id?: number; task_title?: string; current_owner?: string; suggested_owner?: string; suggested_owner_id?: number | null; reason?: string }
export interface ReassignRow { key: string; taskId: number; title: string; from: string; to: string; /** the task's people after the move: the new owner first, then the others who were on it */ people: number[]; reason: string }

/**
 * The reassignments worth offering, one per task: a task the list holds (the write needs its people), the person it goes to (by id) who is not already its owner. The write sends the whole list of
 * people, because the server keeps the owner it was given in `assigned_owner_id` and leaves the list alone: the old owner would stay on the task. The old owner leaves the list, the new one comes
 * first, everyone else stays.
 */
export function reassignRows(suggestions: readonly Reassignment[] | null | undefined, rows: readonly RegisterTask[]): ReassignRow[] {
  const tasksById = byId(rows);
  const seen = new Set<number>();
  const out: ReassignRow[] = [];
  (suggestions ?? []).forEach((s) => {
    if (!s || typeof s.task_id !== 'number' || typeof s.suggested_owner_id !== 'number' || !s.suggested_owner_id || seen.has(s.task_id)) return;
    const task = tasksById.get(s.task_id);
    if (!task || task.assigned_owner_id === s.suggested_owner_id) return;
    seen.add(s.task_id);
    const others = peopleOf(task).filter((id) => id !== task.assigned_owner_id && id !== s.suggested_owner_id);
    out.push({
      key: String(s.task_id), taskId: s.task_id, title: task.title, people: [s.suggested_owner_id, ...others],
      from: task.assigned_owner?.display_name || s.current_owner || 'Nobody', to: s.suggested_owner || 'Someone', reason: (s.reason ?? '').trim(),
    });
  });
  return out;
}

/** The load the AI described, as chips: `{ "Ada": 7 }` or `{ "Ada": { task_count: 7, load_level: "high" } }`. Anything else is left out. */
export function loadChips(workload: Record<string, unknown> | null | undefined): Array<{ name: string; count: number; level: string | null }> {
  return Object.keys(workload ?? {}).flatMap((name) => {
    const value = (workload as Record<string, unknown>)[name];
    const count = typeof value === 'number' ? value : value && typeof value === 'object' ? (value as Record<string, unknown>).task_count : undefined;
    if (typeof count !== 'number' || !Number.isFinite(count)) return [];
    const level = value && typeof value === 'object' ? (value as Record<string, unknown>).load_level : null;
    return [{ name, count, level: typeof level === 'string' && level ? level : null }];
  });
}

// ── Predict escalations ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Prediction {
  task_id?: number; title?: string; risk_score?: number | string; confidence?: number | string; predicted_breach_date?: string; risk_factors?: string[]; recommended_actions?: string[];
}
export interface PredictionView { taskId: number | null; title: string; tone: 'danger' | 'warning' | 'success'; risk: number | null; confidence: string | null; breach: string | null; factors: string[]; actions: string[] }

/** A score the AI wrote as a number or a numeric string, on a 0-100 scale; one written as a fraction (1 or less) is read as a percent. */
export function percentOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 0 && n <= 1 ? n * 100 : n;
}

/** The old risk rule, unchanged: from 80 a danger, from 50 a warning, below that fine. */
export const riskTone = (risk: number | null): PredictionView['tone'] => ((risk ?? 0) >= 80 ? 'danger' : (risk ?? 0) >= 50 ? 'warning' : 'success');

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []);

export function predictionView(p: Prediction): PredictionView {
  const risk = percentOf(p.risk_score);
  const asPercent = percentOf(p.confidence);
  const word = typeof p.confidence === 'string' && asPercent == null && p.confidence.trim() ? p.confidence.trim() : null;
  return {
    taskId: typeof p.task_id === 'number' && p.task_id > 0 ? p.task_id : null,
    title: (p.title ?? '').trim() || 'A task',
    tone: riskTone(risk),
    risk,
    confidence: asPercent != null ? `${Math.round(asPercent)}%` : word ? word.charAt(0).toUpperCase() + word.slice(1) : null,
    breach: p.predicted_breach_date || null,
    factors: list(p.risk_factors),
    actions: list(p.recommended_actions),
  };
}
