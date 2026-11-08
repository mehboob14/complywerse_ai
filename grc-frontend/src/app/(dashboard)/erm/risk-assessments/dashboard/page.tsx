import { redirect } from 'next/navigation';

// The old dashboard is the Insights view of the Risk Assessments home.
export default function RiskAssessmentsDashboardForward() {
  redirect('/erm/risk-assessments?view=insights');
}
