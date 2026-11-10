import { redirect } from 'next/navigation';
import { forwardTo, type SearchParams } from '@/lib/forwardTo';

// /reports/saved was the page of the saved reports ("Saved exports" in the menu). The Reports library took its place: this address stays for ever (stored links and bookmarks carry it) and
// forwards to it, with whatever query the link had. A server redirect: no flash of an old page.
export default function SavedReportsForward({ searchParams }: { searchParams?: SearchParams }) {
  redirect(forwardTo('/reports', searchParams));
}
