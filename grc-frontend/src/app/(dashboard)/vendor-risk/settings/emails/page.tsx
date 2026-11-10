// The Emails page is the Emails section of Settings now (one place for the module's configuration). The address keeps working; any param is kept.
import { redirect } from 'next/navigation';

export default function EmailsForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams({ section: 'emails' });
  Object.entries(searchParams ?? {}).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach((v) => { if (v !== undefined && key !== 'section') query.append(key, v); }));
  redirect(`/vendor-risk/settings?${query.toString()}`);
}
