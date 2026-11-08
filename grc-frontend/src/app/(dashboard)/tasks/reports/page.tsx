import { redirect } from 'next/navigation';

// /tasks/reports was the page of the Task Reports view, and a tab of /tasks. The Reports tab is the one place now: this address stays for ever (stored links and bookmarks carry it) and forwards
// to it, with whatever query the link had. A server redirect: no flash of an old page.
export default function TaskReportsForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams({ tab: 'reports' });
  Object.keys(searchParams ?? {}).forEach((key) => {
    if (key === 'tab') return;
    const value = searchParams?.[key];
    (Array.isArray(value) ? value : value === undefined ? [] : [value]).forEach((v) => query.append(key, v));
  });
  redirect(`/tasks?${query.toString()}`);
}
