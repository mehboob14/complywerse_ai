'use client';

// Monitoring > Alerts: every monitoring signal in ONE register (it replaces the Signals feed and the Breach alerts page). The register, its drawer and what it shows are _alerts/*; this page
// draws the page head and the Monitoring strip over it. The old address of an alert (/vendor-risk/alerts?alert=41) opens it here.
import { PageHeader } from '@/components/ui';
import { routeFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import AlertRegister from '../_alerts/AlertRegister';

const INFO = 'Everything the feeds and your team record about suppliers: breaches, bad press, flaws in software they run, ratings that fell, certificates about to lapse. Acknowledge what you have seen and work the rest to a decision.';

export default function MonitoringPage() {
  const label = routeFor('/vendor-risk/monitoring')?.label ?? 'Alerts';
  return (
    <AlertRegister
      label={label}
      head={({ meta, actions }) => (
        <>
          <PageHeader variant="page" title={label} info={INFO} meta={meta} actions={actions} />
          <VendorTabs />
        </>
      )}
    />
  );
}
