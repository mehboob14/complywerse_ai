// The tasks that are raised from somewhere else on the change page, as pure functions (drafts.test.ts): a task from an obligation carries its words, deadline and owners; one from an impact assessment
// carries the gap and the kind of thing it touches. The task editor opens with the draft filled in; nothing is saved until the person presses Add.
import { ownersOf } from './regulatoryModel.ts';
import type { Assessment, Obligation, TaskDraft } from './types.ts';

/** A task for an obligation: its words (cut to a title), the clause and the circular's quote as the description, its deadline and its owners on it. */
export const taskForObligation = (o: Obligation): TaskDraft => ({
  title: o.summary.length > 140 ? `${o.summary.slice(0, 137)}…` : o.summary,
  description: [o.ref && `Clause ${o.ref}.`, o.quote && `The circular: “${o.quote}”`, o.notes].filter(Boolean).join('\n\n'),
  task_type: 'process_change',
  priority: o.priority,
  due_date: o.deadline,
  obligation_id: o.id,
  assignee_ids: ownersOf(o),
});

export const assessmentKind = (a: Pick<Assessment, 'impacted_item_type' | 'assessment_type'>): string => (a.impacted_item_type || a.assessment_type || 'process').toLowerCase();
export const hasGap = (a: Pick<Assessment, 'gap_identified' | 'gap_description' | 'compliance_gaps'>): boolean => Boolean(a.gap_identified || a.gap_description || a.compliance_gaps);
export const narrativeOf = (a: Pick<Assessment, 'impact_description' | 'affected_areas'>): string => a.impact_description || a.affected_areas || '';

const words = (v: string) => v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The AI writes a label on the narrative's first line ("Policy 'X' - update"); it is the title when no record is named. */
export function assessmentTitle(a: Assessment): string {
  const first = narrativeOf(a).split('\n')[0].trim();
  return a.impacted_item_name || (first && !first.toLowerCase().startsWith('control ') ? first : null) || `${words(assessmentKind(a))} assessment`;
}

export function taskForAssessment(a: Assessment): TaskDraft {
  const kind = assessmentKind(a);
  const title = assessmentTitle(a);
  const gap = [a.gap_description, a.compliance_gaps].find((t) => t && !/^action needed:/i.test(t));
  return {
    title: `Remediate: ${title}`.slice(0, 200),
    description: gap || narrativeOf(a) || `Review and update ${title}`,
    task_type: kind === 'control' ? 'control_update' : kind === 'policy' ? 'policy_update' : 'process_change',
    priority: ['critical', 'high', 'medium', 'low'].includes(a.impact_level) ? a.impact_level : 'low',
    impact_assessment_id: a.id,
    linked_policy_id: kind === 'policy' ? a.impacted_item_id ?? null : null,
    linked_control_id: kind === 'control' ? a.impacted_item_id ?? null : null,
  };
}

/** Due-date presets of the task editor: a day offset from today, as the written date the date field takes. */
export const DUE_PRESETS = [['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]] as const;
export function inDays(n: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
