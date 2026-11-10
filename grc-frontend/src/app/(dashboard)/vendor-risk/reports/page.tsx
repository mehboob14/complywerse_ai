'use client';

// Insights > Reports: the committee pack, the register of critical functions and contract obligations, a supplier's evidence file and the ratings of the critical suppliers, generated from the programme's own
// records. A kept report is frozen; once approved it can be shared with an examiner through a link that needs no sign-in, expires and can be withdrawn. The page is the programme-health band and the kept
// reports (_reports/ReportsRegister); Generate a report is a Sheet (_reports/GenerateSheet) that the head's button, the empty state and `?generate=<kind>` (the old "Quarterly report" link) open.
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { titleFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import GenerateSheet from './_reports/GenerateSheet';
import ReportsRegister from './_reports/ReportsRegister';
import { usePermissions } from '@/hooks/usePermissions';
import { rightsFrom } from './_reports/reportsModel';

const INFO = 'The committee pack, the register of critical functions and contract obligations, a supplier’s evidence file and the ratings of the critical suppliers, generated from the programme’s own records. A kept report does not change afterwards. Approve a report before sharing it: an examiner’s link needs no sign-in, lasts up to 30 days and every view is logged.';

export default function ReportsPage() {
  const label = titleFor('/vendor-risk/reports') ?? 'Reports';
  const { hasPermission } = usePermissions();
  const rights = rightsFrom(hasPermission);
  const [generate, setGenerate] = useState(false);
  // a link from the Security ratings page ("Quarterly report") and from a supplier's summary can ask for the sheet
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('generate')) setGenerate(true);
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <ReportsRegister
        label={label}
        info={INFO}
        onGenerate={() => setGenerate(true)}
        head={({ meta, info, actions }) => (
          <>
            <PageHeader variant="page" title={label} info={info} meta={meta} actions={actions} />
            <VendorTabs />
          </>
        )}
      />
      <GenerateSheet open={generate} onClose={() => setGenerate(false)} canKeep={rights.generate} />
    </div>
  );
}
