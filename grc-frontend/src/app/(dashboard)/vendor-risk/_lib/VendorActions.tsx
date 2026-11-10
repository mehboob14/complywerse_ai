'use client';

// The two ways to bring a vendor in, for the head of the pages that need them (Overview, Register, Intake): "Request vendor" opens Intake with its request dialog, "Add vendor" opens the
// add dialog here. Each is shown only to people who may use it (the server accepts the module's own right, or the risk right, for every write in the module).
import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import AddVendorDialog from './AddVendorDialog';

export default function VendorActions() {
  const { hasPermission } = usePermissions();
  const [adding, setAdding] = useState(false);
  const erm = hasPermission('erm:risks:edit');
  const canRequest = hasPermission('vendor_risk:intake:create') || erm;
  const canAdd = hasPermission('vendor_risk:vendors:create') || erm;
  return (
    <>
      {canRequest && <Button href="/vendor-risk/intake?request=1" leftIcon={<FileText aria-hidden />}>Request vendor</Button>}
      {canAdd && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add vendor</Button>}
      <AddVendorDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
