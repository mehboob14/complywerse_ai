'use client';

// Insights > Risks (the Risk 360° page): the third-party risks of the enterprise Risk Register, linked back to their supplier, with the residual score on the tenant's bands and the ten-domain
// breakdown in each row's drawer. The register is _risks/RiskRegister (the facet explorer), the ten static domain cards are the Domains drawer, and the framework coverage is its own card under
// the register. The address /vendor-risk/risk-360 is kept (a bookmark, the Insights entry's first tab).
import { useState } from 'react';
import { PageHeader } from '@/components/ui';
import { routeFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import CoverageCard from './_risks/CoverageCard';
import DomainsPanel from './_risks/DomainsPanel';
import RiskRegister from './_risks/RiskRegister';

const INFO = 'Third-party risk connected to the enterprise Risk Register: every supplier’s residual risk rolls up here when its assessment is scored, across the ten domains. Scores are worded on your policy’s bands.';

export default function RisksPage() {
  const label = routeFor('/vendor-risk/risk-360')?.label ?? 'Third-party risks';
  const [domains, setDomains] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <RiskRegister
        label={label}
        info={INFO}
        onDomains={() => setDomains(true)}
        head={({ meta, info, actions }) => (
          <>
            <PageHeader variant="page" title={label} info={info} meta={meta} actions={actions} />
            <VendorTabs />
          </>
        )}
      />
      <CoverageCard />
      <DomainsPanel open={domains} onClose={() => setDomains(false)} />
    </div>
  );
}
