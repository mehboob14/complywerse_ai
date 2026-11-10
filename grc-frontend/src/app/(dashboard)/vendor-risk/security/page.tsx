'use client';

// Monitoring > Security ratings: every supplier's websites and domains as the internet sees them (grade, score, change, what is open and waived), on the same explorer as the Alerts register.
// The register and its drawer are _ratings/*; this page draws the page head and the Monitoring strip over it.
import { PageHeader } from '@/components/ui';
import { routeFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import RatingsRegister from '../_ratings/RatingsRegister';

export default function SecurityRatingsPage() {
  const label = routeFor('/vendor-risk/security')?.label ?? 'Security ratings';
  return (
    <RatingsRegister
      label={label}
      head={({ meta, info, actions }) => (
        <>
          <PageHeader variant="page" title={label} info={info} meta={meta} actions={actions} />
          <VendorTabs />
        </>
      )}
    />
  );
}
