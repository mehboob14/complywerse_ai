import { redirect } from 'next/navigation';

// /frameworks/overview/<framework> was the overview page of one library framework (what it is, what it asks, Start Journey). Those details are the drawer of its row in the Library now: this address
// stays for ever (the Manage cards, the Start-a-journey dialog, stored links and bookmarks carried it) and opens that drawer. A server redirect: no flash of an old page.
export default function FrameworkOverviewForward({ params }: { params: { id: string } }) {
  const id = /^\d+$/.test(params.id) ? params.id : '';
  redirect(id ? `/frameworks?tab=library&open=${id}` : '/frameworks?tab=library');
}
