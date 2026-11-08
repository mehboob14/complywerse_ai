import { redirect } from 'next/navigation';

// The old "Manual assessments" list (it listed framework assessments too) is the home, which lists both with a Kind filter. Its parameters are kept.
export default function RiskAssessmentsListForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const qs = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach((x) => { if (x != null) qs.append(k, x); }));
  const text = qs.toString();
  redirect(`/erm/risk-assessments${text ? `?${text}` : ''}`);
}
