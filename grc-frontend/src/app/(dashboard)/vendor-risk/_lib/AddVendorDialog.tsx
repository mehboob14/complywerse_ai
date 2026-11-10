'use client';

// "Add vendor", from the module header and from the empty states: the add/edit dialog (vendors/_components/VendorFormDialog), and
// once the vendor is saved its record opens (contract C2).

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import VendorFormDialog from '../vendors/_components/VendorFormDialog';
import { countsKey, registerKey } from './portfolioApi';

export default function AddVendorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  if (!open) return null;                   // mounted only while open: the form's people and units are read when it is wanted, not on every page that has the button
  return (
    <VendorFormDialog
      open={open}
      mode="add"
      onClose={onClose}
      onSaved={(vendor) => {
        qc.invalidateQueries({ queryKey: countsKey });
        qc.invalidateQueries({ queryKey: registerKey });
        qc.invalidateQueries({ queryKey: ['tprm-dashboard'] });
        onClose();
        router.push(`/vendor-risk/vendors/${vendor.id}`);
      }}
    />
  );
}
