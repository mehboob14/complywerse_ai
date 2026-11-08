import { redirect } from 'next/navigation';

// /tasks/sla was a page of SLA days kept in ONE BROWSER (no menu entry opened it, and what it saved was not the organization's). The organization's SLA days are on the Settings tab of Task
// Management: this address stays for ever and forwards there. The per-browser store (slaConfig.ts) is no longer written by any page; the New task form still reads it as a last fallback until it
// reads the organization's days only.
export default function TaskSlaForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams({ tab: 'settings' });
  Object.keys(searchParams ?? {}).forEach((key) => {
    if (key === 'tab') return;
    const value = searchParams?.[key];
    (Array.isArray(value) ? value : value === undefined ? [] : [value]).forEach((v) => query.append(key, v));
  });
  redirect(`/tasks?${query.toString()}`);
}
