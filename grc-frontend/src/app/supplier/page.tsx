'use client';

// For a supplier contact without a working link: a new one, by email.

import { Shield } from 'lucide-react';
import { RequestLinkForm, Shell } from './_shared';

export default function SupplierNewLinkPage() {
  return (
    <Shell>
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
          <Shield className="h-3.5 w-3.5" /> Supplier portal
        </span>
        <h1 className="mt-3 text-xl font-semibold text-gray-900">Get a new link</h1>
        <p className="mt-1 text-sm text-gray-600">We email a new personal link to a supplier contact’s address.</p>
        <div className="mt-6"><RequestLinkForm /></div>
      </div>
    </Shell>
  );
}
