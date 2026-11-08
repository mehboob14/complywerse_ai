// What the "Edit details" panel of an issue decides, apart from React so `node --test` pins it (issueEdit.test.ts): the form's starting values, whether anything changed, what is wrong, and the
// body of PATCH /issue-management/issues/{id}, which carries ONLY the fields that changed (the server logs one timeline line per changed field, and a change of impact, urgency or severity
// recomputes the severity and the target date, so an untouched field must not be sent).
export const TITLE_MAX = 255;
export const ROOT_CAUSE_MAX = 255;

/** The parts of GET /issues/{id} the panel edits. */
export interface EditableIssue {
  title: string;
  description?: string | null;
  issue_type?: string | null;
  category?: string | null;
  impact?: string | null;
  urgency?: string | null;
  severity_override?: string | null;
  severity_override_reason?: string | null;
  assignee?: { id?: number | null } | null;
  owner?: { id?: number | null } | null;
  due_date?: string | null;
  root_cause?: string | null;
  root_cause_analysis?: string | null;
}

export interface EditDraft {
  title: string;
  description: string;
  issue_type: string;
  category: string;
  impact: string;
  urgency: string;
  /** a severity chosen by a person ('' = the one the matrix works out) */
  override: string;
  overrideReason: string;
  assignee: string | null;
  owner: string | null;
  /** a calendar day, YYYY-MM-DD, or '' */
  due: string;
  rootCause: string;
  analysis: string;
}

const idOf = (p?: { id?: number | null } | null): string | null => (p?.id != null ? String(p.id) : null);

/** The form as the issue is now. A due date is a day: the first ten characters are the day as written (the server stores it at midnight), whatever the viewer's zone. */
export function draftOf(i: EditableIssue): EditDraft {
  return {
    title: i.title ?? '',
    description: i.description ?? '',
    issue_type: i.issue_type ?? '',
    category: i.category ?? '',
    impact: i.impact ?? '',
    urgency: i.urgency ?? '',
    override: i.severity_override ?? '',
    overrideReason: i.severity_override_reason ?? '',
    assignee: idOf(i.assignee),
    owner: idOf(i.owner),
    due: i.due_date ? i.due_date.slice(0, 10) : '',
    rootCause: i.root_cause ?? '',
    analysis: i.root_cause_analysis ?? '',
  };
}

export function isDirty(opened: EditDraft, now: EditDraft): boolean {
  return (Object.keys(opened) as Array<keyof EditDraft>).some((k) => opened[k] !== now[k]);
}

export interface EditErrors { title?: string; overrideReason?: string; rootCause?: string }
export function editErrors(d: EditDraft): EditErrors {
  const out: EditErrors = {};
  if (!d.title.trim()) out.title = 'Enter a title.';
  else if (d.title.trim().length > TITLE_MAX) out.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (d.override && !d.overrideReason.trim()) out.overrideReason = 'Say why the severity is changed.';
  if (d.rootCause.length > ROOT_CAUSE_MAX) out.rootCause = `Keep the root cause under ${ROOT_CAUSE_MAX} characters; the analysis has room for the rest.`;
  return out;
}

const orNull = (s: string): string | null => (s.trim() ? s : null);

/** The body of the PATCH: the fields that differ from `opened`, in the server's names. An empty optional field is cleared (null), a person is an id. */
export function patchBody(opened: EditDraft, now: EditDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (now.title.trim() !== opened.title.trim()) body.title = now.title.trim();
  if (orNull(now.description) !== orNull(opened.description)) body.description = orNull(now.description);
  if (now.issue_type !== opened.issue_type && now.issue_type) body.issue_type = now.issue_type;
  if (now.category !== opened.category && now.category) body.category = now.category;
  if (now.impact !== opened.impact && now.impact) body.impact = now.impact;
  if (now.urgency !== opened.urgency && now.urgency) body.urgency = now.urgency;
  if (now.override !== opened.override || (now.override && now.overrideReason.trim() !== opened.overrideReason.trim())) {
    // the server reads the reason together with the severity: sending one alone would clear the other
    body.severity_override = now.override || null;
    body.severity_override_reason = now.override ? now.overrideReason.trim() : null;
  }
  if (now.assignee !== opened.assignee) body.assignee_id = now.assignee ? Number(now.assignee) : null;
  if (now.owner !== opened.owner) body.owner_id = now.owner ? Number(now.owner) : null;
  if (now.due !== opened.due) body.due_date = now.due || null;
  if (orNull(now.rootCause) !== orNull(opened.rootCause)) body.root_cause = orNull(now.rootCause);
  if (orNull(now.analysis) !== orNull(opened.analysis)) body.root_cause_analysis = orNull(now.analysis);
  return body;
}

/** A change of impact, urgency or the chosen severity moves the severity and the target date: the panel says so before it is saved. */
export const movesTheTarget = (body: Record<string, unknown>): boolean => 'impact' in body || 'urgency' in body || 'severity_override' in body;
