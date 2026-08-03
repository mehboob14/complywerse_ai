'use client';

// Assessments — top-level section (moved out of the Compliance submenu). This
// is the Overview board; each assessment type has its own child route under
// /assessments/<framework>.
import AssessmentsRedesignClient from '@/components/compliance/_redesign/AssessmentsRedesignClient';

export default function AssessmentsOverviewPage() {
  return <AssessmentsRedesignClient initialTab="overview" />;
}
