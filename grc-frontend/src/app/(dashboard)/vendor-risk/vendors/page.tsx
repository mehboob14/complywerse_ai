'use client';

export const dynamic = 'force-dynamic';

// Third-Party Vendor Risk > Vendors: the register (a facet explorer over every vendor, vendors/_register/VendorRegister). The Assessments board is its Board view.
import { routeFor } from '@/lib/navRegistry';
import VendorRegister from './_register/VendorRegister';

export default function VendorRegisterPage() {
  return <VendorRegister label={routeFor('/vendor-risk/vendors')?.label ?? 'Vendors'} />;
}
