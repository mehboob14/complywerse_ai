import { redirect } from 'next/navigation';

// /frameworks/manage was the Manage Frameworks tab (the active journeys and the library as cards). Journeys and Library are two registers of /frameworks now: this address stays for ever (the sidebar's
// Frameworks entry, the Performance Overview, stored links and bookmarks carry it) and forwards there, with whatever query the link had. A server redirect: no flash of an old page.
export default function ManageFrameworksForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.keys(searchParams ?? {}).forEach((key) => {
    const value = searchParams?.[key];
    (Array.isArray(value) ? value : value === undefined ? [] : [value]).forEach((v) => query.append(key, v));
  });
  redirect(query.toString() ? `/frameworks?${query.toString()}` : '/frameworks');
}
