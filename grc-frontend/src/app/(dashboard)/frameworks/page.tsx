'use client';

// /frameworks — Compliance Dashboard surface
// ─────────────────────────────────────────────────────────────────────────
// Tabs (Dashboard / Manage Frameworks) + Start-a-Journey launcher + the
// posture dashboard widgets. The management sections (Processing, Active
// Journeys, Available Frameworks) live at /frameworks/manage under the
// "Manage Frameworks" tab.

import { useQuery } from '@tanstack/react-query';
import apiClient, { certificationsApi } from '@/lib/api';
import { CertificationJourney } from '@/types';
import { PageLoader } from '@/components/ui';
import { ComplianceDashboard } from './_components/ComplianceDashboard';
import { FrameworkJourneyPicker } from './_components/FrameworkJourneyPicker';
import { FrameworksTabs } from './_components/FrameworksTabs';
import { UploadedFramework } from './_components/shared';

export default function FrameworksDashboardPage() {
  const { data: frameworks, isLoading: frameworksLoading } = useQuery({
    queryKey: ['uploaded-frameworks'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const items = response.data?.items;
      return Array.isArray(items) ? (items as UploadedFramework[]) : [];
    },
  });

  const { data: certifications, isLoading: certificationsLoading } = useQuery({
    queryKey: ['certifications'],
    queryFn: async () => {
      const response = await certificationsApi.getAll();
      return response.data;
    },
  });

  if (frameworksLoading || certificationsLoading) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <FrameworksTabs />
        <PageLoader className="h-64" />
      </div>
    );
  }

  const activeCertifications = ((certifications as CertificationJourney[]) || []).filter(
    (c: CertificationJourney) => c.status === 'in_progress' || c.status === 'not_started',
  );
  const activeCertificationFrameworkIds = new Set(
    activeCertifications.map((c) => String(c.framework_id || c.uploaded_framework_id)),
  );

  const frameworksArray = Array.isArray(frameworks) ? frameworks : [];

  const stripCertificationPostfix = (value?: string): string => {
    if (!value) return '';
    return value.replace(/\s+certification\s*$/i, '').trim();
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Tab bar — picker lives in the leading-action slot, top-left next to
          the page title. Selecting a framework opens the detail modal. */}
      <FrameworksTabs
        leadingAction={
          <FrameworkJourneyPicker
            frameworks={frameworksArray}
            activeJourneyFrameworkIds={activeCertificationFrameworkIds}
            stripCertificationPostfix={stripCertificationPostfix}
          />
        }
      />

      {/* Posture dashboard cluster — hero gauge, status donut, per-framework
          cards, domain heat-map, activity timeline. Hides when there are no
          journeys yet. */}
      <ComplianceDashboard />
    </div>
  );
}
