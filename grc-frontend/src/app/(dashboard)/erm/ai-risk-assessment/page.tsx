import { redirect } from 'next/navigation';

// AI Risk Assessment moved under Risk Assessments as a tab. Keep this path as a
// permanent redirect so any old links / bookmarks land in the right place.
export default function AiRiskAssessmentRedirect() {
  redirect('/erm/risk-assessments/ai-risk-assessment');
}
