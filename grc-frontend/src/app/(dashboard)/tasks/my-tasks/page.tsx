import { redirect } from 'next/navigation';

// /tasks/my-tasks was the page of the My Tasks view, and a tab of /tasks. My work, the front door of Task Management, took its place: this address stays for ever (stored links, notifications and
// bookmarks carry it) and forwards to it, with whatever query the link had. A server redirect: no flash of an old page.
export default function MyTasksForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.keys(searchParams ?? {}).forEach((key) => {
    const value = searchParams?.[key];
    (Array.isArray(value) ? value : value === undefined ? [] : [value]).forEach((v) => query.append(key, v));
  });
  redirect(query.toString() ? `/tasks?${query.toString()}` : '/tasks');
}
