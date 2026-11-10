// The Concentration page is the Shared platforms view of Dependencies (its shared vulnerabilities, unregistered suppliers and platform names are views there too). The address keeps working;
// any param is kept.
import { redirect } from 'next/navigation';

export default function ConcentrationForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams({ view: 'platforms' });
  Object.entries(searchParams ?? {}).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach((v) => { if (v !== undefined && key !== 'view') query.append(key, v); }));
  redirect(`/vendor-risk/dependencies?${query.toString()}`);
}
