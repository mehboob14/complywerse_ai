// Static fixtures for the style guide's demos: invented documents and people, fixed dates, nothing read from the app. A guide that fetched its
// own data would break when the backend is down and could show a real name; this one cannot.

export interface Doc {
  id: number;
  title: string;
  owner: string | null;
  status: string;
  priority: string;
  /** a day, as the server writes a date with no time */
  reviewDue: string;
  /** a moment, as the server stamps it: naive UTC */
  updated: string;
  open: number;
}

export const DOCUMENTS: Doc[] = [
  { id: 1, title: 'Information security policy', owner: 'Dana Okafor', status: 'published', priority: 'high', reviewDue: '2027-03-01', updated: '2026-10-30T09:15:00', open: 2 },
  { id: 2, title: 'Access control standard', owner: 'Sam Rivera', status: 'pending_review', priority: 'critical', reviewDue: '2026-12-15', updated: '2026-10-28T14:40:00', open: 5 },
  { id: 3, title: 'Business continuity plan', owner: 'Lena Petrova', status: 'approved', priority: 'medium', reviewDue: '2027-01-20', updated: '2026-10-21T08:05:00', open: 0 },
  { id: 4, title: 'Vendor onboarding procedure', owner: null, status: 'draft', priority: 'low', reviewDue: '2027-06-30', updated: '2026-10-12T16:30:00', open: 1 },
  { id: 5, title: 'Password guideline', owner: 'Omar Haddad', status: 'expired', priority: 'high', reviewDue: '2026-09-01', updated: '2026-09-02T11:00:00', open: 3 },
  { id: 6, title: 'Incident response playbook', owner: 'Priya Nair', status: 'pending_approval', priority: 'critical', reviewDue: '2026-11-30', updated: '2026-10-29T13:20:00', open: 4 },
  { id: 7, title: 'Data retention schedule', owner: 'Mateo Silva', status: 'archived', priority: 'info', reviewDue: '2028-01-10', updated: '2026-06-18T10:10:00', open: 0 },
  { id: 8, title: 'Acceptable use policy with a deliberately long title that has to wrap inside its cell without widening the table', owner: 'Aiko Tanaka', status: 'exception_applied', priority: 'medium', reviewDue: '2026-11-12', updated: '2026-10-27T17:45:00', open: 6 },
];
