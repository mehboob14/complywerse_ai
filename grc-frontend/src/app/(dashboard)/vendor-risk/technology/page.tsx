// The Technology page is the first view of Dependencies. Every address that pointed here keeps working: /vendor-risk/technology?q=WordPress (the supplier's Outside-in panel links with it)
// opens the technology search for that name; any other param is kept.
import { redirect } from 'next/navigation';

export default function TechnologyForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach((v) => { if (v !== undefined) query.append(key, v); }));
  redirect(`/vendor-risk/dependencies${query.toString() ? `?${query.toString()}` : ''}`);
}
