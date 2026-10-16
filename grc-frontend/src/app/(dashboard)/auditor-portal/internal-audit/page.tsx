'use client';

// Internal Audit lives under the Auditor Portal (moved out of Assessments).
// Reuses the assessments module, opened straight to the internal_audit view.
import { useState } from 'react';
import AssessmentsRedesignClient from '@/components/compliance/_redesign/AssessmentsRedesignClient';
import ModuleSettingsPanel, { ModuleSettingsSwitch } from '@/components/settings/ModuleSettingsPanel';

export default function AuditorInternalAuditPage() {
  const [view, setView] = useState<'records' | 'settings'>('records');
  return (
    <div className="space-y-4">
      <ModuleSettingsSwitch view={view} onView={setView} label="Audits" />
      {view === 'settings'
        ? <ModuleSettingsPanel moduleKey="internal_audit" />
        : <AssessmentsRedesignClient initialTab="internal_audit" />}
    </div>
  );
}
