// Framework Comparison (a crosswalk of two frameworks) was a page of the Control Library that no link opened. The address stays alive and forwards to /control-library with the query string it came with (Next answers the redirect; nothing renders). Nothing linked to it (the registry said so), so the Control Library is the one place for the unified controls. Deleted later, when nobody has it bookmarked; the source stays in the git history.
import { redirect } from 'next/navigation';
import { forwardTo, type SearchParams } from '@/lib/forwardTo';

export default function Forward({ searchParams }: { searchParams?: SearchParams }) {
  redirect(forwardTo('/control-library', searchParams));
}
