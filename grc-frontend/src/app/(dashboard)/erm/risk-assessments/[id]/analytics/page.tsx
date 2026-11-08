import { redirect } from 'next/navigation';

// The analytics of one assessment are the Insights tab of its workspace (one set of numbers instead of two).
export default function AssessmentAnalyticsForward({ params }: { params: { id: string } }) {
  redirect(`/erm/risk-assessments/${encodeURIComponent(params.id)}?tab=insights`);
}
