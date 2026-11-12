// Risk actions are CAPA actions (wave 2-E), so their statuses are the CAPA list. Overdue is computed, never stored:
// an open action past its due date, the same rule as the backend (erm/routers/dashboard.py, GET /erm/mitigation-actions/overdue).
export const OPEN_STATUSES = ['planned', 'in_progress', 'blocked'];
export const DUE_SOON_DAYS = 14;

export const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  blocked: 'Blocked',
  completed: 'Done, unverified',
  verified: 'Verified',
  cancelled: 'Cancelled',
};

type ActionLike = { status?: string | null; due_date?: string | null };

const DAY_MS = 86_400_000;

function isOpen(action: ActionLike): boolean {
  return !!action.status && OPEN_STATUSES.includes(action.status);
}

export function isActionOverdue(action: ActionLike, now: Date = new Date()): boolean {
  return isOpen(action) && !!action.due_date && new Date(action.due_date) < now;
}

export function isDueSoon(action: ActionLike, now: Date = new Date(), days: number = DUE_SOON_DAYS): boolean {
  if (!isOpen(action) || !action.due_date) return false;
  const due = new Date(action.due_date).getTime();
  return due >= now.getTime() && due <= now.getTime() + days * DAY_MS;
}

export function matchesStatusFilter(action: ActionLike, filter: string, now: Date = new Date()): boolean {
  if (filter === 'all') return true;
  if (filter === 'overdue') return isActionOverdue(action, now);
  if (filter === 'due_soon') return isDueSoon(action, now);
  if (filter === 'open') return isOpen(action);
  return action.status === filter;
}

// Overdue first, then due in 14 days, then other open work, then done awaiting verification, then finished.
function rank(action: ActionLike, now: Date): number {
  if (isActionOverdue(action, now)) return 0;
  if (isDueSoon(action, now)) return 1;
  if (isOpen(action)) return 2;
  if (action.status === 'completed') return 3;
  return action.status === 'verified' ? 4 : 5;
}

export function sortForTracker<T extends ActionLike>(actions: readonly T[], now: Date = new Date()): T[] {
  const due = (a: ActionLike) => (a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY);
  return [...actions].sort((a, b) => rank(a, now) - rank(b, now) || due(a) - due(b));
}

// Acceptances: the server derives acceptance_state (requested | accepted | expiring (60 days or less) | expired).
export const ACCEPTANCE_GROUPS = [
  { state: 'requested', label: 'Waiting for approval', empty: 'No acceptance is waiting for approval.' },
  { state: 'expiring', label: 'Expiring in 60 days or less', empty: 'No acceptance expires in the next 60 days.' },
  { state: 'expired', label: 'Expired', empty: 'No acceptance has expired.' },
  { state: 'accepted', label: 'Accepted', empty: 'No risk is accepted.' },
] as const;

type AcceptanceLike = { acceptance_state?: string | null; acceptance_expires_at?: string | null };

export function acceptancesByState<T extends AcceptanceLike>(risks: readonly T[]): Record<string, T[]> {
  const expiry = (r: AcceptanceLike) => (r.acceptance_expires_at ? new Date(r.acceptance_expires_at).getTime() : Number.POSITIVE_INFINITY);
  return Object.fromEntries(ACCEPTANCE_GROUPS.map(({ state }) => [
    state,
    risks.filter((r) => r.acceptance_state === state).sort((a, b) => expiry(a) - expiry(b)),
  ]));
}
