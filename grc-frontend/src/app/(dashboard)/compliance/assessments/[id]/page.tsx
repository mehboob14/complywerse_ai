// /compliance/assessments/<id>: an old address that forwards to the assessment workspace (/assessments/a/<id>), the query string kept. Stored links, emails and bookmarks carry it.
import { redirect } from 'next/navigation';

export default function LegacyAssessmentForward({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  const text = query.toString();
  redirect(`/assessments/a/${encodeURIComponent(params.id)}${text ? `?${text}` : ''}`);
}
