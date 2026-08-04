'use client';

// Internal Audit lives under the Auditor Portal (moved out of Assessments).
// Reuses the assessments module, opened straight to the internal_audit view.
import AssessmentsRedesignClient from '@/components/compliance/_redesign/AssessmentsRedesignClient';

export default function AuditorInternalAuditPage() {
  return <AssessmentsRedesignClient initialTab="internal_audit" />;
}
