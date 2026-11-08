// The heat map is the home of Advanced Analytics now (/erm/analytics); its older address forwards there, search and all.
import { redirect } from 'next/navigation';

export default function HeatMapPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([k, v]) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).forEach((x) => query.append(k, x)));
  const text = query.toString();
  redirect(`/erm/analytics${text ? `?${text}` : ''}`);
}
