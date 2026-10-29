'use client';

// The title row of every portfolio page: the module's icon and name, one line of facts, and the two ways to bring a vendor in. Each
// button is shown only to people who may use it. "Request vendor" opens the Intake page's dialog (contract C1); "Add vendor" opens
// the add dialog here (contract C2).

import { useState } from 'react';
import Link from 'next/link';
import { Building2, FileText, Plus } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN, BTN_PRIMARY, ModuleHeader } from '../_ui';
import AddVendorDialog from './AddVendorDialog';
import { usePortfolioCounts } from './portfolioApi';
import { headerStats } from './portfolioModel';

export default function ModuleHead() {
  const counts = usePortfolioCounts();
  const { hasPermission } = usePermissions();
  const [adding, setAdding] = useState(false);
  const erm = hasPermission('erm:risks:edit');                       // the server accepts it for every write in the module
  const canRequest = hasPermission('vendor_risk:intake:create') || erm;
  const canAdd = hasPermission('vendor_risk:vendors:create') || erm;
  return (
    <>
      <ModuleHeader
        icon={Building2}
        title="Vendors"
        stats={headerStats(counts)}
        actions={(
          <>
            {canRequest && (
              <Link href="/vendor-risk/intake?request=1" className={BTN}>
                <FileText aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                Request vendor
              </Link>
            )}
            {canAdd && (
              <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
                <Plus aria-hidden className="h-4 w-4" strokeWidth={2} />
                Add vendor
              </button>
            )}
          </>
        )}
      />
      <AddVendorDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
