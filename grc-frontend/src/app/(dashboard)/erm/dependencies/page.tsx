// Risk dependencies are a tool of Advanced Analytics now (the list, the cascade and Add dependency are on one page with the other tools); the old address forwards, search and all.
import { redirect } from 'next/navigation';

export default function DependenciesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([k, v]) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).forEach((x) => query.append(k, x)));
  const text = query.toString();
  redirect(`/erm/analytics/dependencies${text ? `?${text}` : ''}`);
}
