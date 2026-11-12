// A small, internally consistent answer of GET /governance/document-overview for the tests of the document figures of the Overview (the numbers are worked out by hand here).
//   Operations (10) > Support (11) > Helpdesk (12); Finance (13); no department.
//   filed in it: Operations 1 (a draft policy), Support 2 (a policy and a procedure in force), Helpdesk 2 (a standard in review, a policy in approval),
//   Finance 1 (a guideline in force), none 1 (a policy in force): 7 documents, 1 draft, 1 in review, 1 in approval, 4 in force; 4 policies, 1 guideline,
//   1 procedure, 1 standard.
import type { DepartmentRow, Overview } from './_model.ts';

const NO = { pending: 0, overdue: 0 };
const where = (dept: string, extra: Record<string, string> = {}) => ({ ...(dept ? { dept } : {}), ...extra });

export const row = (over: Partial<DepartmentRow> & Pick<DepartmentRow, 'department_id' | 'name'>): DepartmentRow => ({
  key: `dept:${over.department_id ?? 'none'}`, path: [over.name], level: 1, level_label: 'Department', depth: 0, is_active: true, owner: null, own: 0,
  documents: 0, in_force: 0, in_progress: 0, overdue_reviews: 0, issues: 0, by_status: {}, by_type: {},
  waiting: { review: { ...NO }, approval: { ...NO }, acknowledgement: { ...NO } }, reviews: { overdue: 0, due_soon: 0, unscheduled: 0 },
  issues_by: { stuck: 0, on_hold: 0, late_approvals: 0, late_acknowledgements: 0, no_owner: 0 }, ...over,
});

export const OPERATIONS = row({
  department_id: 10, name: 'Operations', owner: 'Tom', own: 1, documents: 5, in_force: 2, in_progress: 3, overdue_reviews: 1, issues: 2,
  by_status: { draft: 1, pending_review: 1, pending_approval: 1, published: 2 }, by_type: { policy: 3, procedure: 1, standard: 1 },
  waiting: { review: { pending: 1, overdue: 1 }, approval: { pending: 1, overdue: 0 }, acknowledgement: { ...NO } },
  reviews: { overdue: 1, due_soon: 0, unscheduled: 1 }, issues_by: { stuck: 1, on_hold: 0, late_approvals: 1, late_acknowledgements: 0, no_owner: 1 },
});
export const SUPPORT = row({
  department_id: 11, name: 'Support', path: ['Operations', 'Support'], level: 2, level_label: 'Sub-department', depth: 1, owner: 'Mia', own: 2, documents: 4, in_force: 2, in_progress: 2,
  overdue_reviews: 1, issues: 2, by_status: { pending_review: 1, pending_approval: 1, published: 2 }, by_type: { policy: 2, procedure: 1, standard: 1 },
  waiting: { review: { pending: 1, overdue: 1 }, approval: { pending: 1, overdue: 0 }, acknowledgement: { ...NO } },
  reviews: { overdue: 1, due_soon: 0, unscheduled: 1 }, issues_by: { stuck: 1, on_hold: 0, late_approvals: 1, late_acknowledgements: 0, no_owner: 1 },
});
export const HELPDESK = row({
  department_id: 12, name: 'Helpdesk', path: ['Operations', 'Support', 'Helpdesk'], level: 3, level_label: 'Unit', depth: 2, own: 2, documents: 2, in_progress: 2, issues: 1,
  by_status: { pending_review: 1, pending_approval: 1 }, by_type: { policy: 1, standard: 1 },
  waiting: { review: { pending: 1, overdue: 1 }, approval: { pending: 1, overdue: 0 }, acknowledgement: { ...NO } },
  issues_by: { stuck: 1, on_hold: 0, late_approvals: 1, late_acknowledgements: 0, no_owner: 0 },
});
export const FINANCE = row({
  department_id: 13, name: 'Finance', owner: 'Fay', own: 1, documents: 1, in_force: 1, issues: 1, by_status: { published: 1 }, by_type: { guideline: 1 },
  waiting: { review: { ...NO }, approval: { ...NO }, acknowledgement: { pending: 2, overdue: 1 } }, reviews: { overdue: 0, due_soon: 0, unscheduled: 1 },
  issues_by: { stuck: 0, on_hold: 0, late_approvals: 0, late_acknowledgements: 1, no_owner: 0 },
});
export const NOBODY = row({
  department_id: null, name: 'No department', path: [], level: 0, level_label: '', own: 1, documents: 1, in_force: 1, by_status: { published: 1 }, by_type: { policy: 1 },
  reviews: { overdue: 0, due_soon: 0, unscheduled: 1 },
});

const STATUS_ROWS = [['draft', 1], ['pending_review', 1], ['pending_approval', 1], ['approved', 0], ['published', 4], ['expired', 0], ['exception_applied', 0], ['review_required', 0]] as const;
const TYPE_ROWS = [['policy', 'Policy', 4], ['guideline', 'Guideline', 1], ['procedure', 'Procedure', 1], ['standard', 'Standard', 1]] as const;

/** The whole organisation: Finance, Operations (with Support and Helpdesk under it), No department. */
export const WHOLE: Overview = {
  scope: { value: '', department_id: null, name: 'Whole organisation', path: [], level: 0, level_label: '', whole_organisation: true, includes_below: true },
  choices: [],
  as_of: '2026-11-05T10:00:00',
  totals: { documents: 7, in_force: 4, in_progress: 3, expired: 0, exception_applied: 0, archived: 0 },
  by_type: TYPE_ROWS.map(([doc_type, label, count]) => ({ key: `type:${doc_type}`, doc_type, label, count, in_force: 0, in_force_key: `type:${doc_type}:in_force` })),
  by_status: STATUS_ROWS.map(([status, count]) => ({ key: `status:${status}`, status, count })),
  by_department: [FINANCE, OPERATIONS, SUPPORT, HELPDESK, NOBODY],
  requests: {
    review: { pending: 1, overdue: 1, due_soon: 0, oldest_days_late: 30 },
    approval: { pending: 1, overdue: 0, due_soon: 1, oldest_days_late: null },
    acknowledgement: { pending: 2, overdue: 1, due_soon: 1, oldest_days_late: 1 },
  },
  waiting: [],
  reviews: { overdue: 1, due_soon: 0, unscheduled: 3, up_to_date: 0 },
  issues: { no_owner: 1, expired: 0, exception_applied: 0, stuck: 1, on_hold: 0, late_acknowledgements: 1, late_approvals: 1, documents: 3 },
  links: Object.fromEntries([
    ...TYPE_ROWS.map(([t]) => [`type:${t}`, where('', { type: t })]), ...STATUS_ROWS.map(([s]) => [`status:${s}`, where('', { status: s })]),
  ]),
};

/** Operations as the scope: its row first, then what is under it (the depths are the same). */
export const IN_OPERATIONS: Overview = {
  ...WHOLE,
  scope: { value: '10', department_id: 10, name: 'Operations', path: ['Operations'], level: 1, level_label: 'Department', whole_organisation: false, includes_below: true },
  by_department: [OPERATIONS, SUPPORT, HELPDESK],
  totals: { documents: 5, in_force: 2, in_progress: 3, expired: 0, exception_applied: 0, archived: 0 },
};
