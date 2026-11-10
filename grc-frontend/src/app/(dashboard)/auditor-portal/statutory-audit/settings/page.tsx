'use client';

export const dynamic = 'force-dynamic';

// Statutory Audit > Settings: the organisation's own status levels, SLA days and extra fields for observations. It used to be a switch inside the register's page that no address could
// point at; it is a page of its own now (the register's head has a Settings button), and the panel is the shared one, unchanged. The server lets whoever holds the Assessments view or
// edit right read and save them (services/module_settings.MODULES), and that is what the panel asks.
import { PageHeader } from '@/components/ui';
import ModuleSettingsPanel from '@/components/settings/ModuleSettingsPanel';

export default function StatutoryAuditSettingsPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Statutory Audit settings"
        back={{ href: '/auditor-portal/statutory-audit', label: 'Back to Statutory Audit' }}
        info="Status levels, SLA days and extra fields for observations. A status you add appears at once in the register's filters and board, and in the choices for moving an observation."
      />
      <ModuleSettingsPanel moduleKey="statutory_audit" />
    </div>
  );
}
