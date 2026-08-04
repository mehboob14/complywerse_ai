'use client';

// One route per assessment type — the sidebar "Assessments" dropdown links here
// (e.g. /assessments/pdpl, /assessments/nca, /assessments/digital_ops_maturity).
// The framework key is passed to the module as the initial active tab.
import AssessmentsRedesignClient from '@/components/compliance/_redesign/AssessmentsRedesignClient';

export default function AssessmentFrameworkPage({ params }: { params: { framework: string } }) {
  return <AssessmentsRedesignClient initialTab={params.framework} />;
}
