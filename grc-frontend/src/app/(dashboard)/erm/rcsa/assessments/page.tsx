// The old Assessments list is the Worklist now (a person's own units, what waits for their review). Its address keeps working: a status in the old query picks the matching view.
import { redirect } from 'next/navigation';

const SHOW: Record<string, string> = { submitted: 'review', under_review: 'review', in_progress: 'complete', not_started: 'complete', requires_changes: 'returned' };

export default function RcsaAssessmentsRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const status = Array.isArray(searchParams?.status) ? searchParams?.status[0] : searchParams?.status;
  const show = status ? SHOW[status] : undefined;
  redirect(show ? `/erm/rcsa?show=${show}` : '/erm/rcsa');
}
